import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrdenCompra, EstadoCompra } from './entities/orden-compra.entity';
import { Producto, TipoProducto } from '../productos/entities/producto.entity';
import { VarianteProducto } from '../productos/entities/variante-producto.entity';
import { Movimiento, TipoMovimiento } from '../inventario/entities/movimiento.entity';
import { MetricasService } from '../metricas/metricas.service';
import { MaterialesOrdenService, PROVEEDOR_PENDIENTE } from '../materiales/materiales-orden.service';

@Injectable()
export class ComprasService {
  constructor(
    @InjectRepository(OrdenCompra)    private repo: Repository<OrdenCompra>,
    @InjectRepository(Producto)       private productoRepo: Repository<Producto>,
    @InjectRepository(VarianteProducto) private varRepo: Repository<VarianteProducto>,
    @InjectRepository(Movimiento)     private movimientoRepo: Repository<Movimiento>,
    private metricasService: MetricasService,
    private materiales: MaterialesOrdenService,
  ) {}

  private async nextNumero(): Promise<string> {
    const year = new Date().getFullYear();
    const last = await this.repo.createQueryBuilder('o')
      .where('YEAR(o.creado_en) = :year', { year })
      .orderBy('o.id', 'DESC').getOne();
    const seq = last ? parseInt(last.numero.split('-').pop()) + 1 : 1;
    return `OC-${year}-${String(seq).padStart(3, '0')}`;
  }

  findAll(q?: { estado?: string; proveedor?: string }) {
    const qb = this.repo.createQueryBuilder('o').orderBy('o.creado_en', 'DESC');
    if (q?.estado)     qb.andWhere('o.estado = :e', { e: q.estado });
    if (q?.proveedor)  qb.andWhere('o.proveedor LIKE :p', { p: `%${q.proveedor}%` });
    return qb.getMany();
  }

  async findOne(id: number) {
    const o = await this.repo.findOne({ where: { id } });
    if (!o) throw new NotFoundException(`Orden #${id} no encontrada`);
    return o;
  }

  async create(data: Partial<OrdenCompra>) {
    const numero = await this.nextNumero();
    const total = (data.lineas ?? []).reduce((a: number, l: any) => a + (Number(l.cantidad) * Number(l.precio_unitario ?? l.costo_unit ?? 0)), 0);
    const o = this.repo.create({ ...data, numero, total });
    return this.repo.save(o);
  }

  async update(id: number, data: Partial<OrdenCompra>) {
    const actual = await this.findOne(id);
    this.exigirProveedor(data.proveedor ?? actual.proveedor, String(data.estado ?? actual.estado));
    const total = (data.lineas ?? []).reduce((a: number, l: any) => a + (l.cantidad * (l.precio_unitario ?? l.costo_unit ?? 0)), 0);
    await this.repo.update(id, { ...data, total: data.lineas ? total : data.total });
    return this.findOne(id);
  }

  async cambiarEstado(id: number, estado: EstadoCompra) {
    const actual = await this.findOne(id);
    this.exigirProveedor(actual.proveedor, estado);
    await this.repo.update(id, { estado });
    return this.findOne(id);
  }

