import { Injectable, NotFoundException } from '@nestjs/common';
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

  // ═══════════════════════════════════════════════════════════════════════════
  // GANANCIAS POR ORDEN Y RESUMEN — ingreso − costo, separado producto vs técnica
  // Costo desde productos.costo (todos cargados). Líneas sin producto_id → sin costo.
  // ═══════════════════════════════════════════════════════════════════════════

  // Mapa producto_id → { costo, tipo_producto }
  private async mapaCostos(): Promise<Map<number, { costo: number; tipo: string }>> {
    const rows = await this.ds.query(`SELECT id, costo, tipo_producto FROM productos`);
    const m = new Map<number, { costo: number; tipo: string }>();
    for (const r of rows) m.set(Number(r.id), { costo: Number(r.costo ?? 0), tipo: r.tipo_producto ?? '' });
    return m;
  }

  private desgloseLineas(lineas: any[], factorDesc: number, costos: Map<number, { costo: number; tipo: string }>) {
    const detalle: any[] = [];
    for (const l of lineas) {
      const cant = Number(l.cantidad ?? 0);
      if (cant <= 0) continue;
      const nombre = String(l.producto ?? '');
      const esServicio = /^\s*servicio/i.test(nombre)
        || (l.producto_id && costos.get(Number(l.producto_id))?.tipo === 'servicio');
      const ingreso = +(Number(l.precio_unitario ?? l.precio_base ?? 0) * cant * factorDesc).toFixed(2);

      if (esServicio) {
        // TÉCNICAS: no se maneja costo → solo se reporta el ingreso.
        const tecnica = (Array.isArray(l.tecnicas_aplicadas) && l.tecnicas_aplicadas[0]?.nombre)
          || String(l.tecnica ?? '').split(',')[0].trim()
          || nombre.replace(/^\s*servicio\s+de\s+/i, '');
        detalle.push({
          descripcion: `${nombre}${l.descripcion ? ` — ${l.descripcion}` : ''}`.trim(),
          tipo: 'tecnica', bucket: (tecnica || 'SERVICIO').toUpperCase(),
          cantidad: cant, ingreso, aplica_costo: false,
          costo: null, ganancia: null, margen: null, sin_costo: false,
        });
        continue;
      }

      // PRODUCTOS: sí tienen costo en el catálogo → ganancia y margen reales.
      const cRow = l.producto_id ? costos.get(Number(l.producto_id)) : undefined;
      const tieneCosto = cRow != null;
      const costo = tieneCosto ? +(cRow!.costo * cant).toFixed(2) : 0;
      const ganancia = +(ingreso - costo).toFixed(2);
      detalle.push({
        descripcion: `${nombre}${l.descripcion ? ` — ${l.descripcion}` : ''}`.trim(),
        tipo: 'producto', bucket: nombre.toUpperCase(),
        cantidad: cant, ingreso, costo, ganancia, aplica_costo: true,
        margen: ingreso > 0 ? +(ganancia / ingreso * 100).toFixed(1) : 0,
        sin_costo: !tieneCosto,
      });
    }
    return detalle;
  }

  /** Ganancia de una orden puntual (vista de detalle). */
  async gananciaOrden(ordenId: number): Promise<any> {
    const [o] = await this.ds.query(
      `SELECT o.id, o.numero, o.estado, o.descuento_global_pct, o.lineas_produccion, c.nombre AS cliente
         FROM ordenes_produccion o LEFT JOIN clientes c ON c.id = o.cliente_id WHERE o.id = ?`, [ordenId]);
    if (!o) throw new NotFoundException('Orden no encontrada');
    let lineas: any[];
    try { const raw = o.lineas_produccion; lineas = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []); }
    catch { lineas = []; }
    const costos = await this.mapaCostos();
    const factorDesc = 1 - Math.max(0, Number(o.descuento_global_pct ?? 0)) / 100;
    const detalle = this.desgloseLineas(lineas, factorDesc, costos);
    const prod = detalle.filter(d => d.tipo === 'producto');
    const tec  = detalle.filter(d => d.tipo === 'tecnica');
    const ingresoProd  = +prod.reduce((s, x) => s + x.ingreso, 0).toFixed(2);
    const costoProd    = +prod.reduce((s, x) => s + x.costo, 0).toFixed(2);
    const gananciaProd = +(ingresoProd - costoProd).toFixed(2);
    const ingresoTec   = +tec.reduce((s, x) => s + x.ingreso, 0).toFixed(2);
    return {
      orden_id: o.id, numero: o.numero, cliente: o.cliente, estado: o.estado,
      lineas: detalle,
      total: {
        ingreso: +(ingresoProd + ingresoTec).toFixed(2),
        costo_productos: costoProd,
        ganancia_productos: gananciaProd,
        margen_productos: ingresoProd > 0 ? +(gananciaProd / ingresoProd * 100).toFixed(1) : 0,
        ingreso_tecnicas: ingresoTec,
      },
      alerta_sin_costo: prod.some(d => d.sin_costo),
    };
  }

  /** Resumen general de ganancias en un rango, por producto y por técnica. */
  async gananciaResumen(desde: string, hasta: string, base: 'orden' | 'factura' = 'orden'): Promise<any> {
    const hastaIncl = hasta + ' 23:59:59';
    let ordenes: any[];
    if (base === 'factura') {
      ordenes = await this.ds.query(`
        SELECT DISTINCT o.id, o.descuento_global_pct, o.lineas_produccion
          FROM ordenes_produccion o
         WHERE EXISTS (SELECT 1 FROM facturas f WHERE f.orden_produccion_id = o.id AND f.estado != 'anulada' AND f.fecha_emision BETWEEN ? AND ?)
            OR EXISTS (SELECT 1 FROM factura_ordenes fo JOIN facturas f2 ON f2.id = fo.factura_id WHERE fo.orden_id = o.id AND f2.estado != 'anulada' AND f2.fecha_emision BETWEEN ? AND ?)
      `, [desde, hastaIncl, desde, hastaIncl]);
    } else {
      ordenes = await this.ds.query(`
        SELECT o.id, o.descuento_global_pct, o.lineas_produccion
          FROM ordenes_produccion o
         WHERE o.estado IN ('listo','listo_parcial','entregado') AND COALESCE(o.tiempo_fin, o.creado_en) BETWEEN ? AND ?
      `, [desde, hastaIncl]);
    }
    const costos = await this.mapaCostos();
    const prodMap = new Map<string, { ingreso: number; costo: number; cantidad: number }>();
    const tecMap  = new Map<string, { ingreso: number }>();
    let ordenesContadas = 0, sinCosto = 0;

    for (const o of ordenes) {
      let lineas: any[];
      try { const raw = o.lineas_produccion; lineas = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []); }
      catch { lineas = []; }
      if (!lineas.length) continue;
      ordenesContadas++;
      const factorDesc = 1 - Math.max(0, Number(o.descuento_global_pct ?? 0)) / 100;
      for (const d of this.desgloseLineas(lineas, factorDesc, costos)) {
        if (d.tipo === 'tecnica') {
          const cur = tecMap.get(d.bucket) ?? { ingreso: 0 };
          cur.ingreso += d.ingreso; tecMap.set(d.bucket, cur);
        } else {
          if (d.sin_costo) sinCosto++;
          const cur = prodMap.get(d.bucket) ?? { ingreso: 0, costo: 0, cantidad: 0 };
          cur.ingreso += d.ingreso; cur.costo += d.costo; cur.cantidad += d.cantidad; prodMap.set(d.bucket, cur);
        }
      }
    }

    // Productos → con costo, ganancia y margen. Técnicas → solo ingreso.
    const productos = [...prodMap.entries()].map(([nombre, v]) => {
      const ganancia = +(v.ingreso - v.costo).toFixed(2);
      return { nombre, ingreso: +v.ingreso.toFixed(2), costo: +v.costo.toFixed(2), ganancia, cantidad: v.cantidad,
        margen: v.ingreso > 0 ? +(ganancia / v.ingreso * 100).toFixed(1) : 0 };
    }).sort((a, b) => b.ganancia - a.ganancia);

    const tecnicas = [...tecMap.entries()].map(([nombre, v]) => ({ nombre, ingreso: +v.ingreso.toFixed(2) }))
      .sort((a, b) => b.ingreso - a.ingreso);

    const ingresoProd  = +productos.reduce((s, x) => s + x.ingreso, 0).toFixed(2);
    const costoProd    = +productos.reduce((s, x) => s + x.costo, 0).toFixed(2);
    const gananciaProd = +(ingresoProd - costoProd).toFixed(2);
    const ingresoTec   = +tecnicas.reduce((s, x) => s + x.ingreso, 0).toFixed(2);

    return {
      rango: { desde, hasta }, base, ordenes: ordenesContadas,
      total: {
        ingreso: +(ingresoProd + ingresoTec).toFixed(2),
        ingreso_productos: ingresoProd,
        costo_productos: costoProd,
        ganancia_productos: gananciaProd,
        margen_productos: ingresoProd > 0 ? +(gananciaProd / ingresoProd * 100).toFixed(1) : 0,
        ingreso_tecnicas: ingresoTec,
      },
      productos, tecnicas, lineas_sin_costo: sinCosto,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORTE MENSUAL — panel ejecutivo del mes (portado de dist a fuente)
  // ═══════════════════════════════════════════════════════════════════════════
  async reporteMensual(mes?: string): Promise<any> {
    const ahora = new Date();
    let yyyymm = mes;
    if (!yyyymm || !/^\d{4}-\d{2}$/.test(yyyymm)) {
      yyyymm = ahora.getFullYear() + '-' + String(ahora.getMonth() + 1).padStart(2, '0');
    }
    const [y, m] = yyyymm.split('-').map(Number);
    const desde = `${y}-${String(m).padStart(2, '0')}-01`;
    const ultimo = new Date(y, m, 0).getDate();
    const hasta = `${y}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
    const hastaInclusive = hasta + ' 23:59:59';

    const [vol] = await this.ds.query(`
      SELECT
        (SELECT COUNT(*) FROM cotizaciones WHERE creado_en BETWEEN ? AND ?) AS cotizaciones,
        (SELECT COUNT(*) FROM ordenes_produccion WHERE creado_en BETWEEN ? AND ?) AS ordenes,
        (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado != 'anulada') AS facturas_emitidas,
        (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado = 'anulada') AS facturas_anuladas,
        (SELECT COUNT(*) FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?) AS recibos,
        (SELECT COUNT(*) FROM clientes WHERE creado_en BETWEEN ? AND ?) AS clientes_nuevos,
        (SELECT COUNT(*) FROM gastos WHERE fecha BETWEEN ? AND ?) AS gastos
    `, [desde,hastaInclusive, desde,hastaInclusive, desde,hastaInclusive, desde,hastaInclusive, desde,hasta, desde,hastaInclusive, desde,hasta]);

    const [conv] = await this.ds.query(`
      SELECT
        (SELECT COUNT(*) FROM cotizaciones WHERE creado_en BETWEEN ? AND ?) AS total,
        (SELECT COUNT(*) FROM cotizaciones c JOIN ordenes_produccion o ON o.cotizacion_id = c.id WHERE c.creado_en BETWEEN ? AND ?) AS con_orden,
        (SELECT COUNT(*) FROM cotizaciones c JOIN ordenes_produccion o ON o.cotizacion_id = c.id JOIN facturas f ON f.orden_produccion_id = o.id AND f.estado != 'anulada' WHERE c.creado_en BETWEEN ? AND ?) AS con_factura
    `, [desde,hastaInclusive, desde,hastaInclusive, desde,hastaInclusive]);

    const [ing] = await this.ds.query(`
      SELECT
        ROUND(COALESCE(SUM(monto),0),2) AS total,
        COUNT(*) AS recibos,
        ROUND(COALESCE(SUM(IF(metodo='efectivo',monto,0)),0),2) AS efectivo,
        ROUND(COALESCE(SUM(IF(metodo='transferencia',monto,0)),0),2) AS transferencia,
        ROUND(COALESCE(SUM(IF(metodo='tarjeta',monto,0)),0),2) AS tarjeta,
        ROUND(COALESCE(SUM(IF(metodo='cheque',monto,0)),0),2) AS cheque
      FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?
    `, [desde, hasta]);

    const [saldo] = await this.ds.query(`
      SELECT ROUND(COALESCE(SUM(total - total_pagado),0),2) AS monto, COUNT(*) AS facturas
      FROM facturas WHERE estado IN ('emitida','parcial','credito') AND fecha_emision <= ?
    `, [hastaInclusive]);

    const [credMes] = await this.ds.query(`
      SELECT ROUND(COALESCE(SUM(total),0),2) AS monto, COUNT(*) AS facturas
      FROM facturas WHERE estado != 'anulada' AND metodo_pago = 'credito' AND fecha_emision BETWEEN ? AND ?
    `, [desde, hastaInclusive]);

    const estados = await this.ds.query(`
      SELECT estado, COUNT(*) AS cant FROM ordenes_produccion
      WHERE creado_en BETWEEN ? AND ? GROUP BY estado ORDER BY cant DESC
    `, [desde, hastaInclusive]);

    const [tiempo] = await this.ds.query(`
      SELECT ROUND(AVG(TIMESTAMPDIFF(DAY, c.creado_en, o.fecha_hora_entrega)),1) AS dias, COUNT(*) AS ordenes
      FROM ordenes_produccion o JOIN cotizaciones c ON c.id = o.cotizacion_id
      WHERE o.estado IN ('listo','entregado') AND c.creado_en BETWEEN ? AND ? AND o.fecha_hora_entrega IS NOT NULL
    `, [desde, hastaInclusive]);

    const [atras] = await this.ds.query(`
      SELECT COUNT(*) AS cant FROM ordenes_produccion
      WHERE estado IN ('pendiente','en_diseno','en_produccion','en_terminacion','atraso')
        AND fecha_comprometida < CURDATE() AND creado_en BETWEEN ? AND ?
    `, [desde, hastaInclusive]);

    const usuarios = await this.ds.query(`
      SELECT u.id, u.nombre, u.rol,
        (SELECT COUNT(*) FROM cotizaciones c WHERE c.creado_por = u.nombre AND c.creado_en BETWEEN ? AND ?) AS cotizaciones,
        (SELECT COUNT(*) FROM recibos_ingreso r WHERE r.creado_por = u.nombre AND r.fecha BETWEEN ? AND ?) AS recibos,
        (SELECT COUNT(*) FROM facturas f WHERE f.creado_por = u.nombre AND f.fecha_emision BETWEEN ? AND ? AND f.estado != 'anulada') AS facturas,
        (SELECT COUNT(*) FROM sesiones_caja s WHERE s.usuario_id = u.id AND s.fecha_apertura BETWEEN ? AND ?) AS sesiones_caja
      FROM usuarios u WHERE u.activo = 1
      HAVING (cotizaciones + recibos + facturas + sesiones_caja) > 0
      ORDER BY recibos DESC, cotizaciones DESC
    `, [desde,hastaInclusive, desde,hasta, desde,hastaInclusive, desde,hastaInclusive]);

    const topClientes = await this.ds.query(`
      SELECT cl.nombre, COUNT(o.id) AS ordenes, ROUND(COALESCE(SUM(cot.total),0),2) AS cotizado
      FROM ordenes_produccion o
      LEFT JOIN cotizaciones cot ON cot.id = o.cotizacion_id
      LEFT JOIN clientes cl ON cl.id = o.cliente_id
      WHERE o.creado_en BETWEEN ? AND ?
      GROUP BY cl.id, cl.nombre HAVING cotizado > 0 ORDER BY cotizado DESC LIMIT 10
    `, [desde, hastaInclusive]);

    const gastos = await this.ds.query(`
      SELECT tipo, COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
      FROM gastos WHERE fecha BETWEEN ? AND ? GROUP BY tipo
    `, [desde, hasta]);

    const porClasificacion = await this.ds.query(`
      SELECT clasificacion_contable AS clasificacion, COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
      FROM gastos WHERE fecha BETWEEN ? AND ? GROUP BY clasificacion_contable
    `, [desde, hasta]);

    const egresosCaja = await this.ds.query(`
      SELECT clasificacion_contable AS clasificacion, COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
      FROM egresos_caja WHERE fecha BETWEEN ? AND ? GROUP BY clasificacion_contable
    `, [desde, hasta]);
    const [totalEgresos] = await this.ds.query(`
      SELECT COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
      FROM egresos_caja WHERE fecha BETWEEN ? AND ?
    `, [desde, hasta]);

    const porCategoria = await this.ds.query(`
      SELECT IFNULL(categoria, 'Sin categoría') AS categoria, clasificacion_contable AS clasificacion,
             COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
      FROM gastos WHERE fecha BETWEEN ? AND ?
      GROUP BY categoria, clasificacion_contable ORDER BY total DESC LIMIT 10
    `, [desde, hasta]);

    const [sesiones] = await this.ds.query(`
      SELECT COUNT(*) AS total,
             SUM(IF(estado='abierta',1,0)) AS abiertas,
             SUM(IF(estado='validada',1,0)) AS validadas,
             SUM(IF(estado='por_validar',1,0)) AS por_validar
      FROM sesiones_caja WHERE fecha_apertura BETWEEN ? AND ?
    `, [desde, hastaInclusive]);

    const topProductos = await this.ds.query(`
      SELECT COALESCE(p.nombre, UPPER(TRIM(SUBSTRING_INDEX(fl.descripcion, ' — ', 1)))) AS nombre,
             MAX(p.id) AS producto_id, COALESCE(MAX(p.tipo_producto), 'sin_clasificar') AS tipo,
             SUM(fl.cantidad) AS cantidad, ROUND(SUM(fl.subtotal), 2) AS monto
      FROM factura_lineas fl
      LEFT JOIN productos p ON p.id = fl.producto_id
      LEFT JOIN facturas f ON f.id = fl.factura_id
      WHERE f.fecha_emision BETWEEN ? AND ? AND f.estado != 'anulada'
        AND (p.tipo_producto IN ('fisico_fabricado','fisico_comprado') OR (p.id IS NULL AND UPPER(fl.descripcion) NOT LIKE 'SERVICIO%'))
      GROUP BY COALESCE(p.nombre, UPPER(TRIM(SUBSTRING_INDEX(fl.descripcion, ' — ', 1))))
      HAVING monto > 0 ORDER BY monto DESC LIMIT 10
    `, [desde, hastaInclusive]);

    const topServicios = await this.ds.query(`
      SELECT COALESCE(p.nombre, UPPER(TRIM(SUBSTRING_INDEX(fl.descripcion, ' — ', 1)))) AS nombre,
             MAX(p.id) AS producto_id, SUM(fl.cantidad) AS cantidad, ROUND(SUM(fl.subtotal), 2) AS monto
      FROM factura_lineas fl
      LEFT JOIN productos p ON p.id = fl.producto_id
      LEFT JOIN facturas f ON f.id = fl.factura_id
      WHERE f.fecha_emision BETWEEN ? AND ? AND f.estado != 'anulada'
        AND (p.tipo_producto = 'servicio' OR (p.id IS NULL AND UPPER(fl.descripcion) LIKE 'SERVICIO%'))
      GROUP BY COALESCE(p.nombre, UPPER(TRIM(SUBSTRING_INDEX(fl.descripcion, ' — ', 1))))
      HAVING monto > 0 ORDER BY monto DESC LIMIT 10
    `, [desde, hastaInclusive]);

    const operariosVolumen = await this.ds.query(`
      SELECT g.nombre, g.departamento, SUM(g.piezas_ok) AS piezas_ok,
             SUM(g.piezas_retrabajo) AS piezas_retrabajo, SUM(g.piezas_descarte) AS piezas_descarte,
             COUNT(*) AS lotes_completados
      FROM (
        SELECT REGEXP_REPLACE(TRIM(l.responsable), ' +', ' ') AS nombre, l.departamento, l.orden_id,
               MAX(l.piezas_ok * COALESCE(l.aplicaciones_por_pieza, 1)) AS piezas_ok,
               MAX(l.piezas_retrabajo) AS piezas_retrabajo, MAX(l.piezas_descarte) AS piezas_descarte
        FROM lotes_produccion l
        WHERE l.estado = 'completado' AND DATE(l.tiempo_fin) BETWEEN ? AND ? AND l.responsable IS NOT NULL
        GROUP BY REGEXP_REPLACE(TRIM(l.responsable), ' +', ' '), l.departamento, l.orden_id, l.producto
      ) g
      GROUP BY g.nombre, g.departamento HAVING piezas_ok > 0 ORDER BY piezas_ok DESC LIMIT 10
    `, [desde, hasta]);

    const operariosEficiencia = await this.ds.query(`
      SELECT g.nombre, g.departamento, SUM(g.piezas_ok) AS piezas_ok,
             SUM(g.piezas_ok + g.piezas_retrabajo + g.piezas_descarte) AS total_procesadas,
             ROUND(100.0 * SUM(g.piezas_ok) / NULLIF(SUM(g.piezas_ok + g.piezas_retrabajo + g.piezas_descarte), 0), 1) AS pct_eficiencia
      FROM (
        SELECT REGEXP_REPLACE(TRIM(l.responsable), ' +', ' ') AS nombre, l.departamento, l.orden_id,
               MAX(l.piezas_ok * COALESCE(l.aplicaciones_por_pieza, 1)) AS piezas_ok,
               MAX(l.piezas_retrabajo) AS piezas_retrabajo, MAX(l.piezas_descarte) AS piezas_descarte
        FROM lotes_produccion l
        WHERE l.estado = 'completado' AND DATE(l.tiempo_fin) BETWEEN ? AND ? AND l.responsable IS NOT NULL
        GROUP BY REGEXP_REPLACE(TRIM(l.responsable), ' +', ' '), l.departamento, l.orden_id, l.producto
      ) g
      GROUP BY g.nombre, g.departamento HAVING total_procesadas >= 5 ORDER BY pct_eficiencia DESC, piezas_ok DESC LIMIT 10
    `, [desde, hasta]);

    const operariosVelocidad: any[] = [];

    const fechaAnt = new Date(y, m - 2, 1);
    const yAnt = fechaAnt.getFullYear();
    const mAnt = fechaAnt.getMonth() + 1;
    const desdeAnt = yAnt + '-' + String(mAnt).padStart(2, '0') + '-01';
    const ultimoAnt = new Date(yAnt, mAnt, 0).getDate();
    const hastaAnt = yAnt + '-' + String(mAnt).padStart(2, '0') + '-' + String(ultimoAnt).padStart(2, '0');
    const hastaAntIncl = hastaAnt + ' 23:59:59';

    const [comparacion] = await this.ds.query(`
      SELECT
        (SELECT ROUND(COALESCE(SUM(monto),0),2) FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?) AS ingresos_ant,
        (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado != 'anulada') AS facturas_ant,
        (SELECT ROUND(COALESCE(SUM(monto),0),2) FROM gastos WHERE fecha BETWEEN ? AND ?) AS gastos_ant,
        (SELECT COUNT(*) FROM ordenes_produccion WHERE creado_en BETWEEN ? AND ?) AS ordenes_ant
    `, [desdeAnt, hastaAnt, desdeAnt, hastaAntIncl, desdeAnt, hastaAnt, desdeAnt, hastaAntIncl]);

    const [huerfanos] = await this.ds.query(`
      SELECT
        (SELECT COUNT(*) FROM factura_pagos WHERE sesion_caja_id IS NULL AND fecha BETWEEN ? AND ?) AS factura_pagos,
        (SELECT COUNT(*) FROM recibos_ingreso WHERE sesion_caja_id IS NULL AND fecha BETWEEN ? AND ?) AS recibos
    `, [desde, hasta, desde, hasta]);

    return {
      mes: yyyymm,
      rango: { desde, hasta },
      generado_en: new Date().toISOString(),
      volumen: vol,
      conversion: conv,
      ingresos: ing,
      saldo_pendiente: saldo,
      facturado_credito: { monto: Number(credMes?.monto || 0), facturas: Number(credMes?.facturas || 0) },
      ordenes_por_estado: estados,
      tiempo_entrega: tiempo,
      atrasadas: atras.cant,
      actividad_usuarios: usuarios,
      top_clientes: topClientes,
      gastos: { por_tipo: gastos, por_clasificacion: porClasificacion, por_categoria: porCategoria },
      egresos: { por_clasificacion: egresosCaja, total: totalEgresos },
      sesiones_caja: sesiones,
      pagos_huerfanos: huerfanos,
      top_productos: topProductos,
      top_servicios: topServicios,
      top_operarios: { volumen: operariosVolumen, eficiencia: operariosEficiencia, velocidad: operariosVelocidad },
      comparacion_mes_anterior: {
        ingresos: Number(comparacion?.ingresos_ant || 0),
        facturas: Number(comparacion?.facturas_ant || 0),
        gastos: Number(comparacion?.gastos_ant || 0),
        ordenes: Number(comparacion?.ordenes_ant || 0),
        mes: yAnt + '-' + String(mAnt).padStart(2, '0'),
      },
    };
  }
}
