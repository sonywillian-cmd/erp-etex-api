import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Movimiento, TipoMovimiento } from './entities/movimiento.entity';
import { Producto } from '../productos/entities/producto.entity';
import { ReservaInventario } from '../produccion/entities/reserva-inventario.entity';

@Injectable()
export class InventarioService {
  constructor(
    @InjectRepository(Movimiento)        private repo: Repository<Movimiento>,
    @InjectRepository(Producto)          private prodRepo: Repository<Producto>,
    @InjectRepository(ReservaInventario) private reservasRepo: Repository<ReservaInventario>,
  ) {}

  async findAll(q?: { producto_id?: string; tipo?: string }) {
    const qb = this.repo.createQueryBuilder('m')
      .leftJoin('productos', 'p', 'p.id = m.producto_id')
      .addSelect('p.nombre', 'p_nombre')
      .addSelect('p.sku',    'p_sku')
      .orderBy('m.creado_en', 'DESC');
    if (q?.producto_id) qb.andWhere('m.producto_id = :pid', { pid: q.producto_id });
    if (q?.tipo)        qb.andWhere('m.tipo = :tipo', { tipo: q.tipo });
    const { entities, raw } = await qb.getRawAndEntities();
    return entities.map((e, i) => ({
      ...e,
      producto_nombre: raw[i]?.p_nombre ?? null,
      producto_sku:    raw[i]?.p_sku    ?? null,
    }));
  }

  // ── Stock disponible (producto – reservas activas) ──────────────────────────
  async getStockDisponible() {
    const rows: any[] = await this.prodRepo.query(`
      SELECT
        p.id              AS producto_id,
        p.nombre,
        p.sku,
        COALESCE(p.stock_actual, 0)                                                AS stock_actual,
        COALESCE(p.stock_minimo, 0)                                                AS stock_minimo,
        p.maneja_inventario,
        p.tipo_producto,
        COALESCE(r.total_reservado, 0)                                             AS stock_reservado,
        GREATEST(0, COALESCE(p.stock_actual, 0) - COALESCE(r.total_reservado, 0)) AS stock_disponible
      FROM productos p
      LEFT JOIN (
        SELECT producto_id, SUM(cantidad_reservada) AS total_reservado
        FROM reservas_inventario
        WHERE estado = 'activa'
        GROUP BY producto_id
      ) r ON r.producto_id = p.id
      WHERE p.tipo_producto != 'servicio'
      ORDER BY p.nombre ASC
    `);
    return rows.map(r => ({
      ...r,
      stock_actual:      Number(r.stock_actual),
      stock_minimo:      Number(r.stock_minimo),
      stock_reservado:   Number(r.stock_reservado),
      stock_disponible:  Number(r.stock_disponible),
      maneja_inventario: Boolean(r.maneja_inventario),
    }));
  }

  // ── Stock por variante (talla / color) ─────────────────────────────────────
  async getStockVariantes() {
    const rows: any[] = await this.prodRepo.query(`
      SELECT
        p.id    AS producto_id,
        p.nombre AS producto,
        p.sku   AS producto_sku,
        vp.id   AS variante_id,
        vp.sku  AS variante_sku,
        vp.atributos,
        COALESCE(vp.stock_actual, 0)   AS stock_actual,
        vp.stock_minimo                AS stock_minimo
      FROM variantes_producto vp
      JOIN productos p ON p.id = vp.producto_id
      WHERE vp.activo = 1 AND p.tipo_producto != 'servicio'
      ORDER BY p.nombre ASC, vp.id ASC
    `);
    return rows.map(r => ({
      ...r,
      stock_actual:  Number(r.stock_actual),
      stock_minimo:  r.stock_minimo !== null ? Number(r.stock_minimo) : null,
      bajo_minimo:   r.stock_minimo !== null && Number(r.stock_actual) < Number(r.stock_minimo),
      atributos: typeof r.atributos === 'string' ? JSON.parse(r.atributos) : (r.atributos ?? {}),
    }));
  }

  // ── Reconciliar stock desde movimientos ────────────────────────────────────
  // Recalcula stock_actual de cada producto sumando ENTRADA/ajuste y restando SALIDA
  async reconciliarStock() {
    const productos = await this.prodRepo.find({ where: { maneja_inventario: true } });
    const detalle: { producto: string; stock_anterior: number; stock_nuevo: number; diferencia: number }[] = [];

    for (const p of productos) {
      const [res] = await this.repo.query(
        `SELECT GREATEST(0, COALESCE(SUM(
           CASE WHEN tipo IN ('entrada','ajuste') THEN cantidad
                WHEN tipo = 'salida' THEN -cantidad
                ELSE 0 END
         ), 0)) AS calculado
         FROM movimientos WHERE producto_id = ?`,
        [p.id],
      );
      const stockNuevo    = Number(res?.calculado ?? 0);
      const stockAnterior = Number(p.stock_actual ?? 0);

      if (stockNuevo !== stockAnterior) {
        await this.prodRepo.update(p.id, { stock_actual: stockNuevo });
        detalle.push({
          producto:       p.nombre,
          stock_anterior: stockAnterior,
          stock_nuevo:    stockNuevo,
          diferencia:     stockNuevo - stockAnterior,
        });
      }
    }

    return {
      ok:          true,
      actualizados: detalle.length,
      sin_cambios: productos.length - detalle.length,
      detalle,
    };
  }