  async recibirOrden(
    id: number,
    lineasRecibidas: Array<{ producto_id: number; variante_id?: number | null; talla?: string | null; color?: string | null; cantidad_recibida: number }>,
    usuario_id?: number,
  ) {
    const oc = await this.findOne(id);
    if (oc.estado === EstadoCompra.RECIBIDA) throw new BadRequestException('Esta orden ya fue recibida');
    if (oc.estado === EstadoCompra.CANCELADA) throw new BadRequestException('Esta orden está cancelada');

    // 1. Create inventory entry movement for each received line
    for (const linea of lineasRecibidas) {
      if (linea.cantidad_recibida <= 0) continue;

      const nota = [linea.talla, linea.color].filter(Boolean).join(' / ');

      await this.movimientoRepo.save(this.movimientoRepo.create({
        producto_id: linea.producto_id,
        // El stock se incrementa en producto Y en variante, así que el movimiento
        // debe decir de qué variante es; si no, el historial nunca cuadra con el stock.
        variante_id: linea.variante_id ?? undefined,
        tipo:        TipoMovimiento.ENTRADA,
        cantidad:    linea.cantidad_recibida,
        referencia:  oc.numero,
        nota:        nota || 'Recepción de compra',
        usuario_id:  usuario_id ?? null,
      }));

      // 2. Update stock_actual in producto (and variant if variante_id present)
      await this.productoRepo.increment({ id: linea.producto_id }, 'stock_actual', linea.cantidad_recibida);
      if (linea.variante_id) {
        await this.varRepo.increment({ id: linea.variante_id }, 'stock_actual', linea.cantidad_recibida);
      }

      // 3. Update product cost with the purchase price (+ ITBIS if applicable)
      // Con variantes, cada talla y color puede costar distinto: se casa primero
      // por variante y solo si no hay, por producto.
      const ocLinea = (oc.lineas ?? []).find((l: any) =>
        linea.variante_id && Number(l.variante_id) === Number(linea.variante_id)
      ) ?? (oc.lineas ?? []).find((l: any) =>
        Number(l.producto_id) === Number(linea.producto_id)
      );
      if (ocLinea && Number(ocLinea.precio_unitario) > 0) {
        const costoEfectivo = Number(ocLinea.precio_unitario) * (oc.aplica_itbis ? 1.18 : 1);
        await this.productoRepo.update({ id: linea.producto_id }, { costo: Math.round(costoEfectivo * 100) / 100 });
      }
    }

    // 3. Mark OC as received
    await this.repo.update(id, { estado: EstadoCompra.RECIBIDA });

    // 4. Registrar lead time del proveedor
    try {
      const hoy          = new Date().toISOString().split('T')[0];
      const fechaOrden   = oc.creado_en?.toISOString?.()?.split('T')[0] ?? hoy;
      const diasReales   = Math.round((Date.now() - new Date(oc.creado_en).getTime()) / 86400000);
      const diasEstimados = oc.entrega_esperada
        ? Math.round((new Date(oc.entrega_esperada).getTime() - new Date(oc.creado_en).getTime()) / 86400000)
        : null;
      await this.metricasService.crearLeadTime({
        orden_compra_id:  id,
        proveedor_id:     oc.proveedor_id ?? undefined,
        proveedor_nombre: oc.proveedor,
        dias_estimados:   diasEstimados ?? undefined,
        dias_reales:      diasReales,
        fecha_orden:      fechaOrden,
        fecha_llegada:    hoy,
      });
    } catch (e) { /* No bloquear la recepción si falla el registro */ }

    // 5. Lo que llegó se aparta primero para las órdenes que pidieron esta compra
    //    (la más vieja primero); lo que sobre queda libre para las que esperan.
    try {
      await this.materiales.recibirParaOrdenes(id, lineasRecibidas);
    } catch (e: any) {
      console.error(`recibirParaOrdenes ${oc.numero}:`, e?.message ?? e);
    }

    return this.findOne(id);
  }

