import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { RegistroTiempoOperario } from './entities/registro-tiempo-operario.entity';
import { LeadTimeProveedor }      from './entities/lead-time-proveedor.entity';

@Injectable()
export class MetricasService {
  constructor(
    @InjectRepository(RegistroTiempoOperario) private regRepo: Repository<RegistroTiempoOperario>,
    @InjectRepository(LeadTimeProveedor)      private ltRepo:  Repository<LeadTimeProveedor>,
    private ds: DataSource,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // OPERARIOS
  // ══════════════════════════════════════════════════════════════════════════

  /** Métricas agregadas por operario y departamento */
  async metricasOperarios(params?: { operario?: string; departamento?: string }) {
    let sql = `
      SELECT
        operario_nombre,
        departamento,
        tecnica,
        ROUND(AVG(min_por_pieza), 2)      AS promedio_min_pieza,
        ROUND(STDDEV(min_por_pieza), 2)   AS desviacion,
        ROUND(AVG(duracion_minutos), 1)   AS promedio_duracion_min,
        SUM(piezas_ok)                    AS total_piezas_ok,
        SUM(piezas_retrabajo)             AS total_retrabajo,
        SUM(piezas_descarte)              AS total_descarte,
        ROUND(
          SUM(piezas_retrabajo + piezas_descarte) * 100.0
          / NULLIF(SUM(piezas_ok + piezas_retrabajo + piezas_descarte), 0),
          1
        )                                 AS pct_error,
        COUNT(*)                          AS muestras,
        MAX(fecha)                        AS ultima_actividad
      FROM registros_tiempo_operario
      WHERE min_por_pieza IS NOT NULL
    `;
    const params_sql: any[] = [];
    if (params?.operario)     { sql += ' AND operario_nombre = ?'; params_sql.push(params.operario); }
    if (params?.departamento) { sql += ' AND departamento = ?';    params_sql.push(params.departamento); }
    sql += ' GROUP BY operario_nombre, departamento, tecnica ORDER BY promedio_min_pieza ASC';

    return this.ds.query<any[]>(sql, params_sql);
  }

  /** Ranking de operarios para un departamento/técnica específico */
  async rankingOperarios(departamento: string) {
    return this.ds.query<any[]>(`
      SELECT
        operario_nombre,
        ROUND(AVG(min_por_pieza), 2) AS promedio_min_pieza,
        SUM(piezas_ok)               AS total_piezas,
        COUNT(*)                     AS muestras,
        ROUND(
          SUM(piezas_retrabajo + piezas_descarte) * 100.0
          / NULLIF(SUM(piezas_ok + piezas_retrabajo + piezas_descarte), 0),
          1
        )                            AS pct_error
      FROM registros_tiempo_operario
      WHERE departamento = ? AND min_por_pieza IS NOT NULL
      GROUP BY operario_nombre
      ORDER BY promedio_min_pieza ASC
    `, [departamento]);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROVEEDORES
  // ══════════════════════════════════════════════════════════════════════════

  /** Métricas de lead time por proveedor */
  async metricasProveedores(proveedor_id?: number) {
    let sql = `
      SELECT
        proveedor_nombre,
        proveedor_id,
        ROUND(AVG(dias_reales), 1)   AS promedio_dias,
        MIN(dias_reales)             AS mejor_caso_dias,
        MAX(dias_reales)             AS peor_caso_dias,
        ROUND(STDDEV(dias_reales),1) AS desviacion_dias,
        ROUND(AVG(dias_estimados),1) AS promedio_prometido,
        SUM(CASE WHEN dias_reales > dias_estimados THEN 1 ELSE 0 END) AS veces_tarde,
        COUNT(*)                     AS muestras
      FROM lead_times_proveedores
      WHERE dias_reales IS NOT NULL
    `;
    const p: any[] = [];
    if (proveedor_id) { sql += ' AND proveedor_id = ?'; p.push(proveedor_id); }
    sql += ' GROUP BY proveedor_id, proveedor_nombre ORDER BY promedio_dias ASC';
    return this.ds.query<any[]>(sql, p);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUGERENCIA DE FECHA PARA UNA ORDEN
  // ══════════════════════════════════════════════════════════════════════════

  /** Dado un orden_id, calcula la fecha de entrega sugerida basándose en:
   *  promedio min/pieza por técnica × piezas de la orden */
  async sugerenciaFechaOrden(ordenId: number) {
    // Traer lotes de la orden con su técnica y cantidad
    const lotes = await this.ds.query<any[]>(`
      SELECT departamento, tecnica, cantidad
      FROM lotes_produccion
      WHERE orden_id = ? AND tipo = 'departamento'
    `, [ordenId]);

    if (!lotes.length) return { sugerida: null, detalle: [], mensaje: 'Sin lotes definidos' };

    let minutosTotal = 0;
    const detalle: any[] = [];

    for (const lote of lotes) {
      // Buscar promedio histórico para esta técnica
      const [metrica] = await this.ds.query<any[]>(`
        SELECT ROUND(AVG(min_por_pieza), 2) AS promedio
        FROM registros_tiempo_operario
        WHERE departamento = ? AND min_por_pieza IS NOT NULL
      `, [lote.departamento]);

      const promedio = parseFloat(metrica?.promedio ?? '0');
      const piezas   = Number(lote.cantidad ?? 0);
      const minutos  = promedio > 0 ? promedio * piezas : null;

      detalle.push({
        departamento: lote.departamento,
        tecnica:      lote.tecnica,
        piezas,
        promedio_min_pieza: promedio || null,
        minutos_estimados:  minutos,
        muestras_insuficientes: promedio === 0,
      });

      if (minutos) minutosTotal += minutos;
    }

    let sugerida: string | null = null;
    if (minutosTotal > 0) {
      // Asumir jornada de 8h = 480 min/día
      const diasHabiles = Math.ceil(minutosTotal / 480);
      const fecha = new Date();
      let diasAgregados = 0;
      while (diasAgregados < diasHabiles) {
        fecha.setDate(fecha.getDate() + 1);
        const dow = fecha.getDay();
        if (dow !== 0 && dow !== 6) diasAgregados++; // saltar fines de semana
      }
      sugerida = fecha.toISOString().split('T')[0];
    }

    return {
      sugerida,
      minutos_total: minutosTotal,
      dias_estimados: minutosTotal > 0 ? Math.ceil(minutosTotal / 480) : null,
      detalle,
      mensaje: minutosTotal === 0
        ? 'Datos insuficientes — registra más lotes para obtener estimaciones'
        : `Estimado basado en ${detalle.filter(d => !d.muestras_insuficientes).length} técnica(s) con historial`,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RESUMEN GENERAL
  // ══════════════════════════════════════════════════════════════════════════

  async resumenGeneral() {
    const [registros, leads] = await Promise.all([
      this.ds.query<any[]>(`
        SELECT
          COUNT(*)                         AS total_registros,
          COUNT(DISTINCT operario_nombre)  AS total_operarios,
          COUNT(DISTINCT departamento)     AS total_departamentos,
          SUM(piezas_ok)                   AS total_piezas_ok,
          SUM(piezas_retrabajo)            AS total_retrabajo,
          SUM(piezas_descarte)             AS total_descarte
        FROM registros_tiempo_operario
      `),
      this.ds.query<any[]>(`
        SELECT
          COUNT(*)                         AS total_recepciones,
          COUNT(DISTINCT proveedor_id)     AS total_proveedores,
          ROUND(AVG(dias_reales), 1)       AS promedio_lead_time_global
        FROM lead_times_proveedores
        WHERE dias_reales IS NOT NULL
      `),
    ]);

    return {
      operarios: registros[0] ?? {},
      proveedores: leads[0] ?? {},
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WRITE — Registrar desde otros servicios
  // ══════════════════════════════════════════════════════════════════════════

  async crearRegistroTiempo(dto: {
    lote_id:          number;
    orden_id:         number;
    orden_numero?:    string;
    operario_nombre?: string;
    departamento?:    string;
    tecnica?:         string;
    piezas_ok:        number;
    piezas_retrabajo: number;
    piezas_descarte:  number;
    duracion_minutos: number | null;
  }): Promise<RegistroTiempoOperario> {
    const piezasOk  = dto.piezas_ok || 0;
    const min_por_pieza =
      dto.duracion_minutos && piezasOk > 0
        ? parseFloat((dto.duracion_minutos / piezasOk).toFixed(2))
        : null;

    const reg = this.regRepo.create({
      ...dto,
      min_por_pieza,
      fecha: new Date().toISOString().split('T')[0],
    });
    return this.regRepo.save(reg);
  }

  async crearLeadTime(dto: {
    orden_compra_id?: number;
    proveedor_id?:    number;
    proveedor_nombre?: string;
    dias_estimados?:  number;
    dias_reales?:     number;
    fecha_orden?:     string;
    fecha_llegada?:   string;
  }): Promise<LeadTimeProveedor> {
    const lt = this.ltRepo.create(dto);
    return this.ltRepo.save(lt);
  }
}
