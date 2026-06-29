import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Cotizacion, EstadoCotizacion } from './entities/cotizacion.entity';
import { LineaCotizacion } from './entities/linea-cotizacion.entity';
import { VarianteProducto } from '../productos/entities/variante-producto.entity';

@Injectable()
export class CotizacionesService {
  constructor(
    @InjectRepository(Cotizacion)        private cotRepo: Repository<Cotizacion>,
    @InjectRepository(LineaCotizacion)   private lineaRepo: Repository<LineaCotizacion>,
    @InjectRepository(VarianteProducto)  private varRepo: Repository<VarianteProducto>,
    private ds: DataSource,
  ) {}

  /** Filtra variante_ids inválidos (no existentes en la DB) → los convierte a null */
  private async sanitizeVarianteIds(lineas: Partial<LineaCotizacion>[]): Promise<Partial<LineaCotizacion>[]> {
    const ids = lineas.map(l => l.variante_id).filter((id): id is number => !!id);
    if (ids.length === 0) return lineas;
    const existentes = await this.varRepo.find({ where: { id: In(ids) }, select: ['id'] });
    const validSet = new Set(existentes.map(v => v.id));
    return lineas.map(l => ({
      ...l,
      variante_id: l.variante_id && validSet.has(l.variante_id) ? l.variante_id : null,
    }));
  }