  async getOrdenesProduccionRelacionadas(ocId: number) {
    const oc = await this.findOne(ocId);
    const lineas: any[] = oc.lineas ?? [];
    const totalOC = lineas.reduce((s: number, l: any) => s + Number(l.cantidad ?? 0), 0);
    const em = this.productoRepo.manager;

    let ops: Array<{ id: number; numero: string; estado: string; estado_materiales: string; cotizacion_id: number; cliente: string }> = [];

    /*
     * Solo las órdenes que ORIGINARON esta compra, guardadas en op_ids cuando el
     * faltante la generó.
     *
     * Antes, si la compra no tenía op_ids, se buscaba por coincidencia de producto:
     * cualquier orden abierta que usara un poloshirt salía como "relacionada" con
     * cualquier compra de poloshirt, sin importar fecha ni motivo. De 22 órdenes de
     * compra, 16 no tienen op_ids, así que casi todas mostraban órdenes ajenas — y
     * desde ahí se podían separar (11-sep-2026).
     *
     * Una compra sin op_ids es una reposición de inventario general: no tiene
     * órdenes asociadas, y así se informa.
     */
    const opIdsAsignados: number[] = Array.isArray(oc.op_ids) && oc.op_ids.length > 0 ? oc.op_ids : [];

    if (opIdsAsignados.length === 0) {
      return { ops: [], conteo: { para_ops: 0, para_inventario: totalOC }, sin_ops_asignadas: true };
    }

    const placeholderOps = opIdsAsignados.map(() => '?').join(',');
    ops = await em.query(`
      SELECT op.id, op.numero, op.estado, op.estado_materiales, op.cotizacion_id,
             COALESCE(cl.nombre, '') AS cliente
      FROM ordenes_produccion op
      JOIN cotizaciones c ON c.id = op.cotizacion_id
      LEFT JOIN clientes cl ON cl.id = c.cliente_id
      WHERE op.id IN (${placeholderOps})
        AND op.estado NOT IN ('entregado', 'cancelado')
      ORDER BY op.id DESC
    `, opIdsAsignados);

    if (ops.length === 0) {
      return { ops: [], conteo: { para_ops: 0, para_inventario: totalOC } };
    }

    const productoIdsOC = [...new Set(lineas.map((l: any) => l.producto_id).filter(Boolean))] as number[];
    const placeholderProds2 = productoIdsOC.length > 0 ? productoIdsOC.map(() => '?').join(',') : null;

    const opsConDetalle: any[] = [];
    for (const op of ops) {
      let lineasOp: Array<{ producto_id: number; cantidad: number; producto_nombre: string }> = [];
      if (placeholderProds2) {
        // Lo que pide la ORDEN, no la cotización: al confirmar, el cliente cambia
        // tallas, colores y cantidades (OP-2026-1030 cambió ROJO por BLANCO).
        const [fila] = await em.query(`SELECT lineas_produccion FROM ordenes_produccion WHERE id = ?`, [op.id]);
        let ls: any[] = fila?.lineas_produccion ?? [];
        for (let i = 0; i < 3 && typeof ls === 'string'; i++) { try { ls = JSON.parse(ls); } catch { ls = []; } }
        lineasOp = (Array.isArray(ls) ? ls : [])
          .filter(l => l?.producto_id && productoIdsOC.map(Number).includes(Number(l.producto_id)))
          .map(l => ({ producto_id: Number(l.producto_id), cantidad: Number(l.cantidad ?? 0), producto_nombre: l.producto ?? '' }));
      }
      // Por talla y color: necesita / separado / en esta compra. Sin esto la
      // pantalla decía "×20" y la compra traía 10 (las otras 10 estaban separadas).
      const detalle = await this.materiales.resumenOrdenParaCompra(Number(op.id), ocId);
      opsConDetalle.push({ ...op, lineas_relacionadas: lineasOp, detalle });
    }

    const totalPorOPs = new Map<number, number>();
    for (const op of opsConDetalle) {
      for (const l of op.lineas_relacionadas) {
        totalPorOPs.set(l.producto_id, (totalPorOPs.get(l.producto_id) ?? 0) + Number(l.cantidad));
      }
    }

    let para_ops = 0;
    let para_inventario = 0;
    const qtyPorProducto = new Map<number, number>();
    for (const l of lineas) {
      if (!l.producto_id) continue;
      qtyPorProducto.set(l.producto_id, (qtyPorProducto.get(l.producto_id) ?? 0) + Number(l.cantidad));
    }
    for (const [prodId, ocQty] of qtyPorProducto.entries()) {
      const needed = totalPorOPs.get(prodId) ?? 0;
      para_ops += Math.min(ocQty, needed);
      para_inventario += Math.max(0, ocQty - needed);
    }
    for (const l of lineas) {
      if (!l.producto_id) para_inventario += Number(l.cantidad ?? 0);
    }

    return { ops: opsConDetalle, conteo: { para_ops, para_inventario } };
  }

