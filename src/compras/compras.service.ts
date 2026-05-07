import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrdenCompra, EstadoCompra } from './entities/orden-compra.entity';
import { Producto, TipoProducto } from '../productos/entities/producto.entity';
import { VarianteProducto } from '../productos/entities/variante-producto.entity';
import { Movimiento, TipoMovimiento } from '../inventario/entities/movimiento.entity';
import { MetricasService } from '../metricas/metricas.service';

@Injectable()
export class ComprasService {
  constructor(
    @InjectRepository(OrdenCompra)    private repo: Repository<OrdenCompra>,
    @InjectRepository(Producto)       private productoRepo: Repository<Producto>,
    @InjectRepository(VarianteProducto) private varRepo: Repository<VarianteProducto>,
    @InjectRepository(Movimiento)     private movimientoRepo: Repository<Movimiento>,
    private metricasService: MetricasService,
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
    await this.findOne(id);
    const total = (data.lineas ?? []).reduce((a: number, l: any) => a + (l.cantidad * (l.precio_unitario ?? l.costo_unit ?? 0)), 0);
    await this.repo.update(id, { ...data, total: data.lineas ? total : data.total });
    return this.findOne(id);
  }

  async cambiarEstado(id: number, estado: EstadoCompra) {
    await this.findOne(id);
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
      const ocLinea = (oc.lineas ?? []).find((l: any) =>
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

    // 4. Re-evaluate all production orders waiting for materials
    await this.revalidarOrdenesProduccion();

    return this.findOne(id);
  }

  /**
   * After stock changes, re-check all production orders with estado_materiales != disponible.
   * Uses the entity manager to avoid circular module imports.
   */
  private async revalidarOrdenesProduccion() {
    try {
      const em = this.productoRepo.manager;

      // Get all production orders that aren't fully ready yet
      const ops: Array<{ id: number; cotizacion_id: number; estado_materiales: string }> =
        await em.query(`SELECT id, cotizacion_id, estado_materiales FROM ordenes_produccion WHERE estado_materiales != 'disponible' AND estado NOT IN ('entregado','cancelada')`);

      for (const op of ops) {
        // Get all lines of the cotizacion that have a product
        const lineas: Array<{ producto_id: number; cantidad: number }> =
          await em.query(`SELECT producto_id, cantidad FROM lineas_cotizacion WHERE cotizacion_id = ? AND producto_id IS NOT NULL`, [op.cotizacion_id]);

        if (lineas.length === 0) continue;

        let disponibles = 0;
        for (const linea of lineas) {
          const prod = await this.productoRepo.findOne({ where: { id: linea.producto_id } });
          if (prod && prod.stock_actual >= linea.cantidad) disponibles++;
        }

        let nuevoEstado: string;
        if (disponibles === lineas.length)  nuevoEstado = 'disponible';
        else if (disponibles > 0)           nuevoEstado = 'parcial';
        else                                nuevoEstado = 'en_espera';

        if (nuevoEstado !== op.estado_materiales) {
          await em.query(`UPDATE ordenes_produccion SET estado_materiales = ? WHERE id = ?`, [nuevoEstado, op.id]);
        }
      }
    } catch (err) {
      console.error('revalidarOrdenesProduccion error:', err);
    }
  }

  async getOrdenesProduccionRelacionadas(ocId: number) {
    const oc = await this.findOne(ocId);
    const lineas: any[] = oc.lineas ?? [];
    const totalOC = lineas.reduce((s: number, l: any) => s + Number(l.cantidad ?? 0), 0);
    const em = this.productoRepo.manager;

    let ops: Array<{ id: number; numero: string; estado: string; estado_materiales: string; cotizacion_id: number; cliente: string }> = [];

    // If the OC has explicit op_ids assigned, use those directly
    const opIdsAsignados: number[] = Array.isArray(oc.op_ids) && oc.op_ids.length > 0 ? oc.op_ids : [];

    if (opIdsAsignados.length > 0) {
      const placeholderOps = opIdsAsignados.map(() => '?').join(',');
      ops = await em.query(`
        SELECT op.id, op.numero, op.estado, op.estado_materiales, op.cotizacion_id,
               COALESCE(cl.nombre, '') AS cliente
        FROM ordenes_produccion op
        JOIN cotizaciones c ON c.id = op.cotizacion_id
        LEFT JOIN clientes cl ON cl.id = c.cliente_id
        WHERE op.id IN (${placeholderOps})
          AND op.estado NOT IN ('entregado', 'cancelada')
        ORDER BY op.id DESC
      `, opIdsAsignados);
    } else {
      // Fallback: dynamic lookup by product overlap (for older OCs without op_ids)
      const productoIds = [...new Set(lineas.map((l: any) => l.producto_id).filter(Boolean))] as number[];
      if (productoIds.length === 0) {
        return { ops: [], conteo: { para_ops: 0, para_inventario: totalOC } };
      }
      const placeholderProds = productoIds.map(() => '?').join(',');
      ops = await em.query(`
        SELECT DISTINCT op.id, op.numero, op.estado, op.estado_materiales, op.cotizacion_id,
               COALESCE(cl.nombre, '') AS cliente
        FROM ordenes_produccion op
        JOIN cotizaciones c ON c.id = op.cotizacion_id
        LEFT JOIN clientes cl ON cl.id = c.cliente_id
        JOIN lineas_cotizacion lc ON lc.cotizacion_id = op.cotizacion_id
        WHERE lc.producto_id IN (${placeholderProds})
          AND op.estado NOT IN ('entregado', 'cancelada')
        ORDER BY op.id DESC
      `, productoIds);
    }

    if (ops.length === 0) {
      return { ops: [], conteo: { para_ops: 0, para_inventario: totalOC } };
    }

    const productoIdsOC = [...new Set(lineas.map((l: any) => l.producto_id).filter(Boolean))] as number[];
    const placeholderProds2 = productoIdsOC.length > 0 ? productoIdsOC.map(() => '?').join(',') : null;

    const opsConDetalle: any[] = [];
    for (const op of ops) {
      let lineasOp: Array<{ producto_id: number; cantidad: number; producto_nombre: string }> = [];
      if (placeholderProds2) {
        lineasOp = await em.query(`
          SELECT lc.producto_id, lc.cantidad, COALESCE(p.nombre, '') AS producto_nombre
          FROM lineas_cotizacion lc
          LEFT JOIN productos p ON p.id = lc.producto_id
          WHERE lc.cotizacion_id = ? AND lc.producto_id IN (${placeholderProds2})
        `, [op.cotizacion_id, ...productoIdsOC]);
      }
      opsConDetalle.push({ ...op, lineas_relacionadas: lineasOp });
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
    const lineas: any[] = oc.lineas ?? [];
    const productoIds = [...new Set(lineas.map((l: any) => l.producto_id).filter(Boolean))] as number[];

    if (productoIds.length === 0) throw new BadRequestException('La OC no tiene productos');

    const em = this.productoRepo.manager;
    const placeholderOps = opIds.map(() => '?').join(',');
    const placeholderProds = productoIds.map(() => '?').join(',');

    // Get total qty needed by selected OPs per producto_id
    const opLineas: Array<{ producto_id: number; cantidad: number }> =
      await em.query(`
        SELECT lc.producto_id, SUM(lc.cantidad) AS cantidad
        FROM lineas_cotizacion lc
        JOIN ordenes_produccion op ON op.cotizacion_id = lc.cotizacion_id
        WHERE op.id IN (${placeholderOps})
          AND lc.producto_id IN (${placeholderProds})
        GROUP BY lc.producto_id
      `, [...opIds, ...productoIds]);

    // Distribute OC lineas: take proportional qty for new OC, leave rest in current
    const lineasRestantes: any[] = lineas.map(l => ({ ...l }));
    const nuevasLineas: any[] = [];

    if (opLineas.length === 0) {
      // Fallback: no hay vínculo por cotización — mover TODAS las líneas a la nueva OC
      nuevasLineas.push(...lineasRestantes.map(l => ({ ...l })));
      lineasRestantes.forEach(l => { l.cantidad = 0; });
    } else {
      for (const opLinea of opLineas) {
        let remaining = Number(opLinea.cantidad);
        for (const linea of lineasRestantes) {
          if (linea.producto_id !== opLinea.producto_id || linea.cantidad <= 0) continue;
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

    return { oc_original: await this.findOne(ocId), oc_nueva: nueva };
  }

  async validarInventarioYGenerarCompras(
    ordenProduccionId: number,
    documentoOrigen: string,
    items: Array<{ producto_id: number; producto_nombre: string; cantidad: number; variante_id?: number | null; variante_sku?: string | null }>,
    comprador: string,
  ): Promise<{
    faltantes: Array<{ producto_id: number; producto_nombre: string; requerido: number; disponible: number; faltante: number; proveedor_id: number | null; proveedor_nombre: string | null }>;
    ordenes_generadas: number[];
    estado_sugerido: 'pendiente_produccion' | 'esperando_materiales';
  }> {
    try {
      const faltantes: Array<{ producto_id: number; producto_nombre: string; requerido: number; disponible: number; faltante: number; proveedor_id: number | null; proveedor_nombre: string | null; variante_id?: number | null; variante_sku?: string | null }> = [];

      // 1. Check stock for each item (variant-aware), reserve available stock (apartar)
      for (const item of items) {
        const producto = await this.productoRepo.findOne({ where: { id: item.producto_id } });

        // Skip products that should not generate purchase orders
        if (!producto) continue;
        if (!producto.maneja_inventario) continue;               // no maneja stock → no compra
        if (producto.tipo_producto === TipoProducto.FISICO_FABRICADO) continue; // se fabrica en taller → no compra

        let disponible: number;

        if (item.variante_id) {
          const variante = await this.varRepo.findOne({ where: { id: item.variante_id } });
          disponible = Number(variante?.stock_actual ?? 0);
        } else {
          disponible = Number(producto?.stock_actual ?? 0);
        }

        const apartado = Math.min(disponible, item.cantidad);
        const faltante = item.cantidad - apartado;

        // Reserve whatever is available with a SALIDA movement
        if (apartado > 0) {
          await this.movimientoRepo.save(this.movimientoRepo.create({
            producto_id: item.producto_id,
            variante_id: item.variante_id ?? undefined,
            tipo:        TipoMovimiento.SALIDA,
            cantidad:    apartado,
            referencia:  documentoOrigen,
            nota:        `Apartado para producción ${documentoOrigen}`,
          }));
          await this.productoRepo.decrement({ id: item.producto_id }, 'stock_actual', apartado);
          if (item.variante_id) {
            await this.varRepo.decrement({ id: item.variante_id }, 'stock_actual', apartado);
          }
        }

        // Only add to faltantes if stock was insufficient to cover full demand
        if (faltante > 0) {
          faltantes.push({
            producto_id:      item.producto_id,
            producto_nombre:  item.producto_nombre,
            requerido:        item.cantidad,
            disponible,
            faltante,
            proveedor_id:     null,
            proveedor_nombre: producto?.proveedor ?? null,
            variante_id:      item.variante_id ?? null,
            variante_sku:     item.variante_sku ?? null,
          });
        }
      }

      if (faltantes.length === 0) {
        return { faltantes: [], ordenes_generadas: [], estado_sugerido: 'pendiente_produccion' };
      }

      // 2. Group faltantes by proveedor_nombre (best effort grouping)
      const groups = new Map<string, typeof faltantes>();
      for (const f of faltantes) {
        const key = f.proveedor_nombre ?? 'sin_proveedor';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(f);
      }

      const ordenes_generadas: number[] = [];

      // 3. For each group, check for existing draft OC (by proveedor only, regardless of orden_produccion_id)
      for (const [provNombre, lineasFaltantes] of groups.entries()) {
        const existente = await this.repo
          .createQueryBuilder('o')
          .where('o.estado = :estado', { estado: EstadoCompra.BORRADOR })
          .andWhere('o.proveedor = :prov', { prov: provNombre })
          .getOne();

        // Fetch product costs to pre-fill precio_unitario
        const nuevasLineas = await Promise.all(lineasFaltantes.map(async f => {
          const prod = await this.productoRepo.findOne({ where: { id: f.producto_id } });
          let costo = Number(prod?.costo ?? 0);
          let sku: string | null = f.variante_sku ?? null;
          let color: string | null = null;
          let talla: string | null = null;
          if (f.variante_id) {
            const variante = await this.varRepo.findOne({ where: { id: f.variante_id } });
            if (variante) {
              if (Number(variante.costo) > 0) costo = Number(variante.costo);
              sku = variante.sku;
              const attrs = variante.atributos ?? {};
              color = attrs['COLOR'] ?? attrs['COLORES'] ?? null;
              talla = attrs['TALLA'] ?? attrs['TALLAS'] ?? null;
            }
          }
          return {
            producto_id:     f.producto_id,
            producto_nombre: f.producto_nombre,
            variante_id:     f.variante_id ?? null,
            sku,
            color,
            talla,
            cantidad:        f.faltante,
            precio_unitario: costo,
            descripcion:     '',
          };
        }));

        if (existente) {
          // Merge items into existing OC — sum quantities for same producto+variante combo
          const lineasActuales: any[] = Array.isArray(existente.lineas) ? existente.lineas : [];
          const merged = [...lineasActuales];
          for (const nueva of (nuevasLineas as any[])) {
            const key = nueva.variante_id
              ? `v${nueva.variante_id}`
              : `${nueva.producto_id}|${nueva.talla ?? ''}|${nueva.color ?? ''}`;
            const existing = merged.find((l: any) => {
              const lKey = l.variante_id
                ? `v${l.variante_id}`
                : `${l.producto_id}|${l.talla ?? ''}|${l.color ?? ''}`;
              return lKey === key;
            });
            if (existing) {
              existing.cantidad += nueva.cantidad;
            } else {
              merged.push(nueva);
            }
          }
          const total = merged.reduce((s: number, l: any) => s + (l.cantidad * (l.precio_unitario ?? l.costo_unit ?? 0)), 0);
          // Add this OP to the existing OC's op_ids if not already present
          const opIdsExistentes: number[] = Array.isArray(existente.op_ids) ? existente.op_ids : [];
          const opIdsActualizados = opIdsExistentes.includes(ordenProduccionId)
            ? opIdsExistentes
            : [...opIdsExistentes, ordenProduccionId];
          await this.repo.update(existente.id, { lineas: merged, total, op_ids: opIdsActualizados });
          ordenes_generadas.push(existente.id);
        } else {
          // Create new draft OC
          const nueva = await this.create({
            proveedor:           provNombre,
            comprador,
            documento_origen:    documentoOrigen,
            orden_produccion_id: ordenProduccionId,
            op_ids:              [ordenProduccionId],
            lineas:              nuevasLineas,
            estado:              EstadoCompra.BORRADOR,
            notas:               `Generada automáticamente desde ${documentoOrigen}`,
          });
          ordenes_generadas.push(nueva.id);
        }
      }

      return { faltantes, ordenes_generadas, estado_sugerido: 'esperando_materiales' };
    } catch (err) {
      // Never block production — log and return safe fallback
      console.error('validarInventarioYGenerarCompras error:', err);
      return { faltantes: [], ordenes_generadas: [], estado_sugerido: 'pendiente_produccion' };
    }
  }
}