  // ── Generar número correlativo ─────────────────────────────────────────────
  // Recibe el entity-manager de la transacción para SELECT … FOR UPDATE
  // y evitar duplicados cuando dos cotizaciones se crean en paralelo.
  private async nextNumero(em: any): Promise<string> {
    const year   = new Date().getFullYear();
    const [last] = await em.query(
      `SELECT numero FROM cotizaciones WHERE YEAR(creado_en) = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [year],
    ) as { numero: string }[];
    const seq = last ? parseInt(last.numero.split('-').pop()!) + 1 : 1;
    return `COT-${year}-${String(seq).padStart(3, '0')}`;
  }

  // ── Listar cotizaciones ────────────────────────────────────────────────────
  async findAll(q?: { search?: string; estado?: string; cliente_id?: string }) {
    const qb = this.cotRepo.createQueryBuilder('c')
      .leftJoin('clientes',           'cl', 'cl.id = c.cliente_id')
      .leftJoin('usuarios',           'u',  'u.id = c.vendedor_id')
      .leftJoin('ordenes_produccion', 'op', 'op.cotizacion_id = c.id')
      .addSelect('cl.nombre',    'cl_nombre')
      .addSelect('cl.documento', 'cl_documento')
      .addSelect('u.nombre',     'u_nombre')
      .addSelect('op.id',        'op_id')
      .addSelect('op.numero',    'op_numero')
      .addSelect('op.estado',    'op_estado')
      .orderBy('c.creado_en', 'DESC');
    if (q?.search)     qb.andWhere('(c.numero LIKE :s OR c.referencia LIKE :s OR cl.nombre LIKE :s)', { s: `%${q.search}%` });
    if (q?.estado)     qb.andWhere('c.estado = :estado', { estado: q.estado });
    if (q?.cliente_id) qb.andWhere('c.cliente_id = :cid', { cid: q.cliente_id });
    const { entities, raw } = await qb.getRawAndEntities();
    return entities.map((e, i) => ({
      ...e,
      cliente_nombre:    raw[i]?.cl_nombre  ?? null,
      cliente_documento: raw[i]?.cl_documento ?? null,
      vendedor_nombre:   raw[i]?.u_nombre   ?? null,
      op_id:             raw[i]?.op_id      ?? null,
      op_numero:         raw[i]?.op_numero  ?? null,
      op_estado:         raw[i]?.op_estado  ?? null,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORIAL DE VENTAS — server-side: filtros + paginación + stats + insights
  //
  // "Venta" = orden ENTREGADA o con factura real (no proforma/anulada).
  // Fecha de venta = fecha factura → fecha entrega → fecha comprometida → creado.
  // Resuelve precisión (incluye facturadas no-entregadas, fecha correcta),
  // rendimiento (todo agregado en SQL) e insights (top clientes/productos/vendedor).
  // ═══════════════════════════════════════════════════════════════════════════
  async historialVentas(p: {
    desde?: string; hasta?: string; q?: string;
    vendedor?: string; cliente_id?: string; estado_pago?: string;
    sort?: string; dir?: string; page?: string; pageSize?: string;
  }) {
    // ── Filtros dinámicos sobre la subquery base ──
    const where: string[] = ['(op.estado = "entregado" OR f.id IS NOT NULL)'];
    const params: any[] = [];

    if (p.desde) { where.push('DATE(COALESCE(f.fecha_emision, op.fecha_hora_entrega, op.fecha_comprometida, c.creado_en)) >= ?'); params.push(p.desde); }
    if (p.hasta) { where.push('DATE(COALESCE(f.fecha_emision, op.fecha_hora_entrega, op.fecha_comprometida, c.creado_en)) <= ?'); params.push(p.hasta); }
    if (p.q)     { where.push('(c.numero LIKE ? OR op.numero LIKE ? OR cl.nombre LIKE ? OR u.nombre LIKE ?)'); const s = `%${p.q}%`; params.push(s, s, s, s); }
    if (p.vendedor)   { where.push('u.nombre = ?'); params.push(p.vendedor); }
    if (p.cliente_id) { where.push('c.cliente_id = ?'); params.push(Number(p.cliente_id)); }
    if (p.estado_pago) {
      if (p.estado_pago === 'pagada')      where.push('(f.id IS NOT NULL AND f.total_pagado >= f.total AND f.total > 0)');
      else if (p.estado_pago === 'parcial')where.push('(f.id IS NOT NULL AND f.total_pagado > 0 AND f.total_pagado < f.total)');
      else if (p.estado_pago === 'emitida')where.push('(f.id IS NOT NULL AND f.total_pagado = 0)');
      else if (p.estado_pago === 'sin_factura') where.push('f.id IS NULL');
    }
    const W = where.join(' AND ');

    // Base: una fila por venta (cotización entregada/facturada)
    const BASE = `
      FROM cotizaciones c
      JOIN ordenes_produccion op ON op.cotizacion_id = c.id
      LEFT JOIN facturas f ON f.orden_produccion_id = op.id AND f.estado != 'anulada' AND f.tipo_ncf != 'PROFORMA'
      LEFT JOIN clientes cl ON cl.id = c.cliente_id
      LEFT JOIN usuarios u  ON u.id  = c.vendedor_id
      WHERE ${W}
    `;

    // ── Ordenamiento seguro (whitelist) ──
    const sortCol: Record<string, string> = {
      fecha:   'fecha_venta',
      total:   'c.total',
      cliente: 'cl.nombre',
      orden:   'op.numero',
    };
    const orderBy = sortCol[p.sort ?? 'fecha'] ?? 'fecha_venta';
    const orderDir = (p.dir ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // ── Paginación ──
    const page     = Math.max(1, Number(p.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(p.pageSize ?? 20)));
    const offset   = (page - 1) * pageSize;

    // ── Filas paginadas ──
    const rows = await this.ds.query(`
      SELECT
        c.id AS cotizacion_id, c.numero AS cot_numero, c.total,
        cl.id AS cliente_id, cl.nombre AS cliente_nombre,
        u.nombre AS vendedor_nombre,
        op.id AS op_id, op.numero AS op_numero, op.estado AS op_estado,
        f.id AS factura_id, f.numero AS factura_numero, f.estado AS factura_estado,
        f.total AS factura_total, f.total_pagado,
        COALESCE(f.total, c.total) - COALESCE(f.total_pagado, 0) AS saldo_pendiente,
        COALESCE(f.fecha_emision, op.fecha_hora_entrega, op.fecha_comprometida, c.creado_en) AS fecha_venta
      ${BASE}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);

    // ── Total para paginación ──
    const [{ total: totalRows }] = await this.ds.query(
      `SELECT COUNT(*) AS total ${BASE}`, params);

    // ── Stats globales (sobre TODO el filtro, no solo la página) ──
    const [stats] = await this.ds.query(`
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(c.total), 0) AS total_vendido,
        COALESCE(SUM(COALESCE(f.total_pagado, 0)), 0) AS cobrado,
        COALESCE(SUM(COALESCE(f.total, c.total) - COALESCE(f.total_pagado, 0)), 0) AS pendiente
      ${BASE}
    `, params);

    // ── Top clientes ──
    const topClientes = await this.ds.query(`
      SELECT cl.nombre AS nombre, COUNT(*) AS ventas, COALESCE(SUM(c.total),0) AS total
      ${BASE} AND cl.nombre IS NOT NULL
      GROUP BY cl.id, cl.nombre ORDER BY total DESC LIMIT 5
    `, params);

    // ── Ventas por vendedor ──
    const porVendedor = await this.ds.query(`
      SELECT u.nombre AS nombre, COUNT(*) AS ventas, COALESCE(SUM(c.total),0) AS total
      ${BASE} AND u.nombre IS NOT NULL
      GROUP BY u.id, u.nombre ORDER BY total DESC LIMIT 8
    `, params);

    // ── Piezas producidas por técnica (desde lotes de producción, deduplicado por orden+depto) ──
    // La sublimación/confección casi nunca se cobran como técnica aparte (van en el precio del
    // producto), por eso el conteo se toma de PRODUCCIÓN, no de las líneas de venta.
    const porTecnica = await this.ds.query(`
      SELECT g.departamento AS nombre, SUM(g.piezas) AS piezas
      FROM (
        SELECT orden_id, departamento,
               MAX(piezas_ok * COALESCE(aplicaciones_por_pieza, 1)) AS piezas
        FROM lotes_produccion
        WHERE estado = 'completado'
          -- Solo técnicas que generan ingreso; se excluyen pasos de proceso
          -- (TERMINACION) y de preparación (DISEÑO ...) que no se cobran aparte.
          AND departamento NOT IN ('TERMINACION', 'DISEÑO BORDADO', 'DISEÑO SUBLIMACION')
          AND orden_id IN (SELECT op.id ${BASE})
        GROUP BY orden_id, departamento
      ) g
      GROUP BY g.departamento HAVING piezas > 0 ORDER BY piezas DESC LIMIT 10
    `, params);

    // ── Top productos (desde líneas de las cotizaciones del filtro) ──
    const topProductos = await this.ds.query(`
      SELECT COALESCE(NULLIF(TRIM(p.nombre), ''), NULLIF(TRIM(lc.descripcion), ''), 'Sin nombre') AS producto,
             SUM(lc.cantidad) AS piezas,
             SUM(lc.total_linea) AS monto
      FROM lineas_cotizacion lc
      LEFT JOIN productos p ON p.id = lc.producto_id
      WHERE lc.cotizacion_id IN (SELECT c.id ${BASE})
      GROUP BY producto ORDER BY monto DESC LIMIT 5
    `, params);

    return {
      rows: rows.map((r: any) => ({
        ...r,
        total: Number(r.total),
        factura_total: r.factura_total != null ? Number(r.factura_total) : null,
        total_pagado: r.total_pagado != null ? Number(r.total_pagado) : null,
        saldo_pendiente: Number(r.saldo_pendiente),
      })),
      total: Number(totalRows),
      page, pageSize,
      stats: {
        count:         Number(stats.count),
        total_vendido: Number(stats.total_vendido),
        cobrado:       Number(stats.cobrado),
        pendiente:     Number(stats.pendiente),
      },
      topClientes:  topClientes.map((x: any) => ({ nombre: x.nombre, ventas: Number(x.ventas), total: Number(x.total) })),
      porVendedor:  porVendedor.map((x: any) => ({ nombre: x.nombre, ventas: Number(x.ventas), total: Number(x.total) })),
      porTecnica:   porTecnica.map((x: any) => ({ nombre: x.nombre, piezas: Number(x.piezas) })),
      topProductos: topProductos.map((x: any) => ({ producto: x.producto, piezas: Number(x.piezas), monto: Number(x.monto) })),
    };
  }