  async separarOC(ocId: number, opIds: number[], ocDestinoId?: number) {
    if (!opIds || opIds.length === 0) throw new BadRequestException('Selecciona al menos una orden de producción');
    const oc = await this.findOne(ocId);

    // Separar reparte las líneas entre dos compras. Si la compra ya se recibió,
    // partirla dejaría documentos que no cuadran con lo que entró al almacén.
    if (!['borrador', 'confirmada'].includes(String(oc.estado)))
      throw new BadRequestException(`No se puede separar una orden de compra ${oc.estado}. Solo en borrador o confirmada.`);

    // Solo se separa lo que de verdad pertenece a esta compra.
    const opIdsOC: number[] = Array.isArray(oc.op_ids) ? oc.op_ids.map(Number) : [];
    if (opIdsOC.length === 0)
      throw new BadRequestException('Esta orden de compra es una reposición de inventario: no tiene órdenes de producción que separar.');
    const ajenas = opIds.filter(id => !opIdsOC.includes(Number(id)));
    if (ajenas.length > 0)
      throw new BadRequestException(`Hay ${ajenas.length} orden(es) que no pertenecen a esta compra. Solo se pueden separar las suyas.`);
    if (opIds.length >= opIdsOC.length)
      throw new BadRequestException('No puedes separar todas las órdenes: la compra de origen quedaría vacía. Deja al menos una.');

    const lineas: any[] = oc.lineas ?? [];
    const productoIds = [...new Set(lineas.map((l: any) => l.producto_id).filter(Boolean))] as number[];

    if (productoIds.length === 0) throw new BadRequestException('La OC no tiene productos');

    // Desde el 13-sep-2026 cada compra anota cuánto de cada talla y color pidió
    // cada orden: se separa exactamente eso, no un estimado por producto.
    const exactas = await this.materiales.piezasDeOrdenesEnOC(ocId, opIds.map(Number));

    const em = this.productoRepo.manager;
    const placeholderOps = opIds.map(() => '?').join(',');
    const placeholderProds = productoIds.map(() => '?').join(',');

    // Get total qty needed by selected OPs per producto_id
    const opLineas: Array<{ producto_id: number; cantidad: number; variante_id?: number | null }> = exactas.length ? exactas :
      await this.materiales.lineasDeOrdenes(opIds.map(Number), productoIds);

    // Distribute OC lineas: take proportional qty for new OC, leave rest in current
    const lineasRestantes: any[] = lineas.map(l => ({ ...l }));
    const nuevasLineas: any[] = [];

    if (opLineas.length === 0) {
      // Antes, al no encontrar vínculo, se movían TODAS las líneas a la compra
      // nueva y la de origen quedaba vacía sin avisar. Mejor detenerse.
      throw new BadRequestException(
        'Las órdenes seleccionadas no piden ninguno de los productos de esta compra. No hay nada que separar.');
    } else {
      for (const opLinea of opLineas) {
        let remaining = Number(opLinea.cantidad);
        for (const linea of lineasRestantes) {
          if (Number(linea.producto_id) !== Number(opLinea.producto_id) || linea.cantidad <= 0) continue;
          if (exactas.length && Number(linea.variante_id ?? 0) !== Number(opLinea.variante_id ?? 0)) continue;
          const take = Math.min(linea.cantidad, remaining);
          if (take > 0) {
            nuevasLineas.push({ ...linea, cantidad: take });
            linea.cantidad -= take;
            remaining -= take;
          }
          if (remaining <= 0) break;
        }
      }
    }

    const lineasActualizadas = lineasRestantes.filter(l => l.cantidad > 0);

    // ── Actualizar OC origen (quitar las líneas separadas y los op_ids) ────────
    const ocOrigen = await this.repo.findOne({ where: { id: ocId } });
    const opIdsActuales: number[] = Array.isArray(ocOrigen.op_ids) ? ocOrigen.op_ids : [];
    const opIdsRestantes = opIdsActuales.filter(id => !opIds.includes(id));
    const totalRestante = lineasActualizadas.reduce(
      (s: number, l: any) => s + Number(l.cantidad) * Number(l.precio_unitario ?? l.costo_unit ?? 0), 0
    );
    Object.assign(ocOrigen, {
      lineas: lineasActualizadas,
      total:  totalRestante,
      op_ids: opIdsRestantes.length > 0 ? opIdsRestantes : null,
    });
    await this.repo.save(ocOrigen);

    // ── Agregar a OC existente o crear nueva ──────────────────────────────────
    if (ocDestinoId) {
      // Modo "agregar a existente": merge de líneas en la OC destino
      const destino = await this.findOne(ocDestinoId);
      const lineasDestino: any[] = (destino.lineas ?? []).map((l: any) => ({ ...l }));

      for (const nl of nuevasLineas) {
        const existente = lineasDestino.find(
          (l: any) =>
            l.producto_id === nl.producto_id &&
            (l.variante_id ?? null) === (nl.variante_id ?? null),
        );
        if (existente) {
          existente.cantidad = Number(existente.cantidad) + Number(nl.cantidad);
        } else {
          lineasDestino.push({ ...nl });
        }
      }

      const totalDestino = lineasDestino.reduce(
        (s: number, l: any) => s + Number(l.cantidad) * Number(l.precio_unitario ?? l.costo_unit ?? 0), 0
      );
      const opIdsDestino = [
        ...new Set([
          ...(Array.isArray(destino.op_ids) ? destino.op_ids : []),
          ...opIds,
        ]),
      ];

      await this.repo.update(ocDestinoId, {
        lineas:  lineasDestino,
        total:   totalDestino,
        op_ids:  opIdsDestino,
      } as any);
      await this.materiales.moverFaltantes(ocId, ocDestinoId, opIds.map(Number));

      return { oc_original: await this.findOne(ocId), oc_destino: await this.findOne(ocDestinoId) };
    }

    // Modo "crear nueva"
    const nueva = await this.create({
      proveedor:    oc.proveedor,
      proveedor_id: oc.proveedor_id,
      comprador:    oc.comprador,
      estado:       EstadoCompra.BORRADOR,
      lineas:       nuevasLineas,
      op_ids:       opIds,
      notas:        `Separada de ${oc.numero}`,
    });
    await this.materiales.moverFaltantes(ocId, nueva.id, opIds.map(Number));

    return { oc_original: await this.findOne(ocId), oc_nueva: nueva };
  }

