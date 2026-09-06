import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Servicio del módulo "Operarios" — vista 360° de cada operario del taller.
 *
 * Combina datos de:
 *  - usuarios (identidad, rol)
 *  - lotes_produccion (trabajo histórico, tiempos)
 *  - ordenes_produccion (fecha_comprometida → cálculo a tiempo / tardío)
 *  - clientes (nombre del cliente en cada lote)
 *  - empleados_ficha (foto, fecha de ingreso si existe ficha vinculada)
 *  - empleados_vacaciones (resumen de periodos)
 *
 * Cálculo "a tiempo vs tardío" se hace POR LOTE individual:
 *   - a tiempo: lote.tiempo_fin <= orden.fecha_comprometida
 *   - tardío: lote.tiempo_fin > orden.fecha_comprometida
 * Solo aplica a lotes en estado COMPLETADO con tiempo_fin no nulo.
 */
@Injectable()
export class OperariosService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTADO — cards de operarios
  // ═══════════════════════════════════════════════════════════════════════════
  async listar(): Promise<any[]> {
    // Operarios = usuarios con rol 'operario' (activos por defecto)
    const rows = await this.ds.query(`
      SELECT
        u.id,
        u.nombre,
        u.email,
        u.activo,
        u.departamentos,
        ef.id            AS ficha_id,
        ef.foto_url      AS foto_url,
        ef.cargo         AS cargo,
        ef.fecha_ingreso AS fecha_ingreso
      FROM usuarios u
      LEFT JOIN empleados_ficha ef ON ef.usuario_id = u.id
      WHERE u.rol = 'operario'
      ORDER BY u.activo DESC, u.nombre ASC
    `);

    // KPIs del mes en curso por operario
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    const inicioMesStr = inicioMes.toISOString().slice(0, 19).replace('T', ' ');

    const result: any[] = [];
    for (const u of rows) {
      const kpi = await this.kpisOperario(u.nombre, inicioMesStr, null);
      result.push({
        ...u,
        departamentos: this.parseDeptos(u.departamentos),
        kpi_mes: kpi,
      });
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERFIL — resumen + datos base de UN operario
  // ═══════════════════════════════════════════════════════════════════════════
  async obtener(id: number): Promise<any> {
    const [u] = await this.ds.query(`
      SELECT u.*, ef.id ficha_id, ef.foto_url, ef.cargo, ef.fecha_ingreso,
             ef.telefono_personal, ef.correo_electronico, ef.direccion,
             ef.tipo_sangre, ef.afp, ef.salario
      FROM usuarios u
      LEFT JOIN empleados_ficha ef ON ef.usuario_id = u.id
      WHERE u.id = ?
    `, [id]);
    if (!u) throw new NotFoundException(`Operario #${id} no encontrado`);
    return {
      ...u,
      departamentos: this.parseDeptos(u.departamentos),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESUMEN — KPIs por periodo
  // ═══════════════════════════════════════════════════════════════════════════
  async resumen(id: number, periodo: 'semana' | 'quincena' | 'mes' | 'anio' | 'global'): Promise<any> {
    const u = await this.obtener(id);
    const { desde, hasta } = this.rangoPeriodo(periodo);
    const kpi = await this.kpisOperario(u.nombre, desde, hasta);

    // Comparativa: KPI del taller en el mismo periodo
    const comparativa = await this.kpisTaller(desde, hasta);

    return {
      operario: { id: u.id, nombre: u.nombre, foto_url: u.foto_url, cargo: u.cargo },
      periodo,
      desde, hasta,
      kpi,
      comparativa_taller: comparativa,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HISTÓRICO — tabla de lotes trabajados con A TIEMPO / TARDÍO
  // ═══════════════════════════════════════════════════════════════════════════
  async historico(
    id: number,
    filtros: {
      desde?: string;
      hasta?: string;
      periodo?: 'semana' | 'quincena' | 'mes' | 'anio' | 'global';
      departamento?: string;
      puntualidad?: 'todas' | 'a_tiempo' | 'tardios';
      soloTardios?: boolean; // legacy — equivale a puntualidad='tardios'
      q?: string;
    },
  ): Promise<any[]> {
    const u = await this.obtener(id);
    const params: any[] = [u.nombre];
    let where = ' WHERE l.responsable = ? AND l.estado = "completado" ';

    // Periodo pre-establecido (semana/quincena/mes/anio) tiene prioridad si no se pasaron fechas
    let { desde, hasta } = filtros;
    if (!desde && !hasta && filtros.periodo && filtros.periodo !== 'global') {
      const r = this.rangoPeriodo(filtros.periodo);
      if (r.desde) desde = r.desde;
      if (r.hasta) hasta = r.hasta;
    }
    if (desde) { where += ' AND l.tiempo_fin >= ? '; params.push(desde); }
    if (hasta) {
      // Si ya viene con hora (formato datetime), úsalo tal cual; si es solo fecha agrega final de día
      const h = hasta.includes(':') ? hasta : `${hasta} 23:59:59`;
      where += ' AND l.tiempo_fin <= ? ';
      params.push(h);
    }
    if (filtros.departamento) {
      where += ' AND l.departamento = ? ';
      params.push(filtros.departamento);
    }
    if (filtros.q) {
      where += ' AND (op.numero LIKE ? OR c.nombre LIKE ?) ';
      params.push(`%${filtros.q}%`, `%${filtros.q}%`);
    }

    // Filtro de puntualidad — soporta forma nueva y legacy soloTardios
    const punt = filtros.puntualidad
      ?? (filtros.soloTardios ? 'tardios' : 'todas');

    // Colapsamos por (orden, depto, PRODUCTO). El lote "departamento" y su tarea
    // hija del MISMO departamento espejean las mismas piezas (al completar la
    // tarea se copian al padre) → con MAX cuentan UNA sola vez. Al incluir el
    // producto en el grupo, dos productos distintos del mismo depto (ej. polos +
    // gorras en bordado) o una división entre operarios SÍ se suman por separado.
    let sql = `
      SELECT * FROM (
        SELECT
          MAX(l.id)                   AS lote_id,
          MAX(l.numero)               AS lote_numero,
          l.departamento              AS departamento,
          l.producto                  AS producto,
          MAX(l.tarea_nombre)         AS tarea_nombre,
          MAX(l.cantidad)             AS cantidad,
          MAX(l.piezas_ok)            AS piezas_ok,
          MAX(COALESCE(l.aplicaciones_por_pieza, 1)) AS aplicaciones_por_pieza,
          MAX(l.piezas_retrabajo)     AS piezas_retrabajo,
          MAX(l.piezas_descarte)      AS piezas_descarte,
          MIN(l.tiempo_inicio)        AS tiempo_inicio,
          MAX(l.tiempo_fin)           AS tiempo_fin,
          op.id                       AS orden_id,
          op.numero                   AS orden_numero,
          op.fecha_comprometida       AS orden_fecha_comprometida,
          c.id                        AS cliente_id,
          c.nombre                    AS cliente_nombre,
          -- Deadline REAL = fecha_hora_entrega (con hora). fecha_comprometida es un
          -- campo viejo, sin hora y a veces desactualizado; solo como respaldo,
          -- tratado como fin del día para no marcar tardío una entrega del mismo día.
          CASE
            WHEN MAX(l.tiempo_fin) IS NULL OR COALESCE(op.fecha_hora_entrega, op.fecha_comprometida) IS NULL THEN 'sin_dato'
            WHEN MAX(l.tiempo_fin) <= COALESCE(op.fecha_hora_entrega, TIMESTAMPADD(SECOND, 86399, op.fecha_comprometida)) THEN 'a_tiempo'
            ELSE 'tardio'
          END                         AS puntualidad,
          CASE
            WHEN MAX(l.tiempo_fin) IS NOT NULL
              AND COALESCE(op.fecha_hora_entrega, op.fecha_comprometida) IS NOT NULL
              AND MAX(l.tiempo_fin) > COALESCE(op.fecha_hora_entrega, TIMESTAMPADD(SECOND, 86399, op.fecha_comprometida))
              THEN TIMESTAMPDIFF(HOUR, COALESCE(op.fecha_hora_entrega, TIMESTAMPADD(SECOND, 86399, op.fecha_comprometida)), MAX(l.tiempo_fin))
            ELSE 0
          END                         AS horas_atraso,
          CASE
            WHEN MIN(l.tiempo_inicio) IS NOT NULL AND MAX(l.tiempo_fin) IS NOT NULL
              THEN TIMESTAMPDIFF(MINUTE, MIN(l.tiempo_inicio), MAX(l.tiempo_fin))
            ELSE NULL
          END                         AS minutos_trabajo
        FROM lotes_produccion l
        JOIN ordenes_produccion op ON op.id = l.orden_id
        LEFT JOIN clientes c ON c.id = op.cliente_id
        ${where}
        GROUP BY op.id, l.departamento, l.producto, op.numero, op.fecha_comprometida, c.id, c.nombre
      ) g
    `;

    if (punt === 'tardios')   sql += ` WHERE g.puntualidad = 'tardio' `;
    if (punt === 'a_tiempo')  sql += ` WHERE g.puntualidad = 'a_tiempo' `;
    sql += ` ORDER BY g.tiempo_fin DESC LIMIT 500 `;

    return this.ds.query(sql, params);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDIMIENTO — tendencias mensuales
  // ═══════════════════════════════════════════════════════════════════════════
  async rendimientoMensual(id: number, meses: number = 6): Promise<any[]> {
    const u = await this.obtener(id);
    const limit = Math.min(Math.max(meses, 1), 24);

    // Colapsamos el espejo depto/tarea por (orden, depto, producto) con MAX y
    // luego agregamos por mes, igual que kpisOperario — así el SUM no duplica.
    return this.ds.query(`
      SELECT
        g.mes                         AS mes,
        COUNT(*)                      AS lotes_completados,
        COALESCE(SUM(g.piezas), 0)    AS piezas_total,
        SUM(CASE WHEN g.fecha_comprometida IS NOT NULL AND g.tiempo_fin <= g.fecha_comprometida THEN 1 ELSE 0 END) AS a_tiempo,
        SUM(CASE WHEN g.fecha_comprometida IS NOT NULL AND g.tiempo_fin >  g.fecha_comprometida THEN 1 ELSE 0 END) AS tardios
      FROM (
        SELECT
          DATE_FORMAT(MAX(l.tiempo_fin), '%Y-%m')                  AS mes,
          MAX(l.tiempo_fin)                                        AS tiempo_fin,
          MAX(COALESCE(op.fecha_hora_entrega, TIMESTAMPADD(SECOND, 86399, op.fecha_comprometida))) AS fecha_comprometida,
          MAX(l.piezas_ok * COALESCE(l.aplicaciones_por_pieza, 1)) AS piezas
        FROM lotes_produccion l
        JOIN ordenes_produccion op ON op.id = l.orden_id
        WHERE l.responsable = ?
          AND l.estado = 'completado'
          AND l.tiempo_fin IS NOT NULL
          AND l.tiempo_fin >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        GROUP BY l.orden_id, l.departamento, l.producto
      ) g
      GROUP BY g.mes
      ORDER BY g.mes ASC
    `, [u.nombre, limit]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAREAS ACTIVAS — lotes asignados que aún no están completados/cancelados
  // ═══════════════════════════════════════════════════════════════════════════
  async tareasActivas(id: number): Promise<any[]> {
    const u = await this.obtener(id);
    // Match en responsable principal O en el array JSON de responsables secundarios.
    // estado_orden_aplicable: no traemos lotes de órdenes ya canceladas/entregadas.
    return this.ds.query(`
      SELECT
        l.id                    AS lote_id,
        l.numero                AS lote_numero,
        l.departamento,
        l.tarea_nombre,
        l.estado                AS lote_estado,
        l.cantidad,
        l.piezas_ok,
        l.tiempo_inicio,
        l.orden_ejecucion,
        op.id                   AS orden_id,
        op.numero               AS orden_numero,
        op.estado               AS orden_estado,
        op.fecha_comprometida   AS orden_fecha_comprometida,
        op.semaforo             AS orden_semaforo,
        c.id                    AS cliente_id,
        c.nombre                AS cliente_nombre,
        CASE
          WHEN COALESCE(op.fecha_hora_entrega, op.fecha_comprometida) IS NULL THEN 'sin_fecha'
          WHEN COALESCE(op.fecha_hora_entrega, TIMESTAMPADD(SECOND, 86399, op.fecha_comprometida)) < NOW() THEN 'vencida'
          WHEN COALESCE(op.fecha_hora_entrega, TIMESTAMPADD(SECOND, 86399, op.fecha_comprometida)) < DATE_ADD(NOW(), INTERVAL 2 DAY) THEN 'urgente'
          ELSE 'normal'
        END                     AS urgencia
      FROM lotes_produccion l
      JOIN ordenes_produccion op ON op.id = l.orden_id
      LEFT JOIN clientes c ON c.id = op.cliente_id
      WHERE l.estado IN ('desbloqueado', 'en_proceso', 'pendiente')
        AND op.estado NOT IN ('cancelado', 'entregado')
        AND (l.responsable = ? OR JSON_SEARCH(l.responsables, 'one', ?) IS NOT NULL)
      ORDER BY
        FIELD(l.estado, 'en_proceso', 'desbloqueado', 'pendiente'),
        op.fecha_comprometida ASC,
        l.orden_ejecucion ASC
    `, [u.nombre, u.nombre]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE — helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async kpisOperario(
    nombre: string,
    desde: string | null,
    hasta: string | null,
  ): Promise<any> {
    const params: any[] = [nombre];
    let where = ` WHERE l.responsable = ? AND l.estado = 'completado' `;
    if (desde) { where += ' AND l.tiempo_fin >= ? '; params.push(desde); }
    if (hasta) { where += ' AND l.tiempo_fin <= ? '; params.push(hasta); }

    // Colapsamos por (orden, depto, producto): el espejo lote-departamento/tarea
    // (mismas piezas) cuenta una vez vía MAX, pero productos distintos del mismo
    // depto o divisiones entre operarios se suman. Ver kpisTaller / historico.
    const [r] = await this.ds.query(`
      SELECT
        COUNT(DISTINCT g.orden_id)                                 AS lotes,
        COALESCE(SUM(g.piezas), 0)                                  AS piezas,
        SUM(CASE WHEN g.fecha_comprometida IS NOT NULL
                  AND g.tiempo_fin <= g.fecha_comprometida THEN 1 ELSE 0 END) AS a_tiempo,
        SUM(CASE WHEN g.fecha_comprometida IS NOT NULL
                  AND g.tiempo_fin >  g.fecha_comprometida THEN 1 ELSE 0 END) AS tardios,
        COUNT(DISTINCT DATE(g.tiempo_fin))                          AS dias_trabajados,
        COALESCE(AVG(g.minutos), 0)                                 AS minutos_promedio_lote
      FROM (
        SELECT
          l.orden_id,
          l.departamento,
          -- piezas reales = prendas × aplicaciones (bordado pecho+manga = ×2)
          MAX(l.piezas_ok * COALESCE(l.aplicaciones_por_pieza, 1))  AS piezas,
          MAX(l.tiempo_fin)                                         AS tiempo_fin,
          MAX(l.tiempo_inicio)                                      AS tiempo_inicio,
          MAX(COALESCE(op.fecha_hora_entrega, TIMESTAMPADD(SECOND, 86399, op.fecha_comprometida))) AS fecha_comprometida,
          MAX(CASE
            WHEN l.tiempo_inicio IS NOT NULL AND l.tiempo_fin IS NOT NULL
              THEN TIMESTAMPDIFF(MINUTE, l.tiempo_inicio, l.tiempo_fin)
          END)                                                      AS minutos
        FROM lotes_produccion l
        JOIN ordenes_produccion op ON op.id = l.orden_id
        ${where}
        GROUP BY l.orden_id, l.departamento, l.producto
      ) g
    `, params);

    const total = Number(r.lotes) || 0;
    const aT = Number(r.a_tiempo) || 0;
    const tar = Number(r.tardios) || 0;
    const evaluados = aT + tar;
    return {
      lotes_completados:      total,
      piezas_total:           Number(r.piezas) || 0,
      a_tiempo:               aT,
      tardios:                tar,
      lotes_evaluados:        evaluados,
      pct_a_tiempo:           evaluados ? +((aT / evaluados) * 100).toFixed(1) : null,
      dias_trabajados:        Number(r.dias_trabajados) || 0,
      minutos_promedio_lote:  Math.round(Number(r.minutos_promedio_lote) || 0),
    };
  }

  private async kpisTaller(desde: string | null, hasta: string | null): Promise<any> {
    const params: any[] = [];
    let where = ` WHERE l.estado = 'completado' AND l.responsable IS NOT NULL `;
    if (desde) { where += ' AND l.tiempo_fin >= ? '; params.push(desde); }
    if (hasta) { where += ' AND l.tiempo_fin <= ? '; params.push(hasta); }

    // Mismo criterio que kpisOperario — colapsa el espejo depto/tarea por
    // (operario, orden, depto, producto) y suma productos/divisiones distintas.
    const [r] = await this.ds.query(`
      SELECT
        COUNT(DISTINCT g.orden_id) lotes,
        COALESCE(SUM(g.piezas), 0)   piezas,
        SUM(CASE WHEN g.fecha_comprometida IS NOT NULL
                  AND g.tiempo_fin <= g.fecha_comprometida THEN 1 ELSE 0 END) AS a_tiempo,
        SUM(CASE WHEN g.fecha_comprometida IS NOT NULL
                  AND g.tiempo_fin >  g.fecha_comprometida THEN 1 ELSE 0 END) AS tardios
      FROM (
        SELECT
          l.responsable,
          l.orden_id,
          l.departamento,
          MAX(l.piezas_ok * COALESCE(l.aplicaciones_por_pieza, 1)) AS piezas,
          MAX(l.tiempo_fin)               AS tiempo_fin,
          MAX(op.fecha_comprometida)      AS fecha_comprometida
        FROM lotes_produccion l
        JOIN ordenes_produccion op ON op.id = l.orden_id
        ${where}
        GROUP BY l.responsable, l.orden_id, l.departamento, l.producto
      ) g
    `, params);

    const aT = Number(r.a_tiempo) || 0;
    const tar = Number(r.tardios) || 0;
    const evaluados = aT + tar;
    return {
      lotes:        Number(r.lotes) || 0,
      piezas:       Number(r.piezas) || 0,
      pct_a_tiempo: evaluados ? +((aT / evaluados) * 100).toFixed(1) : null,
    };
  }

  private rangoPeriodo(
    p: 'semana' | 'quincena' | 'mes' | 'anio' | 'global',
  ): { desde: string | null; hasta: string | null } {
    if (p === 'global') return { desde: null, hasta: null };
    const now = new Date();
    const inicio = new Date();
    if (p === 'semana') {
      // Lunes de la semana actual a las 00:00 (DR usa lunes como 1er día).
      const dia = inicio.getDay(); // 0=domingo, 1=lunes, ...
      const offset = dia === 0 ? 6 : dia - 1;
      inicio.setDate(inicio.getDate() - offset);
      inicio.setHours(0, 0, 0, 0);
    }
    if (p === 'quincena') {
      // 1-15 = primera quincena; 16-fin = segunda quincena.
      inicio.setDate(inicio.getDate() <= 15 ? 1 : 16);
      inicio.setHours(0, 0, 0, 0);
    }
    if (p === 'mes')  { inicio.setDate(1);        inicio.setHours(0, 0, 0, 0); }
    if (p === 'anio') { inicio.setMonth(0, 1);    inicio.setHours(0, 0, 0, 0); }
    return {
      desde: inicio.toISOString().slice(0, 19).replace('T', ' '),
      hasta: now.toISOString().slice(0, 19).replace('T', ' '),
    };
  }

  private parseDeptos(raw: any): number[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse(raw) ?? []; } catch { return []; }
  }
}