  // ── Una cotización con sus líneas (+ nombre cliente + nombre producto + stock) ─
  async findOne(id: number) {
    const { entities: [c], raw: [rawC] } = await this.cotRepo
      .createQueryBuilder('c')
      .leftJoin('clientes', 'cl', 'cl.id = c.cliente_id')
      .addSelect('cl.nombre',          'cl_nombre')
      .addSelect('cl.documento',       'cl_documento')
      .addSelect('cl.telefono',        'cl_telefono')
      .addSelect('cl.email',           'cl_email')
      .addSelect('cl.direccion',       'cl_direccion')
      .addSelect('cl.ciudad',          'cl_ciudad')
      .addSelect('cl.nombre_comercial','cl_nombre_comercial')
      .where('c.id = :id', { id })
      .getRawAndEntities();
    if (!c) throw new NotFoundException(`Cotización #${id} no encontrada`);

    const { entities, raw } = await this.lineaRepo.createQueryBuilder('l')
      .leftJoin('productos', 'p', 'p.id = l.producto_id')
      .addSelect('p.nombre',       'p_nombre')
      .addSelect('p.stock_actual', 'p_stock')
      .where('l.cotizacion_id = :id', { id })
      .orderBy('l.orden', 'ASC')
      .getRawAndEntities();

    const lineas = entities.map((l, i) => ({
      ...l,
      prod_nombre: raw[i]?.p_nombre   ?? null,
      prod_stock:  raw[i]?.p_stock    ?? null,
    }));

    return {
      ...c,
      lineas,
      cliente_nombre:           rawC?.cl_nombre           ?? null,
      cliente_documento:        rawC?.cl_documento        ?? null,
      cliente_telefono:         rawC?.cl_telefono         ?? null,
      cliente_email:            rawC?.cl_email            ?? null,
      cliente_direccion:        rawC?.cl_direccion        ?? null,
      cliente_ciudad:           rawC?.cl_ciudad           ?? null,
      cliente_nombre_comercial: rawC?.cl_nombre_comercial ?? null,
    };
  }