  /**
   * Materiales de una orden recién creada: aparta lo que hay por talla y color y
   * pide al proveedor lo que falte. El cálculo vive en MaterialesOrdenService, el
   * mismo que usa producción, para que nunca vuelvan a dar cifras distintas.
   *
   * Antes un error aquí se tragaba en silencio y la pantalla decía "todo
   * disponible" (13-sep-2026). Ahora el error llega a quien convirtió la orden.
   */
  async validarInventarioYGenerarCompras(
    ordenProduccionId: number,
    documentoOrigen: string,
    items: Array<{ producto_id: number; producto_nombre: string; cantidad: number; variante_id?: number | null; variante_sku?: string | null }>,
    comprador: string,
  ) {
    if (Number(ordenProduccionId) > 0)
      return this.materiales.sincronizar(Number(ordenProduccionId), { comprador, documentoOrigen, generarCompras: true });
    return this.materiales.reponerInventario(items ?? [], comprador, documentoOrigen);
  }

  /** Botón "Depurar" del borrador: quita lo de órdenes que ya arrancaron o terminaron y recuadra el resto. */
  depurar(id: number, comprador?: string) {
    return this.materiales.depurarBorrador(id, comprador ?? 'Sistema');
  }

  /** Una compra sin proveedor no se le puede pedir a nadie. */
  private exigirProveedor(proveedor: string | null | undefined, estado: string) {
    if (['confirmada', 'en_transito'].includes(String(estado))
        && (!proveedor || String(proveedor).trim().toUpperCase() === PROVEEDOR_PENDIENTE))
      throw new BadRequestException('Asigna el proveedor antes de confirmar esta orden de compra.');
  }
}
