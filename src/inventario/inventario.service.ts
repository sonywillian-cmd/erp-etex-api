import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Movimiento, TipoMovimiento } from './entities/movimiento.entity';
import { Producto } from '../productos/entities/producto.entity';
import { ReservaInventario } from '../produccion/entities/reserva-inventario.entity';

/**
 * Motivos por los que una pieza sale del almacén sin ser una venta ni una orden
 * de producción. Tipificados a propósito: con texto libre no se puede contar
 * cuánto se pierde por cada causa al final del mes.
 */
export const MOTIVOS_SALIDA = [
  'Muestra a cliente',
  'Uso interno',
  'Obsequio',
  'Devolución a proveedor',
  'Pérdida o extravío',
  'Corrección de conteo',
  'Otro',
];

@Injectable()
export class InventarioService {
  private readonly logger = new Logger('Inventario');
  constructor(
    @InjectRepository(Movimiento)        private repo: Repository<Movimiento>,
    @InjectRepository(Producto)          private prodRepo: Repository<Producto>,
    @InjectRepository(ReservaInventario) private reservasRepo: Repository<ReservaInventario>,
    @InjectDataSource() private ds: DataSource,
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
        p.categoria,
        COALESCE(r.total_reservado, 0)                                             AS stock_reservado,
        GREATEST(0, COALESCE(p.stock_actual, 0) - COALESCE(r.total_reservado, 0)) AS stock_disponible,
        -- Separado para órdenes abiertas: ya salió del stock, pero sigue en la casa
        COALESCE(sp.total_separado, 0)                                             AS stock_separado
      FROM productos p
      LEFT JOIN (
        SELECT producto_id, SUM(cantidad_reservada) AS total_reservado
        FROM reservas_inventario
        -- Lo separado desde el 13-sep-2026 ya salió del stock; solo se restan
        -- reservas viejas que todavía no se descontaron.
        WHERE estado = 'activa' AND descontada = 0
        GROUP BY producto_id
      ) r ON r.producto_id = p.id
      LEFT JOIN (
        SELECT producto_id, SUM(cantidad_reservada) AS total_separado
        FROM reservas_inventario WHERE estado = 'activa' AND descontada = 1
        GROUP BY producto_id
      ) sp ON sp.producto_id = p.id
      WHERE p.tipo_producto != 'servicio'
      ORDER BY p.nombre ASC
    `);
    return rows.map(r => ({
      ...r,
      stock_actual:      Number(r.stock_actual),
      stock_minimo:      Number(r.stock_minimo),
      stock_reservado:   Number(r.stock_reservado),
      stock_disponible:  Number(r.stock_disponible),
      stock_separado:    Number(r.stock_separado ?? 0),
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
        p.categoria,
        vp.id   AS variante_id,
        vp.sku  AS variante_sku,
        vp.atributos,
        COALESCE(vp.stock_actual, 0)   AS stock_actual,
        vp.stock_minimo                AS stock_minimo,
        -- Reservas viejas que siguen en el almacén con dueño. Lo separado desde el
        -- 13-sep-2026 ya salió del stock y no se resta otra vez.
        COALESCE((SELECT SUM(r.cantidad_reservada) FROM reservas_inventario r
                   WHERE r.variante_id = vp.id AND r.estado = 'activa' AND r.descontada = 0), 0) AS stock_reservado,
        -- Separado para órdenes abiertas: salió del stock al separarse, sigue en la casa
        COALESCE((SELECT SUM(r.cantidad_reservada) FROM reservas_inventario r
                   WHERE r.variante_id = vp.id AND r.estado = 'activa' AND r.descontada = 1), 0) AS stock_separado
      FROM variantes_producto vp
      JOIN productos p ON p.id = vp.producto_id
      WHERE vp.activo = 1 AND p.tipo_producto != 'servicio'
      ORDER BY p.nombre ASC, vp.id ASC
    `);
    return rows.map(r => {
      const stock     = Number(r.stock_actual);
      const reservado = Number(r.stock_reservado ?? 0);
      return {
        ...r,
        stock_actual:     stock,
        stock_reservado:  reservado,
        stock_separado:   Number(r.stock_separado ?? 0),
        // Lo que de verdad se puede prometer a un cliente nuevo.
        stock_disponible: Math.max(0, stock - reservado),
        stock_minimo:  r.stock_minimo !== null ? Number(r.stock_minimo) : null,
        bajo_minimo:   r.stock_minimo !== null && stock < Number(r.stock_minimo),
        atributos: typeof r.atributos === 'string' ? JSON.parse(r.atributos) : (r.atributos ?? {}),
      };
    });
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
        -- El nombre del cliente vive en la tabla clientes; la orden solo guarda cliente_id.
        cl.nombre                AS cliente_nombre,
        op.fecha_comprometida,
        op.estado                AS estado_orden,
        op.estado_produccion,
        ri.id                    AS reserva_id,
        ri.producto_id,
        ri.producto_nombre,
        ri.variante_id,
        ri.variante_label,
        vp.atributos             AS variante_atributos,
        ri.cantidad_reservada,
        ri.estado                AS estado_reserva
      FROM reservas_inventario ri
      INNER JOIN ordenes_produccion op ON op.id = ri.orden_id
      LEFT  JOIN clientes cl ON cl.id = op.cliente_id
      LEFT  JOIN variantes_producto vp ON vp.id = ri.variante_id
      WHERE ri.estado IN ('activa','consumida')
      ORDER BY op.fecha_comprometida ASC, op.id ASC, ri.producto_nombre ASC, ri.variante_label ASC
    `);

    // Sin talla y color, "CAMISETA ALGODON ×3" no dice qué percha buscar
    // (13-sep-2026). Las reservas viejas no guardaban la etiqueta: se arma con
    // los atributos de la variante.
    for (const r of rows) {
      if (!r.variante_label && r.variante_atributos) {
        try {
          const a = typeof r.variante_atributos === 'string' ? JSON.parse(r.variante_atributos) : r.variante_atributos;
          r.variante_label = Object.values(a ?? {}).map(v => String(v).trim()).filter(Boolean).join(' / ') || null;
        } catch { /* sin etiqueta */ }
      }
    }

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
        variante_id:        r.variante_id ?? null,
        variante_label:     r.variante_label ?? null,
        cantidad_reservada: Number(r.cantidad_reservada),
        estado_reserva:     r.estado_reserva,
      });
    }
    const por_orden = Array.from(ordenMap.values());

    // ── Por producto y variante ──────────────────────────────────────────────
    const prodMap = new Map<string, any>();
    const ordenesPorClave = new Map<string, { activas: Set<number>; consumidas: Set<number> }>();
    for (const r of rows) {
      const pid = `${r.producto_id}-${r.variante_id ?? 0}`;
      if (!prodMap.has(pid)) {
        ordenesPorClave.set(pid, { activas: new Set(), consumidas: new Set() });
        prodMap.set(pid, {
          clave:                pid,
          producto_id:          r.producto_id,
          producto_nombre:      r.producto_nombre,
          variante_id:          r.variante_id ?? null,
          variante_label:       r.variante_label ?? null,
          cantidad_activa:      0,
          cantidad_consumida:   0,
          ordenes_activas:      0,
          ordenes_consumidas:   0,
        });
      }
      const p = prodMap.get(pid);
      // Una orden puede tener dos filas de la misma talla y color: se cuenta una vez.
      const ords = ordenesPorClave.get(pid)!;
      if (r.estado_reserva === 'activa') {
        p.cantidad_activa += Number(r.cantidad_reservada);
        ords.activas.add(r.orden_id);
        p.ordenes_activas = ords.activas.size;
      } else {
        p.cantidad_consumida += Number(r.cantidad_reservada);
        ords.consumidas.add(r.orden_id);
        p.ordenes_consumidas = ords.consumidas.size;
      }
    }
    const por_producto = Array.from(prodMap.values())
      .sort((a, b) => String(a.producto_nombre).localeCompare(String(b.producto_nombre))
                   || String(a.variante_label ?? '').localeCompare(String(b.variante_label ?? '')));

    // ── Resumen ──────────────────────────────────────────────────────────────
    const ordenes_activas    = por_orden.filter(o => o.productos.some((p: any) => p.estado_reserva === 'activa')).length;
    const items_activos      = rows.filter(r => r.estado_reserva === 'activa').reduce((s: number, r: any) => s + Number(r.cantidad_reservada), 0);
    const productos_separados = new Set(por_producto.filter(p => p.cantidad_activa > 0).map(p => p.producto_id)).size;

    return { resumen: { ordenes_activas, items_activos, productos_separados }, por_orden, por_producto };
  }

  // ── Registro manual ────────────────────────────────────────────────────────
  /**
   * Aplica UN movimiento: guarda el asiento y mueve la existencia.
   *
   * Dos cuidados que costaron un descuadre real (10-sep-2026, POLOSHIRT EN PIQUE:
   * 103 piezas digitadas, 14 contabilizadas y ninguna variante actualizada):
   *
   *  1. Si el movimiento trae variante, la variante TAMBIEN se mueve. Antes solo
   *     se tocaba el producto, asi que la existencia quedaba en el total sin poder
   *     decir de que color ni de que talla era.
   *  2. La suma se hace en SQL (stock = stock + delta), no leyendo el valor a
   *     memoria y reescribiendolo. Con varias peticiones a la vez, la lectura
   *     previa se queda vieja y unas escrituras pisan a las otras.
   */
  private async aplicarMovimiento(
    em: EntityManager,
    data: Partial<Movimiento> & { cantidad: number; producto_id: number; tipo: TipoMovimiento },
  ) {
    if (!data.producto_id) throw new BadRequestException('producto_id es requerido');
    if (!data.cantidad || data.cantidad <= 0) throw new BadRequestException('La cantidad debe ser mayor a 0');

    const [producto] = await em.query(
      `SELECT id, nombre, maneja_inventario FROM productos WHERE id = ?`, [data.producto_id]);
    if (!producto) throw new BadRequestException('Producto no encontrado');
    if (!producto.maneja_inventario) throw new BadRequestException(`${producto.nombre}: este producto no maneja inventario`);

    if (data.variante_id) {
      let [v] = await em.query(
        `SELECT id, producto_id FROM variantes_producto WHERE id = ?`, [data.variante_id]);

      // Editar un producto borra sus variantes y las recrea con ids nuevos. Quien
      // tuviera la pantalla abierta manda ids que ya no existen y perdería todo lo
      // digitado. Si la variante vieja tiene equivalente (mismo SKU, mismo
      // producto), se redirige sola en vez de tumbar el guardado.
      if (!v) {
        const [eq] = await em.query(
          `SELECT r.id_nuevo, v.producto_id
             FROM variantes_reemplazadas r
             JOIN variantes_producto v ON v.id = r.id_nuevo
            WHERE r.id_viejo = ? AND v.producto_id = ?`,
          [data.variante_id, data.producto_id]);
        if (eq) {
          this.logger.log(`Variante ${data.variante_id} reemplazada por ${eq.id_nuevo} (${producto.nombre})`);
          data = { ...data, variante_id: Number(eq.id_nuevo) };
          v = { id: Number(eq.id_nuevo), producto_id: Number(eq.producto_id) };
        }
      }

      if (!v) throw new BadRequestException(
        `${producto.nombre}: sus colores y tallas cambiaron mientras llenabas esta pantalla. ` +
        `Recarga la página (Ctrl+Shift+R) y vuelve a digitar; no se guardó nada.`);
      if (Number(v.producto_id) !== Number(data.producto_id))
        throw new BadRequestException(
          `La talla y color seleccionados no son de ${producto.nombre}. ` +
          `Recarga la página (Ctrl+Shift+R) y vuelve a intentarlo.`);
    }

    const m = em.create(Movimiento, data);
    await em.save(Movimiento, m);

    const delta = data.tipo === TipoMovimiento.SALIDA ? -data.cantidad : data.cantidad;
    await em.query(
      `UPDATE productos SET stock_actual = GREATEST(0, COALESCE(stock_actual, 0) + ?) WHERE id = ?`,
      [delta, data.producto_id]);
    if (data.variante_id) {
      await em.query(
        `UPDATE variantes_producto SET stock_actual = GREATEST(0, COALESCE(stock_actual, 0) + ?) WHERE id = ?`,
        [delta, data.variante_id]);
    }

    const [p] = await em.query(`SELECT stock_actual FROM productos WHERE id = ?`, [data.producto_id]);
    return { ...m, stock_resultante: Number(p?.stock_actual ?? 0) };
  }

  async registrar(data: Partial<Movimiento> & { cantidad: number; producto_id: number; tipo: TipoMovimiento }) {
    return this.ds.transaction(em => this.aplicarMovimiento(em, data));
  }

  /**
   * Salida manual con destino: la pieza sale del almacén y queda dicho POR QUÉ y
   * PARA QUÉ orden. El ajuste de inventario a secas solo cambiaba el número y
   * dejaba la razón en un texto libre, así que al mes siguiente nadie sabía si
   * aquellas piezas se dañaron, se regalaron o nunca estuvieron.
   *
   * Los daños de producción NO entran por aquí: tienen su propio circuito con
   * reporte y aprobación (módulo de daños), que además aparta la reposición.
   */
  async salidaManual(body: {
    producto_id: number;
    variante_id?: number | null;
    cantidad: number;
    motivo: string;
    orden_id?: number | null;
    comentario?: string;
    usuario_id?: number;
    usuario_nombre?: string;
  }) {
    const motivo = String(body?.motivo ?? '').trim();
    if (!MOTIVOS_SALIDA.includes(motivo))
      throw new BadRequestException(`Motivo no válido. Usa uno de: ${MOTIVOS_SALIDA.join(', ')}`);
    if (!body?.cantidad || Number(body.cantidad) <= 0)
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    if (motivo === 'Otro' && (body.comentario ?? '').trim().length < 4)
      throw new BadRequestException('Con el motivo "Otro" hay que escribir qué pasó.');

    return this.ds.transaction(async em => {
      // La orden, si se indicó, se guarda por su número: es lo que se lee después.
      let referencia: string | undefined;
      if (body.orden_id) {
        const [o] = await em.query(
          `SELECT numero FROM ordenes_produccion WHERE id = ?`, [body.orden_id]);
        if (!o) throw new BadRequestException('La orden indicada no existe.');
        referencia = o.numero;
      }

      // Aviso, no bloqueo: el conteo físico manda sobre lo que diga el sistema.
      const [ex] = await em.query(
        body.variante_id
          ? `SELECT COALESCE(stock_actual,0) AS s FROM variantes_producto WHERE id = ?`
          : `SELECT COALESCE(stock_actual,0) AS s FROM productos WHERE id = ?`,
        [body.variante_id ?? body.producto_id]);
      const existencia = Number(ex?.s ?? 0);

      const nota = [motivo, (body.comentario ?? '').trim(), body.usuario_nombre]
        .filter(Boolean).join(' · ');

      const mov = await this.aplicarMovimiento(em, {
        producto_id: body.producto_id,
        variante_id: body.variante_id ?? undefined,
        tipo:        TipoMovimiento.SALIDA,
        cantidad:    Number(body.cantidad),
        referencia,
        nota,
        usuario_id:  body.usuario_id,
      } as any);

      return {
        ...mov,
        motivo,
        orden: referencia ?? null,
        dejaba_en_negativo: existencia < Number(body.cantidad),
        existencia_previa: existencia,
      };
    });
  }

  /**
   * Ajuste de varias variantes de un mismo producto en UNA sola operacion.
   * La pantalla de inventario mandaba una peticion por variante y las disparaba
   * todas a la vez; aqui entran juntas, en una transaccion: o cuadra todo o no
   * se toca nada.
   */
  async ajusteLote(body: {
    producto_id: number;
    referencia?: string;
    nota?: string;
    usuario_id?: number;
    lineas: { variante_id?: number | null; tipo: TipoMovimiento; cantidad: number }[];
  }) {
    const lineas = (body?.lineas ?? []).filter(l => Number(l?.cantidad) > 0);
    if (!body?.producto_id) throw new BadRequestException('producto_id es requerido');
    if (!lineas.length) throw new BadRequestException('No hay cantidades que ajustar');

    return this.ds.transaction(async em => {
      const aplicados: any[] = [];
      for (const l of lineas) {
        aplicados.push(await this.aplicarMovimiento(em, {
          producto_id: body.producto_id,
          variante_id: l.variante_id ?? undefined,
          tipo:        l.tipo,
          cantidad:    Number(l.cantidad),
          referencia:  body.referencia,
          nota:        body.nota,
          usuario_id:  body.usuario_id,
        } as any));
      }
      const [p] = await em.query(
        `SELECT stock_actual FROM productos WHERE id = ?`, [body.producto_id]);
      const [v] = await em.query(
        `SELECT COALESCE(SUM(stock_actual), 0) AS suma FROM variantes_producto WHERE producto_id = ?`,
        [body.producto_id]);
      return {
        movimientos: aplicados.length,
        piezas: lineas.reduce((a, l) => a + (l.tipo === TipoMovimiento.SALIDA ? -1 : 1) * Number(l.cantidad), 0),
        stock_producto:  Number(p?.stock_actual ?? 0),
        stock_variantes: Number(v?.suma ?? 0),
      };
    });
  }
}