  // ── Crear cotización con líneas ───────────────────────────────────────────
  async create(data: {
    cliente_id: number;
    vendedor_id?: number;
    modo_precio?: string;
    aplica_itbis_global?: boolean;
    referencia?: string;
    fecha_vencimiento?: Date;
    descuento_pct?: number;
    especificaciones?: string;
    creado_por?: string;
    notas?: string;
    terminos?: string;
    lineas: Partial<LineaCotizacion>[];
  }) {
    if (!data.cliente_id || data.cliente_id <= 0) {
      throw new BadRequestException('Debe seleccionar un cliente válido.');
    }
    const lineasSanitizadas = await this.sanitizeVarianteIds(data.lineas);
    return this.ds.transaction(async (em) => {
      const numero = await this.nextNumero(em);

      // Calcular totales
      let subtotal = 0;
      const lineasCalc = lineasSanitizadas.map((l, i) => {
        const base = Number(l.cantidad ?? 1) * Number(l.precio_unitario ?? 0) * (1 - Number(l.descuento_pct ?? 0) / 100);
        const itbis = l.aplica_itbis !== false ? base * (Number(l.porcentaje_itbis ?? 18) / 100) : 0;
        subtotal += base;
        return { ...l, subtotal_linea: base, itbis_monto: itbis, total_linea: base + itbis, orden: i + 1 };
      });

      const descMonto  = subtotal * (Number(data.descuento_pct ?? 0) / 100);
      const baseNet    = subtotal - descMonto;
      const itbisTotal = lineasCalc.reduce((a, l) => a + l.itbis_monto, 0) * (1 - (Number(data.descuento_pct ?? 0) / 100));
      const total      = baseNet + itbisTotal;

      const cot = em.create(Cotizacion, {
        numero,
        cliente_id:          data.cliente_id,
        vendedor_id:         data.vendedor_id,
        modo_precio:         data.modo_precio as any ?? 'bundled',
        aplica_itbis_global: data.aplica_itbis_global ?? true,
        referencia:          data.referencia,
        fecha_vencimiento:   data.fecha_vencimiento,
        descuento_pct:       data.descuento_pct ?? 0,
        subtotal,
        itbis_monto:         itbisTotal,
        total,
        especificaciones:    data.especificaciones,
        creado_por:          data.creado_por,
        notas:               data.notas,
        terminos:            data.terminos,
      });
      const saved = await em.save(Cotizacion, cot);

      const lineasEntities = lineasCalc.map(l =>
        em.create(LineaCotizacion, { ...l, cotizacion_id: saved.id }),
      );
      await em.save(LineaCotizacion, lineasEntities);

      return { ...saved, lineas: lineasEntities };
    });
  }