  // ── Separados: reservas activas/consumidas agrupadas por orden y producto ──
  async getSeparados() {
    const rows: any[] = await this.prodRepo.query(`
      SELECT
        op.id                    AS orden_id,
        op.numero                AS orden_numero,
        op.cliente_nombre,
        op.fecha_comprometida,
        op.estado                AS estado_orden,
        op.estado_produccion,
        ri.id                    AS reserva_id,
        ri.producto_id,
        ri.producto_nombre,
        ri.cantidad_reservada,
        ri.estado                AS estado_reserva
      FROM reservas_inventario ri
      INNER JOIN ordenes_produccion op ON op.id = ri.orden_id
      WHERE ri.estado IN ('activa','consumida')
      ORDER BY op.fecha_comprometida ASC, op.id ASC, ri.producto_nombre ASC
    `);

    // ── Por orden ────────────────────────────────────────────────────────────
    const ordenMap = new Map<number, any>();
    for (const r of rows) {
      if (!ordenMap.has(r.orden_id)) {
        ordenMap.set(r.orden_id, {
          orden_id:           r.orden_id,
          orden_numero:       r.orden_numero,
          cliente_nombre:     r.cliente_nombre,
          fecha_comprometida: r.fecha_comprometida,
          estado_orden:       r.estado_orden,
          estado_produccion:  r.estado_produccion,
          productos:          [],
        });
      }
      ordenMap.get(r.orden_id).productos.push({
        reserva_id:         r.reserva_id,
        producto_id:        r.producto_id,
        producto_nombre:    r.producto_nombre,
        cantidad_reservada: Number(r.cantidad_reservada),
        estado_reserva:     r.estado_reserva,
      });
    }
    const por_orden = Array.from(ordenMap.values());

    // ── Por producto ─────────────────────────────────────────────────────────
    const prodMap = new Map<number, any>();
    for (const r of rows) {
      const pid = r.producto_id;
      if (!prodMap.has(pid)) {
        prodMap.set(pid, {
          producto_id:          pid,
          producto_nombre:      r.producto_nombre,
          cantidad_activa:      0,
          cantidad_consumida:   0,
          ordenes_activas:      0,
          ordenes_consumidas:   0,
        });
      }
      const p = prodMap.get(pid);
      if (r.estado_reserva === 'activa') {
        p.cantidad_activa += Number(r.cantidad_reservada);
        p.ordenes_activas++;
      } else {
        p.cantidad_consumida += Number(r.cantidad_reservada);
        p.ordenes_consumidas++;
      }
    }
    const por_producto = Array.from(prodMap.values())
      .sort((a, b) => b.cantidad_activa - a.cantidad_activa);

    // ── Resumen ──────────────────────────────────────────────────────────────
    const ordenes_activas    = por_orden.filter(o => o.productos.some((p: any) => p.estado_reserva === 'activa')).length;
    const items_activos      = rows.filter(r => r.estado_reserva === 'activa').reduce((s: number, r: any) => s + Number(r.cantidad_reservada), 0);
    const productos_separados = por_producto.filter(p => p.cantidad_activa > 0).length;

    return { resumen: { ordenes_activas, items_activos, productos_separados }, por_orden, por_producto };
  }

  // ── Registro manual ────────────────────────────────────────────────────────
  async registrar(data: Partial<Movimiento> & { cantidad: number; producto_id: number; tipo: TipoMovimiento }) {
    if (!data.producto_id) throw new BadRequestException('producto_id es requerido');
    if (!data.cantidad || data.cantidad <= 0) throw new BadRequestException('La cantidad debe ser mayor a 0');

    const producto = await this.prodRepo.findOne({ where: { id: data.producto_id } });
    if (!producto) throw new BadRequestException('Producto no encontrado');
    if (!producto.maneja_inventario) throw new BadRequestException('Este producto no maneja inventario');

    const m = this.repo.create(data);
    await this.repo.save(m);

    const delta = data.tipo === TipoMovimiento.SALIDA ? -data.cantidad : data.cantidad;
    const nuevoStock = Math.max(0, (producto.stock_actual ?? 0) + delta);
    await this.prodRepo.update(data.producto_id, { stock_actual: nuevoStock });

    return { ...m, stock_resultante: nuevoStock };
  }
}