  // ── Actualizar cotización (lineas + campos) ───────────────────────────────
  async actualizar(id: number, data: {
    cliente_id?: number;
    referencia?: string;
    fecha_vencimiento?: string;
    descuento_pct?: number;
    especificaciones?: string;
    notas?: string;
    terminos?: string;
    lineas: Partial<LineaCotizacion>[];
  }) {
    const c = await this.cotRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException(`Cotización #${id} no encontrada`);
    if (c.estado === EstadoCotizacion.CONVERTIDA) {
      throw new BadRequestException('No se puede editar una cotización ya convertida en orden de producción');
    }

    const lineasSanitizadas = await this.sanitizeVarianteIds(data.lineas ?? []);
    return this.ds.transaction(async (em) => {
      // Recalcular totales con las nuevas líneas
      let subtotal = 0;
      const lineasCalc = lineasSanitizadas.map((l, i) => {
        const base = Number(l.cantidad ?? 1) * Number(l.precio_unitario ?? 0) * (1 - Number(l.descuento_pct ?? 0) / 100);
        const itbis = l.aplica_itbis !== false ? base * (Number(l.porcentaje_itbis ?? 18) / 100) : 0;
        subtotal += base;
        return { ...l, subtotal_linea: base, itbis_monto: itbis, total_linea: base + itbis, orden: i + 1 };
      });

      const descMonto  = subtotal * (Number(data.descuento_pct ?? c.descuento_pct ?? 0) / 100);
      const baseNet    = subtotal - descMonto;
      const itbisTotal = lineasCalc.reduce((a, l) => a + l.itbis_monto, 0) * (1 - (Number(data.descuento_pct ?? c.descuento_pct ?? 0) / 100));
      const total      = baseNet + itbisTotal;

      // Eliminar lineas antiguas y re-insertar
      await em.delete(LineaCotizacion, { cotizacion_id: id });

      const lineasEntities = lineasCalc.map(l =>
        em.create(LineaCotizacion, { ...l, cotizacion_id: id }),
      );
      await em.save(LineaCotizacion, lineasEntities);

      // Actualizar cabecera
      await em.update(Cotizacion, id, {
        ...(data.cliente_id ? { cliente_id: data.cliente_id } : {}),
        referencia:        data.referencia        !== undefined ? data.referencia        : c.referencia,
        fecha_vencimiento: data.fecha_vencimiento ? new Date(data.fecha_vencimiento)    : c.fecha_vencimiento,
        descuento_pct:     data.descuento_pct     !== undefined ? data.descuento_pct    : c.descuento_pct,
        especificaciones:  data.especificaciones  !== undefined ? data.especificaciones  : c.especificaciones,
        notas:             data.notas             !== undefined ? data.notas             : c.notas,
        terminos:          data.terminos          !== undefined ? data.terminos          : c.terminos,
        subtotal,
        itbis_monto:       itbisTotal,
        total,
      });

      return this.findOne(id);
    });
  }

  // ── Cambiar estado ────────────────────────────────────────────────────────
  async cambiarEstado(id: number, estado: EstadoCotizacion) {
    const c = await this.cotRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException(`Cotización #${id} no encontrada`);
    // Una cotización CONVERTIDA no puede cambiar de estado —
    // está ligada a una orden de producción activa.
    if (c.estado === EstadoCotizacion.CONVERTIDA) {
      throw new BadRequestException(
        'Esta cotización ya fue convertida en orden de producción y no puede cambiar de estado.',
      );
    }
    await this.cotRepo.update(id, { estado });
    return this.findOne(id);
  }

  // ── Eliminar ──────────────────────────────────────────────────────────────
  async remove(id: number) {
    const c = await this.cotRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    if (c.estado !== EstadoCotizacion.BORRADOR)
      throw new BadRequestException('Solo se pueden eliminar cotizaciones en borrador');
    await this.lineaRepo.delete({ cotizacion_id: id });
    await this.cotRepo.remove(c);
    return { message: `Cotización #${id} eliminada` };
  }

  // ── Migración: reconstruir descripciones de variantes → "COLOR - TALLA" ─────
  async normalizarDescripcionesVariantes(): Promise<{
    lineas_actualizadas: number;
    ordenes_actualizadas: number;
    detalle: string[];
  }> {
    const log: string[] = [];

    // Helper: extraer color y talla de atributos JSON
    const extraerColorTalla = (atributos: Record<string, string>): string => {
      const keys = Object.keys(atributos);
      const colorKey = keys.find(k => /^colou?re?s?$/i.test(k));
      const tallaKey = keys.find(k => /^tallas?$|^sizes?$|^tama[ñn]os?$|^talle?$/i.test(k));
      const color = colorKey ? atributos[colorKey] : null;
      const talla = tallaKey ? atributos[tallaKey] : null;
      return [color, talla].filter(Boolean).join(' - ');
    };

    // 1. lineas_cotizacion — todas las filas con variante_id
    const lineas = await this.ds.query(
      `SELECT lc.id, lc.descripcion, lc.variante_id, vp.atributos
       FROM lineas_cotizacion lc
       INNER JOIN variantes_producto vp ON vp.id = lc.variante_id
       WHERE lc.variante_id IS NOT NULL`,
    ) as { id: number; descripcion: string; variante_id: number; atributos: any }[];

    let lineasActualizadas = 0;
    for (const row of lineas) {
      try {
        const attrs = typeof row.atributos === 'string' ? JSON.parse(row.atributos) : row.atributos;
        if (!attrs || typeof attrs !== 'object') continue;
        const nueva = extraerColorTalla(attrs);
        if (!nueva || nueva === row.descripcion) continue;
        await this.ds.query(
          `UPDATE lineas_cotizacion SET descripcion = ? WHERE id = ?`,
          [nueva, row.id],
        );
        log.push(`linea #${row.id}: "${row.descripcion}" → "${nueva}"`);
        lineasActualizadas++;
      } catch (e: any) {
        log.push(`linea #${row.id}: ERROR — ${e.message}`);
      }
    }

    // 2. ordenes_produccion — JSON lineas_produccion
    // Obtener mapa de variantes para lookup
    const allVariantes = await this.ds.query(
      `SELECT id, atributos FROM variantes_producto`,
    ) as { id: number; atributos: any }[];
    const varMap = new Map<number, Record<string, string>>();
    for (const v of allVariantes) {
      try {
        const a = typeof v.atributos === 'string' ? JSON.parse(v.atributos) : v.atributos;
        if (a && typeof a === 'object') varMap.set(v.id, a);
      } catch {}
    }

    const ordenes = await this.ds.query(
      `SELECT id, lineas_produccion FROM ordenes_produccion
       WHERE lineas_produccion IS NOT NULL`,
    ) as { id: number; lineas_produccion: any }[];

    let ordenesActualizadas = 0;
    for (const orden of ordenes) {
      try {
        const lineasProd: any[] = typeof orden.lineas_produccion === 'string'
          ? JSON.parse(orden.lineas_produccion)
          : orden.lineas_produccion;
        if (!Array.isArray(lineasProd)) continue;

        let cambio = false;
        const nuevas = lineasProd.map((l: any) => {
          const vid = l.variante_id;
          if (!vid || !varMap.has(vid)) return l;
          const nueva = extraerColorTalla(varMap.get(vid)!);
          if (!nueva || nueva === l.descripcion) return l;
          cambio = true;
          return { ...l, descripcion: nueva };
        });
        if (!cambio) continue;

        await this.ds.query(
          `UPDATE ordenes_produccion SET lineas_produccion = ? WHERE id = ?`,
          [JSON.stringify(nuevas), orden.id],
        );
        log.push(`orden #${orden.id}: lineas_produccion actualizada`);
        ordenesActualizadas++;
      } catch (e: any) {
        log.push(`orden #${orden.id}: ERROR — ${e.message}`);
      }
    }

    return {
      lineas_actualizadas:  lineasActualizadas,
      ordenes_actualizadas: ordenesActualizadas,
      detalle: log,
    };
  }
}
