import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull, In, Not } from 'typeorm';
import { RecepcionesService } from '../recepciones/recepciones.service';
import {
  OrdenProduccion, EstadoOrden, Semaforo,
  EstadoProduccion, EstadoMateriales,
} from './entities/orden-produccion.entity';
import { ConduceEntrega, TipoConduce, ConduceItem } from './entities/conduce-entrega.entity';
import { TareaProduccion, EstadoTarea } from './entities/tarea-produccion.entity';
import { PausaProduccion } from './entities/pausa-produccion.entity';
import { LoteProduccion, EstadoLote, TipoLote, TipoEjecucion } from './entities/lote-produccion.entity';
import { ReservaInventario, EstadoReserva } from './entities/reserva-inventario.entity';
import { Movimiento, TipoMovimiento } from '../inventario/entities/movimiento.entity';
import { Producto, TipoProducto, TipoProduccion } from '../productos/entities/producto.entity';
import { TECNICA_DEPTO } from './motor-produccion';
import { ProcesoLote, EstadoProceso, PausaProceso } from './entities/proceso-lote.entity';
import { Usuario, RolUsuario } from '../auth/entities/usuario.entity';
import { Departamento } from '../configuracion/entities/departamento.entity';
import { Tecnica } from '../configuracion/entities/tecnica.entity';
import { PlantillaRuta } from '../configuracion/entities/plantilla-ruta.entity';
import { MetricasService } from '../metricas/metricas.service';


function generarTareas(tecnicas: string[]): Partial<TareaProduccion>[] {
  const tareas: Partial<TareaProduccion>[] = [];
  let orden = 0;

  tareas.push({ departamento: 'Diseño', nombre: 'Artes y diseño', orden_ejecucion: orden++ });

  const deptos = new Set<string>();
  for (const t of tecnicas) {
    const d = TECNICA_DEPTO[t];
    if (d && !deptos.has(d)) {
      deptos.add(d);
      tareas.push({ departamento: d, nombre: d, orden_ejecucion: orden++ });
    }
  }

  if (deptos.size === 0) tareas.push({ departamento: 'Costura', nombre: 'Confección', orden_ejecucion: orden++ });

  tareas.push({ departamento: 'Terminación', nombre: 'Control de calidad y empaque', orden_ejecucion: orden++ });

  return tareas;
}

@Injectable()
export class ProduccionService {
  constructor(
    @InjectRepository(OrdenProduccion)   private repo: Repository<OrdenProduccion>,
    @InjectRepository(TareaProduccion)   private tareasRepo: Repository<TareaProduccion>,
    @InjectRepository(PausaProduccion)   private pausasRepo: Repository<PausaProduccion>,
    @InjectRepository(LoteProduccion)    private lotesRepo: Repository<LoteProduccion>,
    @InjectRepository(ReservaInventario) private reservasRepo: Repository<ReservaInventario>,
    @InjectRepository(Movimiento)        private movRepo: Repository<Movimiento>,
    @InjectRepository(Producto)          private prodRepo: Repository<Producto>,
    @InjectRepository(ProcesoLote)       private procesosRepo: Repository<ProcesoLote>,
    @InjectRepository(Usuario)           private usuariosRepo: Repository<Usuario>,
    @InjectRepository(Departamento)      private deptosRepo: Repository<Departamento>,
    @InjectRepository(Tecnica)           private tecnicasRepo: Repository<Tecnica>,
    @InjectRepository(PlantillaRuta)     private plantillasRepo: Repository<PlantillaRuta>,
    @InjectRepository(ConduceEntrega)    private conduceRepo: Repository<ConduceEntrega>,
    private ds: DataSource,
    private recepcionesService: RecepcionesService,
    private metricasService: MetricasService,
  ) {}

  // ── Semáforo basado en timestamp ─────────────────────────────────────────
  private calcSemaforo(fecha: Date | string): Semaforo {
    const diffHours = (new Date(fecha).getTime() - Date.now()) / (1000 * 3600);
    return diffHours < 0 ? Semaforo.CRITICO : diffHours <= 48 ? Semaforo.ALERTA : Semaforo.NORMAL;
  }

  /** Recalcula semaforo en tiempo real y lo persiste si cambió (evita datos viejos). */
  private async refreshSemaforo(orden: OrdenProduccion): Promise<OrdenProduccion> {
    const estados_finales = [EstadoOrden.LISTO, EstadoOrden.LISTO_PARCIAL, EstadoOrden.ENTREGADO];
    if (estados_finales.includes(orden.estado)) return orden; // no modificar órdenes terminadas
    const fechaRef = orden.fecha_hora_entrega ?? orden.fecha_comprometida;
    if (!fechaRef) return orden;
    const nuevoSem = this.calcSemaforo(fechaRef);
    // Si el semáforo cambió, actualizar en DB en background
    if (nuevoSem !== orden.semaforo) {
      const update: Partial<OrdenProduccion> = { semaforo: nuevoSem };
      // Si está en producción/terminación y ya venció → marcar como atraso
      const enProd = [EstadoOrden.EN_PRODUCCION, EstadoOrden.EN_TERMINACION, EstadoOrden.PENDIENTE, EstadoOrden.EN_DISENO];
      if (nuevoSem === Semaforo.CRITICO && enProd.includes(orden.estado)) {
        update.estado = EstadoOrden.ATRASO;
      }
      this.repo.update(orden.id, update).catch(() => {});
      return { ...orden, semaforo: nuevoSem, estado: update.estado ?? orden.estado };
    }
    return orden;
  }

  private calcProgreso(tareas: TareaProduccion[]): number {
    if (!tareas.length) return 0;
    return Math.round((tareas.filter(t => t.estado === EstadoTarea.COMPLETADO).length / tareas.length) * 100);
  }

  // ── Crear orden + tareas automáticas ─────────────────────────────────────
  async create(data: {
    cotizacion_id: number;
    cliente_id: number;
    especificaciones?: string;
    notas?: string;
    fecha_comprometida: string;
    fecha_hora_entrega?: string;
    creado_por?: string;
    convertido_por?: string;
    tipo_ncf_default?: string;
  }) {
    return this.ds.transaction(async em => {
      const year = new Date().getFullYear();
      const last = await em.createQueryBuilder(OrdenProduccion, 'o')
        .where('YEAR(o.creado_en) = :year', { year })
        .orderBy('o.id', 'DESC')
        .getOne();
      const seq = last ? parseInt(last.numero.split('-').pop()!) + 1 : 1;
      const numero = `OP-${year}-${String(seq).padStart(3, '0')}`;

      const entrega = new Date(data.fecha_comprometida);
      const fechaHoraEntrega = data.fecha_hora_entrega
        ? new Date(data.fecha_hora_entrega)
        : new Date(entrega.getFullYear(), entrega.getMonth(), entrega.getDate(), 17, 0, 0);

      // Leer líneas completas de la cotización para estructura, técnicas y precios
      const lineasRaw: {
        descripcion: string;
        tecnica: string | null;
        cantidad: number;
        precio_unitario: number;
        aplica_itbis: boolean;
        porcentaje_itbis: number;
        prod_nombre: string | null;
        producto_id: number | null;
        maneja_inventario: boolean | null;
        tipo_producto: TipoProducto | null;
        tipo_produccion: TipoProduccion | null;
        var_atributos: Record<string, string> | string | null;
      }[] = await em.query(
        `SELECT lc.descripcion, lc.tecnica, lc.cantidad,
                lc.precio_unitario, lc.aplica_itbis, lc.porcentaje_itbis,
                lc.producto_id,
                p.nombre AS prod_nombre,
                p.maneja_inventario,
                p.tipo_producto,
                p.tipo_produccion,
                vp.atributos AS var_atributos
         FROM lineas_cotizacion lc
         LEFT JOIN productos p ON p.id = lc.producto_id
         LEFT JOIN variantes_producto vp ON vp.id = lc.variante_id
         WHERE lc.cotizacion_id = ?
         ORDER BY lc.orden ASC`,
        [data.cotizacion_id],
      );

      // Construye descripción de variante a partir de sus atributos (COLOR, TALLA u otros)
      const variantDesc = (raw: Record<string, string> | string | null): string => {
        if (!raw) return '';
        const attrs: Record<string, string> = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const color = attrs['COLOR'] ?? attrs['COLORES'] ?? null;
        const talla = attrs['TALLA'] ?? attrs['TALLAS'] ?? null;
        if (color && talla) return `${color} / ${talla}`;
        if (color) return color;
        if (talla) return talla;
        return Object.values(attrs).filter(Boolean).join(' / ');
      };

      // Líneas estructuradas para visualización y facturación posterior
      // Se guarda precio_unitario + ITBIS para que la factura use el estado final de la orden
      const lineas_produccion = lineasRaw.map(l => {
        const vDesc = variantDesc(l.var_atributos);
        return {
          producto:         l.prod_nombre || l.descripcion || '',
          producto_id:      l.producto_id ?? undefined,
          descripcion:      l.prod_nombre ? (vDesc || l.descripcion || '') : '',
          tecnica:          l.tecnica || '',
          cantidad:         Number(l.cantidad ?? 1),
          precio_unitario:  Number(l.precio_unitario ?? 0),
          aplica_itbis:     Boolean(l.aplica_itbis),
          porcentaje_itbis: Number(l.porcentaje_itbis ?? 18),
        };
      });

      // Técnicas únicas para generar tareas (compatibilidad legacy)
      const tecnicas = [...new Set(
        lineasRaw.map(l => l.tecnica).filter((t): t is string => !!t)
      )];

      // Especificaciones: usar únicamente las escritas manualmente (sin auto-generación)
      const especificaciones = data.especificaciones ?? null;

      const orden = em.create(OrdenProduccion, {
        numero,
        cotizacion_id:      data.cotizacion_id,
        cliente_id:         data.cliente_id,
        especificaciones,
        notas:              data.notas ?? null,
        lineas_produccion,
        creado_por:         data.creado_por,
        convertido_por:     data.convertido_por,
        fecha_comprometida: entrega,
        fecha_hora_entrega: fechaHoraEntrega,
        semaforo:           this.calcSemaforo(fechaHoraEntrega),
        tipo_ncf_default:   data.tipo_ncf_default ?? null,
      });
      const savedOrden = await em.save(OrdenProduccion, orden);

      // ── Fix #1: Marcar cotización como CONVERTIDA (atómico con la creación) ──
      // Elimina el paso intermedio de "aprobada": convertir = aprobar.
      // El guard en cambiarEstado() impide que se revierta después.
      await em.query(
        `UPDATE cotizaciones SET estado = 'convertida' WHERE id = ? AND estado != 'convertida'`,
        [data.cotizacion_id],
      );

      // ── Crear reservas de inventario ──────────────────────────────────────
      const lineasConInventario = lineasRaw.filter(
        l => l.producto_id && l.maneja_inventario && l.tipo_producto !== TipoProducto.SERVICIO
      );
      if (lineasConInventario.length > 0) {
        const reservas = lineasConInventario.map(l =>
          em.create(ReservaInventario, {
            orden_id:           savedOrden.id,
            producto_id:        l.producto_id!,
            producto_nombre:    l.prod_nombre || l.descripcion || '',
            cantidad_reservada: Number(l.cantidad ?? 1),
            estado:             EstadoReserva.ACTIVA,
          })
        );
        await em.save(ReservaInventario, reservas);
      }

      // Generar tareas legacy (compatibilidad)
      const tareasDefs = generarTareas(tecnicas);
      const tareas = tareasDefs.map(t => em.create(TareaProduccion, { ...t, orden_id: savedOrden.id }));
      await em.save(TareaProduccion, tareas);

      // ── Generar lotes de producción automáticamente ──────────────────────
      const lineasConTipo = lineasRaw.map(l => {
        const vDesc = variantDesc(l.var_atributos);
        return {
          producto:        l.prod_nombre || l.descripcion || '',
          descripcion:     l.prod_nombre ? (vDesc || l.descripcion || '') : '',
          tecnica:         l.tecnica || '',
          cantidad:        Number(l.cantidad ?? 1),
          tipo_producto:   l.tipo_producto,
          tipo_produccion: l.tipo_produccion,
        };
      });

      // La ruta de producción se configura manualmente desde la orden
      // usando el modal "Configurar ruta" (plantillas + sugerencia editable).
      // No se generan lotes automáticamente al crear la orden.

      return { ...savedOrden, tareas, lotes: [], progreso_pct: 0 };
    });
  }

  // ── Pipeline — vista de flujo por departamentos ──────────────────────────
  async getPipeline() {
    const ordenes = await this.repo.createQueryBuilder('o')
      .where("o.estado NOT IN ('entregado')")
      .andWhere("o.estado_produccion NOT IN ('cancelada')")
      .orderBy(`CASE o.semaforo WHEN 'critico' THEN 0 WHEN 'alerta' THEN 1 ELSE 2 END`, 'ASC')
      .addOrderBy('COALESCE(o.fecha_hora_entrega, o.fecha_comprometida)', 'ASC')
      .getMany();

    if (!ordenes.length) return [];

    const ids = ordenes.map(o => o.id);
    const lotes = await this.lotesRepo
      .createQueryBuilder('l')
      .where('l.orden_id IN (:...ids)', { ids })
      .orderBy('l.orden_ejecucion', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .getMany();

    const loteMap = new Map<number, LoteProduccion[]>();
    for (const l of lotes) {
      if (!loteMap.has(l.orden_id)) loteMap.set(l.orden_id, []);
      loteMap.get(l.orden_id)!.push(l);
    }

    return ordenes.map(o => {
      const row = o as any;
      return {
        id:                 row.id,
        numero:             row.numero,
        cliente_nombre:     row.cliente_nombre,
        estado:             row.estado,
        semaforo:           row.semaforo,
        fecha_hora_entrega: row.fecha_hora_entrega,
        fecha_comprometida: row.fecha_comprometida,
        estado_produccion:  row.estado_produccion,
        progreso_pct:       row.progreso_pct ?? 0,
        lotes:              loteMap.get(row.id) ?? [],
      };
    });
  }

  // ── Vista financiera ─────────────────────────────────────────────────────
  async getVistaFinanciera() {
    const rows: any[] = await this.ds.query(`
      SELECT
        o.id,
        o.numero,
        cl.nombre                                   AS cliente_nombre,
        o.estado,
        o.semaforo,
        o.fecha_comprometida,
        o.fecha_hora_entrega,
        o.creado_en,
        o.responsable_principal,
        cot.total                                   AS total_cotizacion,
        f.id                                        AS factura_id,
        f.numero                                    AS factura_numero,
        f.total_pagado                              AS factura_pagado,
        COALESCE((
          SELECT SUM(r2.monto)
          FROM recibos_ingreso r2
          WHERE r2.orden_produccion_id = o.id
        ), 0)                                       AS total_recibos_pre,
        ROUND(
          COUNT(DISTINCT CASE WHEN l.estado = 'completado' AND l.tipo = 'departamento' THEN l.id END)
          * 100.0
          / NULLIF(COUNT(DISTINCT CASE WHEN l.tipo = 'departamento' THEN l.id END), 0)
        , 0)                                        AS progreso_pct
      FROM ordenes_produccion o
      LEFT JOIN clientes       cl  ON cl.id  = o.cliente_id
      LEFT JOIN cotizaciones   cot ON cot.id = o.cotizacion_id
      LEFT JOIN facturas       f   ON f.orden_produccion_id = o.id AND f.estado != 'anulada' AND f.tipo_ncf != 'PROFORMA'
      LEFT JOIN lotes_produccion l ON l.orden_id = o.id
      GROUP BY o.id, cl.nombre, cot.total, f.id, f.numero, f.total_pagado
      ORDER BY
        CASE o.semaforo WHEN 'critico' THEN 0 WHEN 'alerta' THEN 1 ELSE 2 END,
        COALESCE(o.fecha_hora_entrega, o.fecha_comprometida)
    `);
    return rows.map(r => ({
      id:                    Number(r.id),
      numero:                r.numero,
      cliente_nombre:        r.cliente_nombre ?? `Cliente #${r.id}`,
      estado:                r.estado,
      semaforo:              r.semaforo,
      fecha_comprometida:    r.fecha_comprometida,
      fecha_hora_entrega:    r.fecha_hora_entrega,
      creado_en:             r.creado_en,
      responsable_principal: r.responsable_principal ?? null,
      total_cotizacion:      r.total_cotizacion != null ? Number(r.total_cotizacion) : null,
      // Si tiene factura: usar total_pagado de la factura (incluye abonos + factura_pagos)
      // Si no: sumar todos los recibos_ingreso de la orden (anticipos y abonos pre-factura)
      total_recibos:         r.factura_id != null
                               ? Number(r.factura_pagado ?? 0)
                               : Number(r.total_recibos_pre ?? 0),
      factura_id:            r.factura_id != null ? Number(r.factura_id) : null,
      factura_numero:        r.factura_numero ?? null,
      progreso_pct:          Number(r.progreso_pct ?? 0),
    }));
  }

  // ── Listar (Kanban + Órdenes de Producción) ───────────────────────────────
  async findAll(q?: { estado?: string; semaforo?: string; excluir_entregado?: string; search?: string; cliente_id?: string }) {
    const qb = this.repo.createQueryBuilder('o')
      .leftJoin('clientes', 'cl', 'cl.id = o.cliente_id')
      .addSelect('cl.nombre', 'cl_nombre');

    if (q?.search)     qb.andWhere('(o.numero LIKE :s OR cl.nombre LIKE :s)', { s: `%${q.search}%` });
    if (q?.cliente_id) qb.andWhere('o.cliente_id = :cid', { cid: Number(q.cliente_id) });
    if (q?.estado) qb.andWhere('o.estado = :estado', { estado: q.estado });
    if (q?.semaforo) qb.andWhere('o.semaforo = :sem', { sem: q.semaforo });
    if (q?.excluir_entregado === 'true') {
      qb.andWhere('o.estado != :ent', { ent: EstadoOrden.ENTREGADO });
    }

    qb.addOrderBy(`CASE o.semaforo WHEN 'critico' THEN 0 WHEN 'alerta' THEN 1 ELSE 2 END`, 'ASC')
      .addOrderBy('COALESCE(o.fecha_hora_entrega, o.fecha_comprometida)', 'ASC');

    const { entities, raw } = await qb.getRawAndEntities();

    const ids = entities.map(e => e.id);
    const todasTareas = ids.length
      ? await this.tareasRepo.createQueryBuilder('t')
          .where('t.orden_id IN (:...ids)', { ids })
          .getMany()
      : [];

    const results = await Promise.all(entities.map(async (e, i) => {
      const tareas    = todasTareas.filter(t => t.orden_id === e.id);
      const refreshed = await this.refreshSemaforo(e);
      return {
        ...refreshed,
        cliente_nombre: raw[i]?.cl_nombre ?? `Cliente #${e.cliente_id}`,
        tareas,
        progreso_pct: this.calcProgreso(tareas),
      };
    }));
    return results;
  }

  // ── Detalle ───────────────────────────────────────────────────────────────
  async findOne(id: number) {
    const qb = this.repo.createQueryBuilder('o')
      .leftJoin('clientes', 'cl', 'cl.id = o.cliente_id')
      .addSelect('cl.nombre',    'cl_nombre')
      .addSelect('cl.documento', 'cl_documento')
      .addSelect('cl.telefono',  'cl_telefono')
      .addSelect('cl.email',     'cl_email')
      .where('o.id = :id', { id });
    const { entities, raw } = await qb.getRawAndEntities();
    if (!entities[0]) throw new NotFoundException(`Orden #${id} no encontrada`);
    const e = entities[0];
    const tareas = await this.tareasRepo.find({
      where: { orden_id: id }, order: { orden_ejecucion: 'ASC' },
    });
    const facturaRow = await this.ds.query<{ id: number; numero: string }[]>(
      `SELECT id, numero FROM facturas WHERE orden_produccion_id = ? AND estado != 'anulada' LIMIT 1`,
      [id],
    );
    const refreshed = await this.refreshSemaforo(e);
    return {
      ...refreshed,
      responsables_secundarios: refreshed.responsables_secundarios ?? [],
      cliente_nombre:    raw[0]?.cl_nombre    ?? `Cliente #${e.cliente_id}`,
      cliente_documento: raw[0]?.cl_documento ?? null,
      cliente_telefono:  raw[0]?.cl_telefono  ?? null,
      cliente_email:     raw[0]?.cl_email     ?? null,
      tareas,
      progreso_pct:    this.calcProgreso(tareas),
      factura_id:      facturaRow[0]?.id      ?? null,
      factura_numero:  facturaRow[0]?.numero  ?? null,
    };
  }

  // ── Editar orden (admin/supervisor) ──────────────────────────────────────
  async editarOrden(id: number, data: {
    especificaciones?: string;
    notas?: string | null;
    fecha_hora_entrega?: string;
    estado?: EstadoOrden;
    lineas_produccion?: any[];
  }) {
    // Usar findOneBy + save para que TypeORM serialice correctamente columnas JSON
    const orden = await this.repo.findOneBy({ id });
    if (!orden) throw new NotFoundException(`Orden #${id} no encontrada`);

    if (data.especificaciones !== undefined) orden.especificaciones = data.especificaciones;
    if (data.notas !== undefined)            orden.notas            = data.notas ?? null;
    if (data.estado !== undefined)           orden.estado           = data.estado;
    if (data.lineas_produccion !== undefined) {
      // repo.save() serializa correctamente el array JSON
      orden.lineas_produccion = data.lineas_produccion;
    }
    if (data.fecha_hora_entrega) {
      const fecha = new Date(data.fecha_hora_entrega);
      orden.fecha_hora_entrega = fecha;
      orden.semaforo = this.calcSemaforo(fecha);
    }
    await this.repo.save(orden);
    return this.findOne(id);
  }

  // ── Cambiar estado de orden ───────────────────────────────────────────────
  async actualizarEstado(id: number, estado: EstadoOrden) {
    const orden = await this.findOne(id);
    const fechaRef = orden.fecha_hora_entrega ?? orden.fecha_comprometida;
    await this.repo.update(id, { estado, semaforo: this.calcSemaforo(fechaRef) });
    return this.findOne(id);
  }

  // ── Actualizar fecha/hora de entrega ─────────────────────────────────────
  async actualizarEntrega(id: number, fecha_hora_entrega: string) {
    const fecha = new Date(fecha_hora_entrega);
    await this.repo.update(id, {
      fecha_hora_entrega: fecha,
      semaforo: this.calcSemaforo(fecha),
    });
    return this.findOne(id);
  }

  // ── Responsables ──────────────────────────────────────────────────────────
  async actualizarResponsables(
    id: number,
    responsable_principal: string,
    responsables_secundarios: string[],
  ) {
    await this.repo.update(id, {
      responsable_principal,
      responsables_secundarios: responsables_secundarios?.length ? responsables_secundarios : null as any,
    });
    return this.findOne(id);
  }

  // ── Estado de materiales ──────────────────────────────────────────────────
  async actualizarMateriales(id: number, estado_materiales: EstadoMateriales) {
    await this.repo.update(id, { estado_materiales });
    return this.findOne(id);
  }

  // ── Control de producción ─────────────────────────────────────────────────
  async iniciarProduccion(id: number) {
    const orden = await this.findOne(id);
    if (orden.estado_produccion === EstadoProduccion.CANCELADA) {
      throw new BadRequestException('No se puede iniciar una orden cancelada');
    }
    if (orden.estado_produccion === EstadoProduccion.FINALIZADO) {
      throw new BadRequestException('La orden ya fue finalizada');
    }

    // Consumir reservas activas → descontar stock real
    const reservasActivas = await this.reservasRepo.find({
      where: { orden_id: id, estado: EstadoReserva.ACTIVA },
    });
    for (const r of reservasActivas) {
      const producto = await this.prodRepo.findOne({ where: { id: r.producto_id } });
      if (producto) {
        const nuevoStock = Math.max(0, (producto.stock_actual ?? 0) - Number(r.cantidad_reservada));
        await this.prodRepo.update(r.producto_id, { stock_actual: nuevoStock });
        await this.movRepo.save(this.movRepo.create({
          producto_id: r.producto_id,
          tipo:        TipoMovimiento.SALIDA,
          cantidad:    Number(r.cantidad_reservada),
          referencia:  `Orden producción ${orden.numero}`,
          nota:        `Consumo al iniciar orden ${orden.numero}`,
        }));
      }
      await this.reservasRepo.update(r.id, { estado: EstadoReserva.CONSUMIDA });
    }

    const update: Partial<OrdenProduccion> = {
      estado_produccion: EstadoProduccion.EN_PROCESO,
    };
    if (!orden.tiempo_inicio) update.tiempo_inicio = new Date();
    await this.repo.update(id, update);
    return this.findOne(id);
  }

  async pausarProduccion(id: number, motivo: string) {
    const orden = await this.findOne(id);
    if (orden.estado_produccion !== EstadoProduccion.EN_PROCESO) {
      throw new BadRequestException('La orden no está en proceso');
    }
    if (!motivo?.trim()) {
      throw new BadRequestException('El motivo de pausa es obligatorio');
    }
    const pausa = this.pausasRepo.create({
      orden_id: id,
      motivo:   motivo.trim(),
      fecha_inicio: new Date(),
    });
    await this.pausasRepo.save(pausa);
    await this.repo.update(id, { estado_produccion: EstadoProduccion.PAUSADO });
    return this.findOne(id);
  }

  async reanudarProduccion(id: number) {
    const orden = await this.findOne(id);
    if (orden.estado_produccion !== EstadoProduccion.PAUSADO) {
      throw new BadRequestException('La orden no está pausada');
    }
    const pausaAbierta = await this.pausasRepo.findOne({
      where: { orden_id: id, fecha_fin: IsNull() },
      order: { fecha_inicio: 'DESC' },
    });
    if (pausaAbierta) {
      await this.pausasRepo.update(pausaAbierta.id, { fecha_fin: new Date() });
    }
    await this.repo.update(id, { estado_produccion: EstadoProduccion.EN_PROCESO });
    return this.findOne(id);
  }

  async finalizarProduccion(id: number) {
    const pausaAbierta = await this.pausasRepo.findOne({
      where: { orden_id: id, fecha_fin: IsNull() },
    });
    if (pausaAbierta) {
      await this.pausasRepo.update(pausaAbierta.id, { fecha_fin: new Date() });
    }
    // Actualizar también el estado de la orden a listo, a menos que ya esté
    // en un estado terminal positivo (listo, listo_parcial, entregado)
    const orden = await this.repo.findOne({ where: { id } });
    const estadosTerminados: EstadoOrden[] = [EstadoOrden.LISTO, EstadoOrden.LISTO_PARCIAL, EstadoOrden.ENTREGADO];
    const nuevoEstado = estadosTerminados.includes(orden?.estado as EstadoOrden)
      ? undefined
      : EstadoOrden.LISTO;
    await this.repo.update(id, {
      estado_produccion: EstadoProduccion.FINALIZADO,
      tiempo_fin: new Date(),
      ...(nuevoEstado ? { estado: nuevoEstado } : {}),
    });
    return this.findOne(id);
  }

  // ── Historial de pausas ───────────────────────────────────────────────────
  async getPausas(id: number) {
    return this.pausasRepo.find({
      where: { orden_id: id },
      order: { fecha_inicio: 'ASC' },
    });
  }

  // ── Tareas ────────────────────────────────────────────────────────────────
  async getTareas(ordenId: number) {
    await this.findOne(ordenId);
    return this.tareasRepo.find({ where: { orden_id: ordenId }, order: { orden_ejecucion: 'ASC' } });
  }

  async actualizarEstadoTarea(tareaId: number, estado: EstadoTarea) {
    const tarea = await this.tareasRepo.findOne({ where: { id: tareaId } });
    if (!tarea) throw new NotFoundException(`Tarea #${tareaId} no encontrada`);
    const update: Partial<TareaProduccion> = { estado };
    if (estado === EstadoTarea.EN_PROCESO && !tarea.fecha_inicio) update.fecha_inicio = new Date();
    if (estado === EstadoTarea.COMPLETADO) update.fecha_fin = new Date();
    await this.tareasRepo.update(tareaId, update);
    const tareas = await this.tareasRepo.find({ where: { orden_id: tarea.orden_id } });
    const progreso = this.calcProgreso(tareas);
    if (progreso === 100) await this.repo.update(tarea.orden_id, { estado: EstadoOrden.LISTO });
    return this.tareasRepo.findOne({ where: { id: tareaId } });
  }

  async asignarTarea(tareaId: number, responsable: string, tiempo_estimado?: string) {
    const tarea = await this.tareasRepo.findOne({ where: { id: tareaId } });
    if (!tarea) throw new NotFoundException(`Tarea #${tareaId} no encontrada`);
    await this.tareasRepo.update(tareaId, { responsable, tiempo_estimado });
    return this.tareasRepo.findOne({ where: { id: tareaId } });
  }

  // ── Cancelación directa (Admin/Supervisor) ───────────────────────────────
  async cancelarOrden(id: number, motivo: string, solicitadoPor: string) {
    const orden = await this.findOne(id);
    if (orden.estado_produccion === EstadoProduccion.FINALIZADO) {
      throw new BadRequestException('No se puede cancelar una orden ya finalizada');
    }
    if (orden.estado_produccion === EstadoProduccion.CANCELADA) {
      throw new BadRequestException('La orden ya está cancelada');
    }
    if (!motivo?.trim()) throw new BadRequestException('El motivo es obligatorio');

    // Cerrar pausa abierta si la hay
    const pausaAbierta = await this.pausasRepo.findOne({
      where: { orden_id: id, fecha_fin: IsNull() },
    });
    if (pausaAbierta) {
      await this.pausasRepo.update(pausaAbierta.id, { fecha_fin: new Date() });
    }

    // Liberar reservas activas (orden nunca inició)
    await this.reservasRepo.createQueryBuilder()
      .update()
      .set({ estado: EstadoReserva.LIBERADA })
      .where('orden_id = :id AND estado = :est', { id, est: EstadoReserva.ACTIVA })
      .execute();

    // Si la orden ya había iniciado, restaurar el stock que se descontó al consumir las reservas
    if (
      orden.estado_produccion === EstadoProduccion.EN_PROCESO ||
      orden.estado_produccion === EstadoProduccion.PAUSADO
    ) {
      const reservasConsumidas = await this.reservasRepo.find({
        where: { orden_id: id, estado: EstadoReserva.CONSUMIDA },
      });
      for (const r of reservasConsumidas) {
        const producto = await this.prodRepo.findOne({ where: { id: r.producto_id } });
        if (producto) {
          const nuevoStock = (producto.stock_actual ?? 0) + Number(r.cantidad_reservada);
          await this.prodRepo.update(r.producto_id, { stock_actual: nuevoStock });
          await this.movRepo.save(this.movRepo.create({
            producto_id: r.producto_id,
            tipo:        TipoMovimiento.ENTRADA,
            cantidad:    Number(r.cantidad_reservada),
            referencia:  `Cancelación ${orden.numero}`,
            nota:        `Devuelto automáticamente al cancelar la orden`,
          }));
        }
      }
    }

    // Cancelar tareas pendientes
    await this.tareasRepo.createQueryBuilder()
      .update()
      .set({ estado: EstadoTarea.COMPLETADO })
      .where('orden_id = :id AND estado != :comp', { id, comp: EstadoTarea.COMPLETADO })
      .execute();

    await this.repo.update(id, {
      estado_produccion:          EstadoProduccion.CANCELADA,
      cancelacion_solicitada:     false,
      cancelacion_motivo:         motivo.trim(),
      cancelacion_solicitado_por: solicitadoPor,
      ...(orden.tiempo_inicio && !orden.tiempo_fin ? { tiempo_fin: new Date() } : {}),
    });
    return this.findOne(id);
  }

  // ── Solicitar cancelación (cualquier rol) ────────────────────────────────
  async solicitarCancelacion(id: number, motivo: string, solicitadoPor: string) {
    const orden = await this.findOne(id);
    if (orden.estado_produccion === EstadoProduccion.SIN_INICIAR) {
      throw new BadRequestException('Las órdenes sin iniciar pueden cancelarse directamente (contacta a un administrador)');
    }
    if (orden.estado_produccion === EstadoProduccion.FINALIZADO) {
      throw new BadRequestException('No se puede cancelar una orden ya finalizada');
    }
    if (orden.estado_produccion === EstadoProduccion.CANCELADA) {
      throw new BadRequestException('La orden ya está cancelada');
    }
    if (!motivo?.trim()) throw new BadRequestException('El motivo es obligatorio');
    if (orden.cancelacion_solicitada) {
      throw new BadRequestException('Ya existe una solicitud de cancelación pendiente');
    }
    await this.repo.update(id, {
      cancelacion_solicitada:    true,
      cancelacion_motivo:        motivo.trim(),
      cancelacion_solicitado_por: solicitadoPor,
    });
    return this.findOne(id);
  }

  // ── Aprobar cancelación (Admin/Supervisor) ───────────────────────────────
  async aprobarCancelacion(id: number, aprobadoPor: string) {
    const orden = await this.findOne(id);
    if (!orden.cancelacion_solicitada) {
      throw new BadRequestException('No hay solicitud de cancelación pendiente');
    }
    // Cerrar pausa abierta si la hay
    const pausaAbierta = await this.pausasRepo.findOne({
      where: { orden_id: id, fecha_fin: IsNull() },
    });
    if (pausaAbierta) {
      await this.pausasRepo.update(pausaAbierta.id, { fecha_fin: new Date() });
    }
    // Liberar reservas activas si las hay
    await this.reservasRepo.createQueryBuilder()
      .update()
      .set({ estado: EstadoReserva.LIBERADA })
      .where('orden_id = :id AND estado = :est', { id, est: EstadoReserva.ACTIVA })
      .execute();

    // Cancelar tareas pendientes
    await this.tareasRepo.createQueryBuilder()
      .update()
      .set({ estado: EstadoTarea.COMPLETADO })
      .where('orden_id = :id AND estado != :comp', { id, comp: EstadoTarea.COMPLETADO })
      .execute();

    await this.repo.update(id, {
      estado_produccion:         EstadoProduccion.CANCELADA,
      cancelacion_solicitada:    false,
      cancelacion_solicitado_por: aprobadoPor,
      ...(orden.tiempo_inicio && !orden.tiempo_fin ? { tiempo_fin: new Date() } : {}),
    });
    return this.findOne(id);
  }

  // ── Rechazar cancelación (Admin/Supervisor) ──────────────────────────────
  async rechazarCancelacion(id: number) {
    const orden = await this.findOne(id);
    if (!orden.cancelacion_solicitada) {
      throw new BadRequestException('No hay solicitud de cancelación pendiente');
    }
    await this.repo.update(id, {
      cancelacion_solicitada:    false,
      cancelacion_motivo:        null as any,
      cancelacion_solicitado_por: null as any,
    });
    return this.findOne(id);
  }

  // ── Lotes de producción ───────────────────────────────────────────────────
  async getLotes(ordenId: number) {
    const todos = await this.lotesRepo.find({
      where: { orden_id: ordenId },
      order: { orden_ejecucion: 'ASC', id: 'ASC' },
    });

    // Resolver departamento_id por nombre para control de permisos en frontend
    const nombres = [...new Set(todos.map(l => l.departamento).filter(Boolean))];
    const deptoRows: { id: number; nombre: string }[] = nombres.length
      ? await this.ds.query(
          `SELECT id, nombre FROM departamentos WHERE nombre IN (${nombres.map(() => '?').join(',')})`,
          nombres,
        )
      : [];
    const deptoMap = new Map(deptoRows.map(d => [d.nombre, d.id]));

    // Construir estructura anidada: dept lotes con sus tareas hijas
    const depts  = todos.filter(l => l.tipo === 'departamento');
    const tareas = todos.filter(l => l.tipo === 'tarea');

    return depts.map(dept => ({
      ...dept,
      departamento_id: deptoMap.get(dept.departamento) ?? null,
      tareas: tareas.filter(t => t.lote_padre_id === dept.id),
    }));
  }

  async getLotesPorDepartamento(departamento: string, estado?: EstadoLote) {
    const qb = this.lotesRepo.createQueryBuilder('l')
      .leftJoin('clientes', 'cl', 'cl.id = (SELECT o.cliente_id FROM ordenes_produccion o WHERE o.id = l.orden_id)')
      .addSelect('cl.nombre', 'cl_nombre')
      .leftJoin('ordenes_produccion', 'op', 'op.id = l.orden_id')
      .addSelect('op.numero', 'op_numero')
      .addSelect('op.fecha_hora_entrega', 'op_entrega')
      .addSelect('op.semaforo', 'op_semaforo')
      .addSelect('op.especificaciones', 'op_especificaciones')
      .addSelect('op.adjuntos', 'op_adjuntos')
      .addSelect('op.estado', 'op_estado')
      .addSelect('op.estado_produccion', 'op_prod')
      .addSelect('op.estado_materiales', 'op_mat')
      .addSelect('op.lineas_produccion', 'op_lineas')
      .where('l.departamento = :departamento', { departamento });

    if (estado) {
      qb.andWhere('l.estado = :estado', { estado });
    } else {
      // Por defecto: todo excepto cancelado
      qb.andWhere('l.estado != :cancelado', { cancelado: EstadoLote.CANCELADO });
    }

    qb.orderBy(`CASE l.estado
      WHEN 'en_proceso' THEN 0
      WHEN 'desbloqueado' THEN 1
      WHEN 'pendiente' THEN 2
      ELSE 3 END`, 'ASC')
      .addOrderBy('op.fecha_hora_entrega', 'ASC');

    const { entities, raw } = await qb.getRawAndEntities();
    return entities.map((e, i) => ({
      ...e,
      cliente_nombre:        raw[i]?.cl_nombre ?? '',
      orden_numero:          raw[i]?.op_numero ?? '',
      orden_entrega:         raw[i]?.op_entrega ?? null,
      orden_semaforo:        raw[i]?.op_semaforo ?? 'normal',
      orden_estado:          raw[i]?.op_estado ?? 'pendiente',
      orden_estado_produccion: raw[i]?.op_prod ?? 'sin_iniciar',
      orden_estado_materiales: raw[i]?.op_mat ?? 'en_espera',
      orden_especificaciones: raw[i]?.op_especificaciones ?? null,
      orden_adjuntos:        raw[i]?.op_adjuntos
                               ? (typeof raw[i].op_adjuntos === 'string'
                                   ? JSON.parse(raw[i].op_adjuntos)
                                   : raw[i].op_adjuntos)
                               : [],
      lineas_produccion:     raw[i]?.op_lineas
                               ? (typeof raw[i].op_lineas === 'string'
                                   ? JSON.parse(raw[i].op_lineas)
                                   : raw[i].op_lineas)
                               : null,
    }));
  }

  async actualizarEstadoLote(loteId: number, estado: EstadoLote, responsable?: string, piezas?: {
    piezas_ok: number; piezas_retrabajo: number; piezas_descarte: number;
  }) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);

    if (lote.estado === EstadoLote.PENDIENTE && estado === EstadoLote.EN_PROCESO) {
      throw new BadRequestException('Este lote está bloqueado. Debe completarse el lote previo primero.');
    }

    // Bloquear inicio si la orden está cancelada
    if (estado === EstadoLote.EN_PROCESO) {
      const orden = await this.repo.findOne({ where: { id: lote.orden_id } });
      if (orden?.estado_produccion === EstadoProduccion.CANCELADA) {
        throw new BadRequestException('No se puede iniciar un lote de una orden cancelada');
      }
    }

    // ── Si es una TAREA (sub-tarea de un dept), propagar al dept padre ─────
    if (lote.tipo === 'tarea') {
      const update: Partial<LoteProduccion> = { estado };
      if (responsable) update.responsable = responsable;
      if (estado === EstadoLote.EN_PROCESO && !lote.tiempo_inicio) update.tiempo_inicio = new Date();
      if (estado === EstadoLote.COMPLETADO) {
        update.tiempo_fin = new Date();
        const cantidad = Number(lote.cantidad);
        // Si piezas no viene, o viene con todo en 0 (legacy/fallback), defaultear a cantidad
        const todosCeros = piezas != null
          && (piezas.piezas_ok ?? 0) === 0
          && (piezas.piezas_retrabajo ?? 0) === 0
          && (piezas.piezas_descarte ?? 0) === 0;
        update.piezas_ok        = (!piezas || todosCeros) ? cantidad : (piezas.piezas_ok ?? cantidad);
        update.piezas_retrabajo = piezas?.piezas_retrabajo ?? 0;
        update.piezas_descarte  = piezas?.piezas_descarte  ?? 0;
      }
      await this.lotesRepo.update(loteId, update);

      // ── Registrar tiempo operario al completar ────────────────────────────
      if (estado === EstadoLote.COMPLETADO && lote.tiempo_inicio) {
        const durMin = Math.round((Date.now() - new Date(lote.tiempo_inicio).getTime()) / 60000);
        const orden  = await this.repo.findOne({ where: { id: lote.orden_id } });
        try {
          await this.metricasService.crearRegistroTiempo({
            lote_id:          loteId,
            orden_id:         lote.orden_id,
            orden_numero:     orden?.numero,
            operario_nombre:  responsable || lote.responsable,
            departamento:     lote.departamento,
            tecnica:          lote.tecnica,
            piezas_ok:        update.piezas_ok        ?? 0,
            piezas_retrabajo: update.piezas_retrabajo ?? 0,
            piezas_descarte:  update.piezas_descarte  ?? 0,
            duracion_minutos: durMin,
          });
        } catch (e) { /* No bloquear el flujo si falla el registro */ }
      }

      if (lote.lote_padre_id) {
        const deptLote = await this.lotesRepo.findOne({ where: { id: lote.lote_padre_id } });
        if (deptLote) {
          if (estado === EstadoLote.EN_PROCESO && deptLote.estado !== EstadoLote.EN_PROCESO) {
            // Primera tarea iniciando → dept va a EN_PROCESO (recursión controlada)
            await this.actualizarEstadoLote(deptLote.id, EstadoLote.EN_PROCESO, responsable);
          } else if (estado === EstadoLote.COMPLETADO) {
            // Desbloquear la siguiente tarea hermana en secuencia (por id)
            const siguienteTarea = await this.lotesRepo
              .createQueryBuilder('l')
              .where('l.lote_padre_id = :padreId', { padreId: deptLote.id })
              .andWhere('l.tipo = :tipo', { tipo: 'tarea' })
              .andWhere('l.estado = :pen', { pen: EstadoLote.PENDIENTE })
              .andWhere('l.id > :currentId', { currentId: loteId })
              .orderBy('l.id', 'ASC')
              .getOne();
            if (siguienteTarea) {
              await this.lotesRepo.update(siguienteTarea.id, { estado: EstadoLote.DESBLOQUEADO });
            }

            // ¿Todas las tareas del dept completadas?
            const hermanas = await this.lotesRepo.find({
              where: { lote_padre_id: deptLote.id, tipo: 'tarea' },
            });
            const todasCompletas = hermanas.every(
              h => h.id === loteId || h.estado === EstadoLote.COMPLETADO,
            );
            if (todasCompletas && deptLote.estado !== EstadoLote.COMPLETADO) {
              // Todas las tareas listas → dept se completa (recursión controlada)
              await this.actualizarEstadoLote(deptLote.id, EstadoLote.COMPLETADO);
            }
          }
        }
      }
      return this.lotesRepo.findOne({ where: { id: loteId } });
    }

    // ── Lote de tipo DEPARTAMENTO (flujo normal) ───────────────────────────
    const update: Partial<LoteProduccion> = { estado };
    if (responsable) update.responsable = responsable;
    if (estado === EstadoLote.EN_PROCESO && !lote.tiempo_inicio) update.tiempo_inicio = new Date();
    if (estado === EstadoLote.COMPLETADO) {
      update.tiempo_fin = new Date();
      const cantidad = Number(lote.cantidad);
      // Si piezas no viene, o viene con todo en 0 (legacy/fallback), defaultear a cantidad
      const todosCeros = piezas != null
        && (piezas.piezas_ok ?? 0) === 0
        && (piezas.piezas_retrabajo ?? 0) === 0
        && (piezas.piezas_descarte ?? 0) === 0;
      update.piezas_ok        = (!piezas || todosCeros) ? cantidad : (piezas.piezas_ok ?? cantidad);
      update.piezas_retrabajo = piezas?.piezas_retrabajo ?? 0;
      update.piezas_descarte  = piezas?.piezas_descarte  ?? 0;
    }

    await this.lotesRepo.update(loteId, update);

    // ── Registrar tiempo operario al completar ────────────────────────────
    if (estado === EstadoLote.COMPLETADO && lote.tiempo_inicio) {
      const durMin = Math.round((Date.now() - new Date(lote.tiempo_inicio).getTime()) / 60000);
      const orden  = await this.repo.findOne({ where: { id: lote.orden_id } });
      try {
        await this.metricasService.crearRegistroTiempo({
          lote_id:          loteId,
          orden_id:         lote.orden_id,
          orden_numero:     orden?.numero,
          operario_nombre:  responsable || lote.responsable,
          departamento:     lote.departamento,
          tecnica:          lote.tecnica,
          piezas_ok:        update.piezas_ok        ?? 0,
          piezas_retrabajo: update.piezas_retrabajo ?? 0,
          piezas_descarte:  update.piezas_descarte  ?? 0,
          duracion_minutos: durMin,
        });
      } catch (e) { /* No bloquear el flujo si falla el registro */ }
    }

    // ── Auto-iniciar orden cuando primer lote arranca ──────────────────────
    if (estado === EstadoLote.EN_PROCESO) {
      const orden = await this.repo.findOne({ where: { id: lote.orden_id } });
      if (orden && orden.estado_produccion === EstadoProduccion.SIN_INICIAR) {
        await this.repo.update(lote.orden_id, {
          estado_produccion: EstadoProduccion.EN_PROCESO,
          estado:            EstadoOrden.EN_PRODUCCION,
          tiempo_inicio:     new Date(),
        });
      }
      // Desbloquear depts hijos que no esperan a que este termine (desbloquear_al='en_proceso')
      await this.lotesRepo.createQueryBuilder()
        .update()
        .set({ estado: EstadoLote.DESBLOQUEADO })
        .where(
          'lote_padre_id = :id AND estado = :pen AND desbloquear_al = :da AND tipo = :tipo',
          { id: loteId, pen: EstadoLote.PENDIENTE, da: 'en_proceso', tipo: 'departamento' },
        )
        .execute();
      // Desbloquear también las tareas hijas de los depts recién desbloqueados
      await this.desbloquearTareasDeHijos(loteId, 'en_proceso');
    }

    // ── Al completar: desbloquear hijos y revisar ciclo de la orden ────────
    if (estado === EstadoLote.COMPLETADO) {
      // Desbloquear depts que esperan que este esté completado
      await this.lotesRepo.createQueryBuilder()
        .update()
        .set({ estado: EstadoLote.DESBLOQUEADO })
        .where(
          'lote_padre_id = :id AND estado = :pen AND desbloquear_al = :da AND tipo = :tipo',
          { id: loteId, pen: EstadoLote.PENDIENTE, da: 'completado', tipo: 'departamento' },
        )
        .execute();
      // Desbloquear también las tareas hijas de los depts recién desbloqueados
      await this.desbloquearTareasDeHijos(loteId, 'completado');

      // ── Crear recepción pendiente para departamentos hijos ────────────────
      // Diseño no recibe mercancía física (trabaja con archivos digitales),
      // pero SÍ puede enviar al siguiente departamento que sí la necesita.
      const DPTOS_SIN_RECEPCION = ['Diseño'];
      const orden = await this.repo.findOne({ where: { id: lote.orden_id } });
      const hijosDesbloqueados = await this.lotesRepo.find({
        where: { lote_padre_id: loteId, tipo: 'departamento', estado: EstadoLote.DESBLOQUEADO },
      });
      for (const hijo of hijosDesbloqueados) {
        if (DPTOS_SIN_RECEPCION.includes(hijo.departamento)) continue;
        const existing = await this.recepcionesService.getByLote(hijo.id);
        if (existing.length > 0) continue;
        await this.recepcionesService.crear({
          lote_id:      hijo.id,
          orden_id:     lote.orden_id,
          orden_numero: orden?.numero ?? '',
          dpto_origen:  lote.departamento,
          dpto_destino: hijo.departamento,
          items: [{
            lote_id:          lote.id,
            producto:         lote.producto,
            descripcion:      lote.descripcion ?? '',
            cantidad_enviada: Number(lote.cantidad),
            cantidad_recibida: null,
          }],
        });
      }

      // Revisar si la orden está completa (solo lotes dept para el cálculo)
      const lotes = await this.lotesRepo.find({ where: { orden_id: lote.orden_id, tipo: 'departamento' } });
      const lotesEfectivos = lotes.map(l =>
        l.id === loteId ? { ...l, estado: EstadoLote.COMPLETADO } : l
      );

      // Terminación Y confecciones requieren verificación de piezas
      const esVerificable    = (l: { departamento: string }) => {
        const d = l.departamento.toLowerCase();
        return d.includes('terminac') || d.includes('confeccion');
      };
      const lotesOp          = lotesEfectivos.filter(l => !esVerificable(l));
      const lotesTerminacion = lotesEfectivos.filter(l => esVerificable(l));

      const todoOp          = lotesOp.every(l => l.estado === EstadoLote.COMPLETADO);
      const todoTerminacion = lotesTerminacion.every(l => l.estado === EstadoLote.COMPLETADO);
      const todosCompletos  = todoOp && todoTerminacion;

      if (todosCompletos) {
        // Determinar si es LISTO o LISTO_PARCIAL según piezas verificadas.
        // Son departamentos SECUENCIALES (confecciones → terminación), así que
        // usamos el MÍNIMO de piezas_ok (el cuello de botella), no la suma.
        let estadoFinal = EstadoOrden.LISTO;
        if (lotesTerminacion.length > 0) {
          const ordenData   = await this.repo.findOne({ where: { id: lote.orden_id } });
          const lineasProd  = ordenData?.lineas_produccion ?? [];
          const totalPedido = lineasProd.reduce((s, l) => s + Number(l.cantidad), 0);
          if (totalPedido > 0) {
            // Recopilar piezas_ok de cada lote verificable
            const piezasPorLote: number[] = [];
            for (const lv of lotesTerminacion) {
              const ok = (lv.id === loteId && piezas)
                ? piezas.piezas_ok
                : ((await this.lotesRepo.findOne({ where: { id: lv.id } }))?.piezas_ok ?? 0);
              piezasPorLote.push(ok);
            }
            // Mínimo: el eslabón más débil de la cadena
            const totalOk = Math.min(...piezasPorLote);
            if (totalOk < totalPedido) estadoFinal = EstadoOrden.LISTO_PARCIAL;
          }
        }
        await this.repo.update(lote.orden_id, {
          estado:            estadoFinal,
          estado_produccion: EstadoProduccion.FINALIZADO,
          tiempo_fin:        new Date(),
        });
      } else if (todoOp && lotesOp.length > 0 && lotesTerminacion.length > 0) {
        await this.repo.update(lote.orden_id, { estado: EstadoOrden.EN_TERMINACION });
      }
    }

    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  /**
   * Cuando un dept lote se desbloquea, también desbloquea las tareas hijas de los
   * depts hijos que acaban de pasar a DESBLOQUEADO.
   */
  private async desbloquearTareasDeHijos(
    padreId: number,
    desbloquearAl: 'completado' | 'en_proceso',
  ) {
    const deptsDesbloqueados = await this.lotesRepo.find({
      where: {
        lote_padre_id:  padreId,
        tipo:           'departamento',
        estado:         EstadoLote.DESBLOQUEADO,
        desbloquear_al: desbloquearAl,
      },
    });
    for (const dept of deptsDesbloqueados) {
      await this.lotesRepo.createQueryBuilder()
        .update()
        .set({ estado: EstadoLote.DESBLOQUEADO })
        .where(
          'lote_padre_id = :id AND tipo = :tipo AND estado = :pen',
          { id: dept.id, tipo: 'tarea', pen: EstadoLote.PENDIENTE },
        )
        .execute();
    }
  }

  async marcarCheckpoint(loteId: number, checkpoint: string, completado: boolean) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);

    const actuales = lote.checkpoints_completados ?? [];
    let nuevos: string[];
    if (completado) {
      nuevos = actuales.includes(checkpoint) ? actuales : [...actuales, checkpoint];
    } else {
      nuevos = actuales.filter(c => c !== checkpoint);
    }

    await this.lotesRepo.update(loteId, { checkpoints_completados: nuevos });
    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  // ── Pausar / Reanudar lote ────────────────────────────────────────────────
  async pausarLote(loteId: number, motivo: string) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);
    if (lote.estado !== EstadoLote.EN_PROCESO) throw new BadRequestException('El lote no está en proceso');

    const pausas = lote.pausas_lote ?? [];
    const abierta = pausas.find(p => !p.fin);
    if (abierta) throw new BadRequestException('Ya hay una pausa abierta');

    pausas.push({ motivo, inicio: new Date().toISOString(), fin: null });
    await this.lotesRepo.update(loteId, { pausas_lote: pausas });
    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  async reanudarLote(loteId: number) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);

    const pausas = lote.pausas_lote ?? [];
    const abierta = pausas.find(p => !p.fin);
    if (!abierta) throw new BadRequestException('No hay pausa activa');

    abierta.fin = new Date().toISOString();
    await this.lotesRepo.update(loteId, { pausas_lote: pausas });
    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  // ── Dividir lote en sub-lotes (para múltiples operarios/máquinas) ─────────
  async dividirLote(
    loteId: number,
    divisiones: Array<{ cantidad: number; responsable?: string; maquina?: string; lineas_asignadas?: number[] }>,
  ) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);

    if (![EstadoLote.PENDIENTE, EstadoLote.DESBLOQUEADO].includes(lote.estado)) {
      throw new BadRequestException('Solo se pueden dividir lotes pendientes o desbloqueados');
    }
    if (divisiones.length < 2) {
      throw new BadRequestException('Se necesitan al menos 2 divisiones');
    }

    const totalDiv = divisiones.reduce((s, d) => s + Number(d.cantidad), 0);
    if (!(totalDiv > 0)) {
      throw new BadRequestException('La suma de las divisiones debe ser mayor a 0');
    }
    // NOTA: no exigimos que totalDiv == lote.cantidad. El lote puede estar
    // sub-dimensionado (ej. bordado creado solo para una línea), y al dividir por
    // líneas reales el total puede ser mayor. Los sub-lotes quedan con las
    // cantidades indicadas (que el frontend ya cuadró contra las líneas reales).

    // Hijos del lote. La "tarea espejo" (mismo departamento que el padre, ej.
    // un lote departamento BORDADO con una sub-tarea BORDADO "en máquina")
    // carga las MISMAS piezas que el padre. Si dividimos solo el padre, la tarea
    // espejo queda entera bajo un operario y el conteo se infla. Por eso la
    // dividimos en sincronía con el padre. Los demás hijos (DISEÑO, TERMINACION,
    // otra técnica) se re-cuelgan del último sub-lote como antes.
    const hijos = await this.lotesRepo.find({ where: { lote_padre_id: loteId } });
    const tareasEspejo = hijos.filter(
      h => h.tipo === 'tarea' && h.departamento === lote.departamento,
    );
    const otrosHijos = hijos.filter(h => !tareasEspejo.includes(h));

    const SUFIJOS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const subLotes: LoteProduccion[] = [];

    for (let i = 0; i < divisiones.length; i++) {
      const div    = divisiones[i];
      const sufijo = SUFIJOS[i] ?? String(i + 1);
      const nuevo  = this.lotesRepo.create({
        orden_id:        lote.orden_id,
        numero:          `${lote.numero}-${sufijo}`,
        producto:        lote.producto,
        descripcion:     lote.descripcion,
        cantidad:        div.cantidad,
        departamento:    lote.departamento,
        tecnica:         lote.tecnica,
        tipo_lote:       lote.tipo_lote,
        tipo_ejecucion:  lote.tipo_ejecucion,
        orden_ejecucion: lote.orden_ejecucion,
        lote_padre_id:   lote.lote_padre_id,
        estado:          lote.estado,
        tipo:            lote.tipo,
        responsable:     div.responsable ?? null,
        maquina:         div.maquina     ?? null,
        lineas_asignadas: div.lineas_asignadas?.length ? div.lineas_asignadas : null,
      });
      const saved = await this.lotesRepo.save(nuevo);
      subLotes.push(saved);

      // Replicar cada tarea espejo para esta misma división (misma cantidad y
      // responsable), colgada de su sub-lote departamento correspondiente.
      for (const m of tareasEspejo) {
        const subTarea = this.lotesRepo.create({
          orden_id:        m.orden_id,
          numero:          `${m.numero}-${sufijo}`,
          producto:        m.producto,
          descripcion:     m.descripcion,
          cantidad:        div.cantidad,
          departamento:    m.departamento,
          tecnica:         m.tecnica,
          tipo_lote:       m.tipo_lote,
          tipo_ejecucion:  m.tipo_ejecucion,
          orden_ejecucion: m.orden_ejecucion,
          lote_padre_id:   saved.id,
          estado:          m.estado,
          tipo:            'tarea',
          tarea_nombre:    m.tarea_nombre,
          responsable:     div.responsable ?? null,
          maquina:         div.maquina     ?? null,
          lineas_asignadas: div.lineas_asignadas?.length ? div.lineas_asignadas : null,
        });
        await this.lotesRepo.save(subTarea);
      }
    }

    // Los demás hijos (otra técnica / terminación / diseño) penden del último sub-lote
    const ultimoId = subLotes[subLotes.length - 1].id;
    for (const o of otrosHijos) {
      await this.lotesRepo.update(o.id, { lote_padre_id: ultimoId });
    }

    // Eliminar las tareas espejo originales y el lote original
    if (tareasEspejo.length > 0) await this.lotesRepo.remove(tareasEspejo);
    await this.lotesRepo.remove(lote);

    return subLotes;
  }

  async asignarLote(loteId: number, responsable: string, notas?: string, responsables?: string[], maquina?: string) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);
    const update: Partial<LoteProduccion> = {
      responsable,
      ...(notas      !== undefined ? { notas }      : {}),
      ...(responsables !== undefined ? { responsables } : {}),
      ...(maquina    !== undefined ? { maquina }    : {}),
    };
    await this.lotesRepo.update(loteId, update);

    // Propagar el responsable a TODA la unidad de trabajo: el lote departamento y
    // su(s) tarea(s) espejo del MISMO departamento. Antes solo cambiaba el lote
    // tocado → el conteo quedaba partido entre dos personas (el viejo y el nuevo)
    // y el trabajo aparecía bajo el responsable equivocado en el histórico.
    // No toca tareas de otro departamento (ej. DISEÑO) ni sub-lotes de divisiones
    // (esos cuelgan de otro lote departamento distinto).
    const deptoId = lote.tipo === 'tarea' ? (lote.lote_padre_id ?? lote.id) : lote.id;
    const depto = await this.lotesRepo.findOne({ where: { id: deptoId } });
    if (depto) {
      const hijas = await this.lotesRepo.find({ where: { lote_padre_id: depto.id, tipo: 'tarea' as any } });
      const ids = [depto.id, ...hijas.filter(h => (h.departamento ?? '') === (depto.departamento ?? '')).map(h => h.id)];
      const otros = ids.filter(id => id !== loteId);
      if (otros.length > 0) {
        await this.lotesRepo.createQueryBuilder().update().set({ responsable }).whereInIds(otros).execute();
      }
    }
    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  // ── Tomar un lote (operario se auto-asigna) ──────────────────────────────
  async tomarLote(loteId: number, responsable: string) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);
    if (lote.responsable) throw new BadRequestException('Este lote ya tiene un responsable asignado');
    await this.lotesRepo.update(loteId, { responsable });
    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  // ── Histórico de tareas completadas por operario, agrupado por día ────────
  // (Lo consume la vista "Mis tareas → Histórico". El conteo descuenta pausas.)
  async historicoOperario(params: {
    desde?: string; hasta?: string; responsable?: string;
    departamento?: string; tecnica?: string;
  }) {
    const { desde, hasta, responsable, departamento, tecnica } = params || {};

    // Período por defecto según el periodo_pago del operario (semanal/quincenal)
    const calcPeriodo = (periodoPago: string) => {
      const hoy = new Date();
      const y = hoy.getFullYear();
      const m = hoy.getMonth();
      const d = hoy.getDate();
      if (periodoPago === 'semanal') {
        const dow = hoy.getDay();
        const lunes = new Date(hoy);
        lunes.setDate(d - ((dow + 6) % 7));
        const domingo = new Date(lunes);
        domingo.setDate(lunes.getDate() + 6);
        return {
          tipo: 'semanal',
          desde: lunes.toISOString().split('T')[0],
          hasta: domingo.toISOString().split('T')[0],
          label: `Semana ${lunes.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })} – ${domingo.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}`,
        };
      }
      if (d <= 15) {
        const dDesde = new Date(y, m, 1);
        const dHasta = new Date(y, m, 15);
        return {
          tipo: 'quincenal',
          desde: dDesde.toISOString().split('T')[0],
          hasta: dHasta.toISOString().split('T')[0],
          label: `1 – 15 ${dDesde.toLocaleDateString('es-DO', { month: 'long' })}`,
        };
      }
      const dDesde = new Date(y, m, 16);
      const lastDay = new Date(y, m + 1, 0).getDate();
      const dHasta = new Date(y, m, lastDay);
      return {
        tipo: 'quincenal',
        desde: dDesde.toISOString().split('T')[0],
        hasta: dHasta.toISOString().split('T')[0],
        label: `16 – ${lastDay} ${dDesde.toLocaleDateString('es-DO', { month: 'long' })}`,
      };
    };

    let periodo: { tipo: string; desde: string; hasta: string; label: string };
    if (desde && hasta) {
      periodo = { tipo: 'manual', desde, hasta, label: `${desde} – ${hasta}` };
    } else if (responsable) {
      const [usr] = await this.ds.query(
        `SELECT periodo_pago FROM usuarios WHERE nombre = ? LIMIT 1`, [responsable]);
      periodo = calcPeriodo(usr?.periodo_pago ?? 'quincenal');
    } else {
      periodo = calcPeriodo('quincenal');
    }

    const where: string[] = [
      `l.estado = 'completado'`,
      `l.tiempo_fin IS NOT NULL`,
      `l.tiempo_inicio IS NOT NULL`,
      // NO filtramos espejo aquí: traemos todos los lotes y deduplicamos en JS por
      // (orden, depto, producto) tomando el MÁXIMO — MISMO criterio que la vista
      // admin (operarios/[id]) para que ambas pantallas den el mismo número.
      `DATE(l.tiempo_fin) BETWEEN ? AND ?`,
    ];
    const bind: any[] = [periodo.desde, periodo.hasta];
    if (responsable) { where.push(`l.responsable = ?`); bind.push(responsable); }
    if (departamento) { where.push(`l.departamento = ?`); bind.push(departamento); }
    if (tecnica) {
      where.push(`(
        LOWER(l.tecnica) LIKE CONCAT('%', LOWER(?), '%')
        OR LOWER(l.departamento) LIKE CONCAT('%', LOWER(?), '%')
        OR LOWER(IFNULL(l.tarea_nombre,'')) LIKE CONCAT('%', LOWER(?), '%')
        OR EXISTS (
          SELECT 1 FROM lotes_produccion ol
          WHERE ol.orden_id = l.orden_id
          AND (
            LOWER(ol.tecnica) LIKE CONCAT('%', LOWER(?), '%')
            OR LOWER(ol.departamento) LIKE CONCAT('%', LOWER(?), '%')
            OR LOWER(IFNULL(ol.tarea_nombre,'')) LIKE CONCAT('%', LOWER(?), '%')
          )
        )
      )`);
      bind.push(tecnica, tecnica, tecnica, tecnica, tecnica, tecnica);
    }

    const rows = await this.ds.query(`
      SELECT
        l.id AS lote_id,
        l.orden_id, l.departamento, l.producto, l.tarea_nombre, l.tecnica,
        l.tiempo_inicio, l.tiempo_fin, l.piezas_ok, l.aplicaciones_por_pieza,
        l.pausas_lote, l.cantidad, l.responsable,
        o.numero AS orden_numero, c.nombre AS cliente_nombre
      FROM lotes_produccion l
      INNER JOIN ordenes_produccion o ON o.id = l.orden_id
      LEFT JOIN clientes c ON c.id = o.cliente_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.tiempo_fin DESC
    `, bind);

    const itemDe = (r: any) => {
      let pausas: any[] = [];
      try { pausas = r.pausas_lote ? (typeof r.pausas_lote === 'string' ? JSON.parse(r.pausas_lote) : r.pausas_lote) : []; } catch { pausas = []; }
      const totalPausaMs = (pausas || []).reduce((s: number, p: any) => {
        if (!p?.inicio || !p?.fin) return s;
        return s + Math.max(0, new Date(p.fin).getTime() - new Date(p.inicio).getTime());
      }, 0);
      const inicio = r.tiempo_inicio ? new Date(r.tiempo_inicio).getTime() : 0;
      const fin = r.tiempo_fin ? new Date(r.tiempo_fin).getTime() : 0;
      const brutoMs = Math.max(0, fin - inicio);
      const netoMin = Math.max(0, Math.round((brutoMs - totalPausaMs) / 60000));
      const aplic = Number(r.aplicaciones_por_pieza) || 1;
      const piezasOk = Number(r.piezas_ok ?? 0);
      return {
        lote_id: r.lote_id,
        orden_id: r.orden_id,
        orden_numero: r.orden_numero,
        cliente_nombre: r.cliente_nombre,
        departamento: r.departamento,
        producto: r.producto,
        tarea_nombre: r.tarea_nombre,
        tecnica: r.tecnica ?? r.departamento,
        responsable: r.responsable,
        tiempo_inicio: r.tiempo_inicio,
        tiempo_fin: r.tiempo_fin,
        piezas_ok: piezasOk,
        aplicaciones_por_pieza: aplic,
        // "piezas" = trabajo real = piezas_ok × aplicaciones (lo que se cuenta/paga)
        piezas: piezasOk * aplic,
        cantidad: Number(r.cantidad ?? 0),
        duracion_min_neta: netoMin,
      };
    };

    // Deduplicar por (orden, depto, producto): el lote departamento y su tarea
    // espejo cargan las mismas piezas → tomamos el de MAYOR trabajo (MAX), igual
    // que la vista admin. Productos distintos y divisiones (otro responsable) no
    // colapsan porque la consulta ya filtra por este responsable.
    const porGrupo = new Map<string, any>();
    for (const r of rows) {
      const it = itemDe(r);
      const k = `${it.orden_id}|${it.departamento}|${it.producto}`;
      const prev = porGrupo.get(k);
      if (!prev || it.piezas > prev.piezas) porGrupo.set(k, it);
    }
    const procesados = [...porGrupo.values()];

    const grupos = new Map<string, { fecha: string; items: any[] }>();
    for (const it of procesados) {
      const fechaKey = it.tiempo_fin ? new Date(it.tiempo_fin).toISOString().slice(0, 10) : 'sin-fecha';
      const g = grupos.get(fechaKey) ?? { fecha: fechaKey, items: [] };
      g.items.push(it);
      grupos.set(fechaKey, g);
    }

    const grupArr = [...grupos.values()].map(g => {
      const ordenesUnicas = new Set(g.items.map(i => i.orden_id));
      return {
        fecha: g.fecha,
        dia_label: g.fecha !== 'sin-fecha'
          ? new Date(g.fecha + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: '2-digit', month: 'long' })
          : 'Sin fecha',
        total_piezas_dia: g.items.reduce((s, i) => s + (Number(i.piezas) || 0), 0),
        total_ordenes_dia: ordenesUnicas.size,
        total_minutos_dia: g.items.reduce((s, i) => s + i.duracion_min_neta, 0),
        items: g.items,
      };
    }).sort((a, b) => b.fecha.localeCompare(a.fecha));

    const todasOrdenes = new Set(procesados.map((i: any) => i.orden_id));
    const stats = {
      total_piezas: procesados.reduce((s: number, i: any) => s + (Number(i.piezas) || 0), 0),
      total_ordenes: todasOrdenes.size,
      total_minutos_netos: procesados.reduce((s: number, i: any) => s + i.duracion_min_neta, 0),
      dias_produccion: grupArr.length,
    };

    return { periodo, stats, grupos: grupArr };
  }

  // ── Vista personal del operario ──────────────────────────────────────────
  async getMisTareas(responsable: string, departamentosNombres: string[], rol?: string) {
    const estadosActivos = [EstadoLote.DESBLOQUEADO, EstadoLote.EN_PROCESO, EstadoLote.PENDIENTE];

    // Lotes asignados directamente a este operario (activos)
    const asignados = await this.lotesRepo
      .createQueryBuilder('l')
      .where('l.responsable = :resp', { resp: responsable })
      .andWhere('l.estado IN (:...estados)', { estados: estadosActivos })
      .orderBy('l.orden_ejecucion', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .getMany();

    // Tareas completadas por este operario (últimos 30 días)
    const desde30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const completadas = await this.lotesRepo
      .createQueryBuilder('l')
      .where('l.responsable = :resp', { resp: responsable })
      .andWhere('l.responsable IS NOT NULL') // excluir auto-completados (diseño existente)
      .andWhere('l.estado = :estado', { estado: EstadoLote.COMPLETADO })
      .andWhere('l.tiempo_fin >= :desde', { desde: desde30 })
      .orderBy('l.tiempo_fin', 'DESC')
      .getMany();

    // Disponibles en sus departamentos:
    // - tareas (tipo='tarea') desbloqueadas sin responsable
    // - depts (tipo='departamento') desbloqueados sin responsable Y sin sub-tareas
    const dispQb = this.lotesRepo
      .createQueryBuilder('l')
      .where('l.estado = :estado', { estado: EstadoLote.DESBLOQUEADO })
      .andWhere('l.responsable IS NULL')
      .andWhere(
        `(l.tipo = 'tarea' OR (l.tipo = 'departamento' AND NOT EXISTS (
          SELECT 1 FROM lotes_produccion t2
          WHERE t2.lote_padre_id = l.id AND t2.tipo = 'tarea'
        )))`,
      );
    const esAdmin = rol === 'admin' || rol === 'supervisor';
    // Admin/supervisor ve TODO sin filtro de departamento (acceso total independiente de localStorage)
    // Operario: filtrar por sus departamentos configurados; si no tiene → no ve disponibles
    if (!esAdmin) {
      if (departamentosNombres.length > 0) {
        dispQb.andWhere('l.departamento IN (:...deptos)', { deptos: departamentosNombres });
      } else {
        // Sin departamentos y sin rol admin → no mostrar disponibles
        dispQb.andWhere('1=0');
      }
    }
    const disponibles = await dispQb.orderBy('l.id', 'ASC').getMany();

    // Parciales: lotes completados con piezas_ok < cantidad y orden aún activa.
    // Se muestran a TODOS los del departamento (no solo al responsable original).
    const parcialesQb = this.lotesRepo
      .createQueryBuilder('l')
      .where('l.estado = :estado', { estado: EstadoLote.COMPLETADO })
      .andWhere('l.piezas_ok IS NOT NULL')
      .andWhere('l.piezas_ok < l.cantidad');
    // Filtrar por departamento salvo que sea admin/supervisor (que ve todo)
    if (!esAdmin && departamentosNombres.length > 0) {
      parcialesQb.andWhere('l.departamento IN (:...deptos)', { deptos: departamentosNombres });
    } else if (!esAdmin) {
      parcialesQb.andWhere('1=0'); // sin depto configurado y sin rol admin → no muestra
    }
    const parcialesCandidatos = await parcialesQb.orderBy('l.tiempo_fin', 'DESC').getMany();

    const parcialesOrdenIds = [...new Set(parcialesCandidatos.map(l => l.orden_id))];
    let parciales: LoteProduccion[] = [];
    if (parcialesOrdenIds.length > 0) {
      const ordenesActivas = await this.repo
        .createQueryBuilder('o')
        .where('o.id IN (:...ids)', { ids: parcialesOrdenIds })
        .andWhere("o.estado NOT IN (:...estados)", { estados: ['listo', 'entregado', 'cancelado'] })
        .getMany();
      const activeIds = new Set(ordenesActivas.map(o => o.id));
      parciales = parcialesCandidatos.filter(l => activeIds.has(l.orden_id));
    }

    // Enriquecer con número de orden y cliente
    const todosLoteIds = [...asignados, ...disponibles, ...completadas, ...parciales].map(l => l.orden_id);
    const uniqueOrdenIds = [...new Set(todosLoteIds)];
    const ordenes = uniqueOrdenIds.length > 0
      ? await this.repo.find({ where: { id: In(uniqueOrdenIds) } })
      : [];
    const ordenMap = new Map(ordenes.map(o => [o.id, o]));

    // Obtener nombres de clientes
    const uniqueClienteIds = [...new Set(ordenes.map(o => o.cliente_id).filter(Boolean))];
    let clienteNombreMap = new Map<number, string>();
    if (uniqueClienteIds.length > 0) {
      const rows: { id: number; nombre: string }[] = await this.repo.manager.query(
        `SELECT id, nombre FROM clientes WHERE id IN (${uniqueClienteIds.join(',')})`,
      );
      clienteNombreMap = new Map(rows.map(r => [r.id, r.nombre]));
    }

    // Cargar lotes dept padre para las tareas (para mostrar nombre del dept en la UI)
    const todosLotes = [...asignados, ...disponibles, ...completadas, ...parciales];
    const deptPadreIds = [...new Set(
      todosLotes
        .filter(l => l.tipo === 'tarea' && l.lote_padre_id)
        .map(l => l.lote_padre_id!)
    )];
    const deptPadreMap = new Map<number, LoteProduccion>();
    if (deptPadreIds.length > 0) {
      const depts = await this.lotesRepo.find({ where: { id: In(deptPadreIds) } });
      depts.forEach(d => deptPadreMap.set(d.id, d));
    }

    const enrich = (l: LoteProduccion) => {
      const orden = ordenMap.get(l.orden_id);
      const clienteId = orden?.cliente_id ?? null;
      const deptPadre = l.tipo === 'tarea' && l.lote_padre_id
        ? deptPadreMap.get(l.lote_padre_id)
        : null;
      // Para sub-tareas, usar la cantidad del lote padre (el departamento tiene la cantidad real)
      const cantidadReal = (l.tipo === 'tarea' && deptPadre) ? deptPadre.cantidad : l.cantidad;
      return {
        ...l,
        cantidad:                  cantidadReal,
        orden_numero:              orden?.numero ?? '',
        cliente_id:                clienteId,
        cliente_nombre:            clienteId ? (clienteNombreMap.get(clienteId) ?? `Cliente #${clienteId}`) : null,
        fecha_entrega:             orden?.fecha_hora_entrega ?? orden?.fecha_comprometida ?? null,
        especificaciones:          orden?.especificaciones ?? null,
        lineas_produccion:         orden?.lineas_produccion ?? [],
        orden_estado_produccion:   orden?.estado_produccion ?? null,
        // Para tareas: info del dept padre
        dept_nombre:               deptPadre?.departamento ?? l.departamento,
        dept_estado:               deptPadre?.estado ?? null,
      };
    };

    return {
      asignados:   asignados.map(enrich),
      disponibles: disponibles.map(enrich),
      completadas: completadas.map(enrich),
      parciales:   parciales.map(enrich),
    };
  }

  // ── Retomar lote parcialmente completado ─────────────────────────────────
  async retomarLote(loteId: number, responsable: string) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);
    if (lote.estado !== EstadoLote.COMPLETADO) {
      throw new BadRequestException('Solo se pueden retomar lotes completados');
    }
    const faltantes = lote.cantidad - (lote.piezas_ok ?? 0);
    if (faltantes <= 0) throw new BadRequestException('No hay faltantes en este lote');

    await this.lotesRepo.update(loteId, {
      estado:           EstadoLote.DESBLOQUEADO,
      responsable,
      tiempo_inicio:    null as any,
      tiempo_fin:       null as any,
      piezas_ok:        null as any,
      piezas_retrabajo: null as any,
      piezas_descarte:  null as any,
    });

    // Retroceder orden si estaba listo/listo_parcial/en_terminacion
    const orden = await this.repo.findOne({ where: { id: lote.orden_id } });
    if (orden) {
      const estadosRetroceder = [
        EstadoOrden.LISTO, EstadoOrden.LISTO_PARCIAL, EstadoOrden.EN_TERMINACION,
      ];
      if (estadosRetroceder.includes(orden.estado as EstadoOrden)) {
        await this.repo.update(lote.orden_id, { estado: EstadoOrden.EN_PRODUCCION });
      }
    }

    return { ok: true, faltantes, lote_id: loteId };
  }

  // ── Listar operarios (para selector de asignación) ───────────────────────
  async getOperarios(departamentoNombre?: string) {
    const roles = [RolUsuario.OPERARIO, RolUsuario.PRODUCCION, RolUsuario.ADMIN, RolUsuario.SUPERVISOR];
    let usuarios = await this.usuariosRepo.find({
      where: { activo: true, rol: In(roles) },
      order: { nombre: 'ASC' },
    });

    if (departamentoNombre) {
      const depto = await this.deptosRepo.findOne({ where: { nombre: departamentoNombre } });
      if (depto) {
        usuarios = usuarios.filter(u =>
          Array.isArray(u.departamentos) && u.departamentos.includes(depto.id)
        );
      }
    }

    return usuarios.map(u => ({
      id:            u.id,
      nombre:        u.nombre,
      email:         u.email,
      departamentos: u.departamentos,
      departamento:  u.departamento,
    }));
  }

  // ── Confirmar recepción de materiales (firma de recibido) ────────────────
  async confirmarLote(loteId: number, data: { confirmado_por: string; cantidad_confirmada: number; notas_recepcion?: string }) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);
    await this.lotesRepo.update(loteId, {
      cantidad_confirmada: data.cantidad_confirmada,
      confirmado_por:      data.confirmado_por,
      confirmado_en:       new Date(),
      notas_recepcion:     data.notas_recepcion ?? null,
    });
    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  // ── Actualizar piezas_ok y recalcular estado de orden ────────────────────
  async actualizarPiezasLote(loteId: number, piezasOk: number) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);

    await this.lotesRepo.update(loteId, { piezas_ok: piezasOk });

    // Recalcular estado de la orden si el lote es terminación / confecciones
    const esVerificable = (d: string) => {
      const dl = d.toLowerCase();
      return dl.includes('terminac') || dl.includes('confeccion');
    };

    if (esVerificable(lote.departamento)) {
      const orden = await this.repo.findOne({ where: { id: lote.orden_id } });
      if (orden && [EstadoOrden.LISTO_PARCIAL, EstadoOrden.LISTO].includes(orden.estado)) {
        const lineasProd  = orden.lineas_produccion ?? [];
        const totalPedido = lineasProd.reduce((s, l) => s + Number(l.cantidad), 0);

        const lotesOrden = await this.lotesRepo.find({
          where: { orden_id: lote.orden_id, tipo: 'departamento' },
        });
        const lotesVerif = lotesOrden.filter(lv => esVerificable(lv.departamento));
        // Mínimo (no suma): departamentos secuenciales → el cuello de botella manda
        const piezasPorLote = lotesVerif.map(lv =>
          lv.id === loteId ? piezasOk : (lv.piezas_ok ?? 0)
        );
        const totalOk = lotesVerif.length > 0 ? Math.min(...piezasPorLote) : 0;

        const nuevoEstado = totalPedido > 0 && totalOk >= totalPedido
          ? EstadoOrden.LISTO
          : EstadoOrden.LISTO_PARCIAL;

        if (nuevoEstado !== orden.estado) {
          await this.repo.update(lote.orden_id, { estado: nuevoEstado });
        }
      }
    }

    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  // ── Alertas: lotes desbloqueados por departamento ────────────────────────
  async getAlertas() {
    const lotes = await this.lotesRepo.find({ where: { estado: EstadoLote.DESBLOQUEADO } });
    const porDepto: Record<string, number> = {};
    for (const l of lotes) {
      porDepto[l.departamento] = (porDepto[l.departamento] ?? 0) + 1;
    }
    return { total: lotes.length, por_departamento: porDepto };
  }

  // ── Sugerir ruta para una orden (basado en sus técnicas + plantillas) ───────
  async sugerirRuta(ordenId: number) {
    const orden = await this.repo.findOne({ where: { id: ordenId } });
    if (!orden) throw new NotFoundException(`Orden #${ordenId} no encontrada`);

    // Obtener técnicas de la orden desde sus lineas de cotización
    const lineasRaw: { tecnica: string }[] = await this.repo.manager.query(
      `SELECT DISTINCT lc.tecnica
       FROM lineas_cotizacion lc
       WHERE lc.cotizacion_id = ?
         AND lc.tecnica IS NOT NULL AND lc.tecnica != ''`,
      [orden.cotizacion_id],
    );
    const tecnicas = lineasRaw.map(l => l.tecnica).filter(Boolean);

    // Cargar plantillas activas con sus pasos+tareas
    const plantillas = await this.plantillasRepo.find({ where: { activo: true } });

    // Buscar la plantilla más relevante: aquella cuyos pasos cubren más técnicas de la orden
    let mejorPlantilla = plantillas[0] ?? null;
    let mejorScore = -1;
    for (const p of plantillas) {
      const deptos = p.pasos.map(s => s.departamento.toLowerCase());
      const score = tecnicas.filter(t =>
        deptos.some(d => d.includes(t.toLowerCase()) || t.toLowerCase().includes(d))
      ).length;
      if (score > mejorScore) { mejorScore = score; mejorPlantilla = p; }
    }

    if (!mejorPlantilla) return { pasos: [] };

    // Devolver pasos con tareas para que el frontend los muestre editables
    return {
      plantilla_nombre: mejorPlantilla.nombre,
      pasos: mejorPlantilla.pasos.map(p => ({
        departamento:    p.departamento,
        tipo_lote:       p.tipo_lote,
        orden_ejecucion: p.orden_ejecucion,
        tipo_ejecucion:  p.tipo_ejecucion,
        tareas:          p.tareas ?? [],
      })),
    };
  }

  // ── Preview de ruta (obsoleto — usar sugerirRuta) ────────────────────────
  async previewRuta(_lineas: { producto?: string; descripcion?: string; tecnica?: string; cantidad?: number }[]) {
    return [];
  }

  // ── Actualizar campos de un lote (edición de ruta) ────────────────────────
  async editarLote(loteId: number, data: {
    departamento?: string; tecnica?: string;
    tipo_lote?: TipoLote; tipo_ejecucion?: TipoEjecucion;
    orden_ejecucion?: number; cantidad?: number; descripcion?: string;
    desbloquear_al?: 'completado' | 'en_proceso';
  }) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);
    if (lote.estado === EstadoLote.EN_PROCESO || lote.estado === EstadoLote.COMPLETADO) {
      throw new BadRequestException('No se puede editar un lote en proceso o completado');
    }
    await this.lotesRepo.update(loteId, data);
    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  // ── Editar "aplicaciones por pieza" (×N) — permitido incluso en COMPLETADOS ─
  // El conteo de piezas es piezas_ok × aplicaciones al consultar, así que editar
  // esto recalcula todos los reportes retroactivamente. Se aplica a TODO el grupo
  // de trabajo (orden + depto + producto) para cubrir el lote departamento y su
  // tarea espejo, manteniendo el conteo consistente.
  async setAplicacionesPorPieza(loteId: number, aplicaciones: number) {
    const n = Math.max(1, Math.floor(Number(aplicaciones) || 1));
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);

    const qb = this.lotesRepo.createQueryBuilder()
      .update()
      .set({ aplicaciones_por_pieza: n })
      .where('orden_id = :o', { o: lote.orden_id })
      .andWhere('departamento = :d', { d: lote.departamento });
    if (lote.producto == null) qb.andWhere('producto IS NULL');
    else qb.andWhere('producto = :p', { p: lote.producto });
    const res = await qb.execute();

    return {
      success: true,
      aplicaciones_por_pieza: n,
      lotes_afectados: res.affected ?? 0,
      grupo: { orden_id: lote.orden_id, departamento: lote.departamento, producto: lote.producto },
    };
  }

  // ── Eliminar un lote (solo si no ha iniciado) ─────────────────────────────
  async eliminarLote(loteId: number) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);
    if (lote.estado === EstadoLote.EN_PROCESO || lote.estado === EstadoLote.COMPLETADO) {
      throw new BadRequestException('No se puede eliminar un lote en proceso o completado');
    }
    // Reasignar hijos al padre del lote eliminado
    await this.lotesRepo.createQueryBuilder()
      .update()
      .set({ lote_padre_id: lote.lote_padre_id })
      .where('lote_padre_id = :id', { id: loteId })
      .execute();
    await this.lotesRepo.delete(loteId);
    return { success: true };
  }

  // ── Agregar lote manualmente a una orden ─────────────────────────────────
  async agregarLote(ordenId: number, data: {
    producto: string; descripcion?: string; cantidad: number;
    departamento: string; tecnica?: string;
    tipo_lote: TipoLote; orden_ejecucion: number;
  }) {
    const orden = await this.repo.findOne({ where: { id: ordenId } });
    if (!orden) throw new NotFoundException(`Orden #${ordenId} no encontrada`);

    // Obtener último número de secuencia de lotes de esta orden
    const todos = await this.lotesRepo.find({
      where: { orden_id: ordenId },
      order: { id: 'DESC' },
    });
    const lastSeq = todos.length
      ? Math.max(...todos.map(l => parseInt(l.numero.split('-L').pop() ?? '0')))
      : 0;

    // Determinar estado inicial según paso
    const estado = data.orden_ejecucion === 0
      ? EstadoLote.DESBLOQUEADO
      : EstadoLote.PENDIENTE;

    // Encontrar padre (último lote del paso anterior)
    let lote_padre_id: number | null = null;
    if (data.orden_ejecucion > 0) {
      const padre = await this.lotesRepo.findOne({
        where: { orden_id: ordenId, orden_ejecucion: data.orden_ejecucion - 1 },
        order: { id: 'DESC' },
      });
      lote_padre_id = padre?.id ?? null;
    }

    const nuevo = this.lotesRepo.create({
      numero:          `${orden.numero}-L${lastSeq + 1}`,
      orden_id:        ordenId,
      tipo_lote:       data.tipo_lote,
      producto:        data.producto,
      descripcion:     data.descripcion ?? null,
      cantidad:        data.cantidad,
      departamento:    data.departamento,
      tecnica:         data.tecnica ?? null,
      tipo_ejecucion:  TipoEjecucion.PARALELO,
      orden_ejecucion: data.orden_ejecucion,
      lote_padre_id,
      estado,
    });
    return this.lotesRepo.save(nuevo);
  }

  // ── Detalle de materiales con stock en tiempo real ────────────────────────
  async getMateriasDetalle(id: number) {
    const orden = await this.findOne(id);
    const lineas = orden.lineas_produccion ?? [];

    const resultado: {
      producto: string;
      descripcion: string | null;
      producto_id: number | null;
      cantidad_necesaria: number;
      stock_total: number | null;
      reservado_otras_ordenes: number;
      disponible: number | null;
      en_oc: boolean;
      oc_numeros: string[];
      estado: 'ok' | 'parcial' | 'sin_stock' | 'sin_inventario';
    }[] = [];

    for (const linea of lineas) {
      const productoId = (linea as any).producto_id ?? null;
      const cantNecesaria = Number(linea.cantidad);

      if (!productoId) {
        resultado.push({
          producto: linea.producto,
          descripcion: (linea as any).descripcion ?? null,
          producto_id: null,
          cantidad_necesaria: cantNecesaria,
          stock_total: null,
          reservado_otras_ordenes: 0,
          disponible: null,
          en_oc: false,
          oc_numeros: [],
          estado: 'sin_inventario',
        });
        continue;
      }

      const producto = await this.prodRepo.findOne({ where: { id: productoId } });
      if (!producto || !producto.maneja_inventario) {
        resultado.push({
          producto: linea.producto,
          descripcion: (linea as any).descripcion ?? null,
          producto_id: productoId,
          cantidad_necesaria: cantNecesaria,
          stock_total: null,
          reservado_otras_ordenes: 0,
          disponible: null,
          en_oc: false,
          oc_numeros: [],
          estado: 'sin_inventario',
        });
        continue;
      }

      const reservasOtras = await this.reservasRepo
        .createQueryBuilder('r')
        .select('SUM(r.cantidad_reservada)', 'total')
        .where('r.producto_id = :pid', { pid: productoId })
        .andWhere('r.orden_id != :oid', { oid: id })
        .andWhere('r.estado = :est', { est: EstadoReserva.ACTIVA })
        .getRawOne();
      const reservadoOtras = Number(reservasOtras?.total ?? 0);

      const stockTotal = producto.stock_actual ?? 0;
      const disponible = stockTotal - reservadoOtras;

      const ocsRaw: { numero: string }[] = await this.ds.query(
        `SELECT oc.numero
         FROM ordenes_compra oc
         WHERE oc.estado IN ('confirmada','en_transito')
           AND JSON_SEARCH(oc.lineas, 'one', ?, NULL, '$[*].producto_id') IS NOT NULL`,
        [String(productoId)],
      );
      const ocNumeros = ocsRaw.map(o => o.numero);

      let estado: 'ok' | 'parcial' | 'sin_stock';
      if (disponible >= cantNecesaria) estado = 'ok';
      else if (disponible > 0) estado = 'parcial';
      else estado = 'sin_stock';

      resultado.push({
        producto: linea.producto,
        descripcion: (linea as any).descripcion ?? null,
        producto_id: productoId,
        cantidad_necesaria: cantNecesaria,
        stock_total: stockTotal,
        reservado_otras_ordenes: reservadoOtras,
        disponible,
        en_oc: ocNumeros.length > 0,
        oc_numeros: ocNumeros,
        estado,
      });
    }

    const tienenInventario = resultado.filter(r => r.estado !== 'sin_inventario');
    let estadoGeneral: EstadoMateriales = EstadoMateriales.DISPONIBLE;
    if (tienenInventario.length > 0) {
      const todoOk       = tienenInventario.every(r => r.estado === 'ok');
      const todoSinStock = tienenInventario.every(r => r.estado === 'sin_stock');
      if (todoSinStock) estadoGeneral = EstadoMateriales.EN_ESPERA;
      else if (!todoOk) estadoGeneral = EstadoMateriales.PARCIAL;
    }

    // Persistir el estado calculado en la orden para que el listado lo refleje
    await this.repo.update(id, { estado_materiales: estadoGeneral });

    return { lineas: resultado, estado_calculado: estadoGeneral };
  }

  async devolverMateriales(
    id: number,
    items: { producto_id: number; cantidad: number }[],
    devueltoPor: string,
  ) {
    const orden = await this.findOne(id);
    for (const item of items) {
      if (item.cantidad <= 0) continue;
      const producto = await this.prodRepo.findOne({ where: { id: item.producto_id } });
      if (!producto) continue;
      const nuevoStock = (producto.stock_actual ?? 0) + item.cantidad;
      await this.prodRepo.update(item.producto_id, { stock_actual: nuevoStock });
      await this.movRepo.save(this.movRepo.create({
        producto_id: item.producto_id,
        tipo:        TipoMovimiento.ENTRADA,
        cantidad:    item.cantidad,
        referencia:  `Devolución orden ${orden.numero}`,
        nota:        `Devuelto por ${devueltoPor} al cancelar orden ${orden.numero}`,
      }));
    }
    return { ok: true, devueltos: items.length };
  }

  async getReservas(id: number) {
    return this.reservasRepo.find({ where: { orden_id: id } });
  }

  // ── Calcula piezas de un producto/técnica desde lineas_produccion ────────
  /**
   * Calcula la cantidad correcta para un paso/lote considerando el departamento.
   *
   * Los lotes de DISEÑO/REDISEÑO no deben heredar el total de piezas porque el
   * flujo simplificado requiere 1 click = 1 diseño listo. Por defecto se asigna
   * cantidad=1 (un solo diseño/logo); si la cotización incluye servicios
   * explícitos de diseño (líneas con técnica que empieza con "DISEÑO" o
   * "REDISEÑO"), se usa la suma de esas líneas (N rediseños = N clicks).
   *
   * Para departamentos normales (BORDADO, SUBLIMACIÓN, etc.) delega en
   * `calcCantidadPorTecnica` (cantidad de piezas afectadas).
   */
  private cantidadParaPaso(
    lineas: { producto?: string; tecnica?: string; cantidad: number }[],
    producto: string,
    tecnica: string | null | undefined,
    departamento: string | null | undefined,
    fallback: number,
  ): number {
    const dep = (departamento ?? '').toUpperCase().trim();
    const esDiseno = dep.startsWith('DISEÑO') || dep.startsWith('DISENO');
    if (esDiseno) {
      const lineasDiseno = lineas.filter(l => {
        const t = (l.tecnica ?? '').toUpperCase().trim();
        return t.startsWith('DISEÑO') || t.startsWith('DISENO')
            || t.startsWith('REDISEÑO') || t.startsWith('REDISENO');
      });
      if (lineasDiseno.length > 0) {
        return lineasDiseno.reduce((s, l) => s + Number(l.cantidad), 0);
      }
      return 1;
    }
    return lineas.length > 0
      ? this.calcCantidadPorTecnica(lineas, producto, tecnica ?? null)
      : fallback;
  }

  // Etiqueta de producto para un lote que cubre varias líneas/productos de una
  // misma técnica. 1 producto → su nombre; varios → lista (o "N productos" si es
  // muy larga para la columna varchar(255)). El conteo agrupa por
  // (orden, depto, producto, responsable), así que este label es estable.
  private labelProductos(prods: string[], fallback: string): string {
    const limpio = [...new Set(prods.filter(Boolean))];
    if (limpio.length === 0) return fallback || 'VARIOS';
    if (limpio.length === 1) return limpio[0];
    const join = limpio.join(', ');
    return join.length <= 240 ? join : `${limpio.length} productos`;
  }

  private calcCantidadPorTecnica(
    lineas: { producto?: string; tecnica?: string; cantidad: number }[],
    producto: string,
    tecnica?: string | null,
  ): number {
    if (!lineas.length) return 1;
    // Filtrar por producto (nombre exacto, case-insensitive)
    const byProd = lineas.filter(l =>
      (l.producto ?? '').toLowerCase().trim() === producto.toLowerCase().trim(),
    );
    const pool = byProd.length > 0 ? byProd : lineas;
    // Filtrar por técnica si aplica
    if (tecnica) {
      const t = tecnica.toLowerCase().trim();
      const byTec = pool.filter(l =>
        (l.tecnica ?? '').toLowerCase().trim() === t ||
        (l.tecnica ?? '').toLowerCase().includes(t) ||
        t.includes((l.tecnica ?? '').toLowerCase().trim()),
      );
      if (byTec.length > 0) return byTec.reduce((s, l) => s + Number(l.cantidad), 0);
    }
    return pool.reduce((s, l) => s + Number(l.cantidad), 0);
  }

  // ── Migración: actualizar cantidad de lotes existentes desde lineas_produccion
  async migrarCantidadesLotes(): Promise<{ updated: number }> {
    const ordenes = await this.repo.find({});
    let updated = 0;
    for (const orden of ordenes) {
      const lineas: { producto?: string; tecnica?: string; cantidad: number }[] =
        (orden.lineas_produccion as any[]) ?? [];
      if (!lineas.length) continue;
      const lotes = await this.lotesRepo.find({ where: { orden_id: orden.id } });
      for (const lote of lotes) {
        if (lote.estado === EstadoLote.COMPLETADO) continue; // no tocar completados
        const nueva = this.cantidadParaPaso(
          lineas, lote.producto, lote.tecnica, lote.departamento, lote.cantidad ?? 1,
        );
        if (nueva > 0 && lote.cantidad !== nueva) {
          await this.lotesRepo.update(lote.id, { cantidad: nueva });
          updated++;
        }
      }
    }
    return { updated };
  }

  // Aplicaciones por pieza (×N) que aplican a un departamento, según las técnicas
  // de la línea (ej. bordado pecho + manga = 2). Se captura al crear la orden en
  // tecnicas_aplicadas[].aplicaciones. Devuelve el máximo encontrado (default 1).
  private aplicacionesParaDepto(lineasOrden: any[], producto: string, departamento: string): number {
    const norm = (s: string) => (s ?? '').toUpperCase().trim();
    const dep = norm(departamento);
    let max = 1;
    for (const ln of lineasOrden ?? []) {
      if (producto && norm(ln?.producto) !== norm(producto)) continue;
      const tecs = Array.isArray(ln?.tecnicas_aplicadas) ? ln.tecnicas_aplicadas : [];
      for (const t of tecs) {
        const tDep = norm(t?.departamento_nombre || t?.nombre);
        if (tDep && (tDep === dep || dep.includes(tDep) || tDep.includes(dep))) {
          const n = Math.max(1, Math.floor(Number(t?.aplicaciones) || 1));
          if (n > max) max = n;
        }
      }
    }
    return max;
  }

  // ── Aplicar plantilla de ruta (crea todos los lotes de una vez) ──────────
  async aplicarPlantillaRuta(
    ordenId: number,
    pasos: Array<{ departamento: string; tipo_lote: string; orden_ejecucion: number; tipo_ejecucion: string; tareas?: { nombre: string; rol?: string; departamento?: string }[] }>,
    producto: string,
    cantidad = 1,
    marcarDisenoCompleto = false,
  ) {
    const orden = await this.repo.findOne({ where: { id: ordenId } });
    if (!orden) throw new NotFoundException(`Orden #${ordenId} no encontrada`);

    // Recalcular cantidad desde lineas_produccion si está disponible
    const lineasOrden: { producto?: string; tecnica?: string; cantidad: number }[] =
      (orden.lineas_produccion as any[]) ?? [];
    if (lineasOrden.length > 0) {
      cantidad = this.calcCantidadPorTecnica(lineasOrden, producto, null);
    }

    // Group pasos by orden_ejecucion
    const grupos = new Map<number, typeof pasos>();
    for (const p of pasos) {
      const g = grupos.get(p.orden_ejecucion) ?? [];
      g.push(p);
      grupos.set(p.orden_ejecucion, g);
    }
    const sortedExecs = [...grupos.keys()].sort((a, b) => a - b);

    // Buscar lotes existentes en esta orden
    const existentes = await this.lotesRepo.find({
      where: { orden_id: ordenId },
      order: { id: 'ASC' },
    });

    // BLOQUEO contra duplicación: si ya hay lotes en proceso o completados, NO
    // permitir reconfigurar la ruta. Antes este método borraba solo los
    // pendientes y creaba la cadena de nuevo, dejando los completados huérfanos
    // y generando ramas paralelas duplicadas (bug masivo encontrado el 2026-06-09
    // afectando 15+ órdenes activas).
    const conTrabajo = existentes.filter(
      l => l.estado === EstadoLote.EN_PROCESO || l.estado === EstadoLote.COMPLETADO,
    );
    if (conTrabajo.length > 0) {
      const detalle = conTrabajo
        .map(l => `${l.departamento} (${l.estado}${l.responsable ? ' por ' + l.responsable : ''})`)
        .join(', ');
      throw new BadRequestException(
        `Esta orden ya tiene lotes con trabajo registrado: ${detalle}. ` +
        `Para reconfigurar la ruta hay que cancelar primero los lotes con progreso, ` +
        `o pedir a un administrador que limpie la cadena.`,
      );
    }

    // No hay trabajo previo — borrar los pendientes/desbloqueados existentes y rearmar
    const eliminables = existentes.filter(
      l => l.estado === EstadoLote.PENDIENTE || l.estado === EstadoLote.DESBLOQUEADO,
    );
    if (eliminables.length > 0) {
      await this.lotesRepo.remove(eliminables);
    }
    // Calcular seq desde lotes que sobrevivieron (en_proceso / completado)
    const sobrevivientes = existentes.filter(l => !eliminables.includes(l));
    let lastSeq = sobrevivientes.length
      ? Math.max(...sobrevivientes.map(l => parseInt(l.numero.split('-L').pop() ?? '0')))
      : 0;

    const normDep = (s?: string | null) => (s ?? '').toUpperCase().trim();
    const esDisenoDep = (d?: string | null) => {
      const x = normDep(d);
      return x.startsWith('DISEÑO') || x.startsWith('DISENO')
          || x.startsWith('REDISEÑO') || x.startsWith('REDISENO');
    };

    // ── Un lote por TÉCNICA cubriendo TODAS las líneas (no por producto) ────────
    // Modelo confirmado por el dueño (jun 2026): cada técnica es UNA unidad con un
    // solo "Dividir". El reparto entre operarios se hace por LÍNEA de producto
    // dentro del modal Dividir (lineas_asignadas). Por eso se crea un único lote
    // por paso cuya cantidad = total de piezas de esa técnica y cuyo `producto`
    // resume los productos que la usan. El conteo por operario sigue correcto:
    // MAX por (orden, depto, producto, responsable) y luego SUM (dividirLote
    // reparte por responsable + lineas_asignadas).
    const infoDepto = (departamento: string) => {
      const dep = normDep(departamento);
      if (esDisenoDep(departamento)) {
        const dis = (lineasOrden as any[]).filter(l => {
          const t = normDep(l?.tecnica);
          return t.startsWith('DISEÑO') || t.startsWith('DISENO')
              || t.startsWith('REDISEÑO') || t.startsWith('REDISENO');
        });
        const cant = dis.length > 0 ? dis.reduce((s, l) => s + Number(l.cantidad || 0), 0) : 1;
        const prods = dis.map(l => (l.producto || '').trim());
        return { cantidad: cant || 1, productoLabel: this.labelProductos(prods, producto), aplicaciones: 1 };
      }
      const d = dep.toLowerCase();
      const match = (lineasOrden as any[]).filter(l => {
        const lt = (l?.tecnica ?? '').toLowerCase().trim();
        return !!lt && (lt.includes(d) || d.includes(lt));
      });
      const pool = match.length > 0 ? match : (lineasOrden as any[]);
      const cant = pool.reduce((s, l) => s + Number(l.cantidad || 0), 0) || 1;
      const prods = pool.map(l => (l.producto || '').trim());
      let aplic = 1;
      for (const ln of pool) {
        const tecs = Array.isArray(ln?.tecnicas_aplicadas) ? ln.tecnicas_aplicadas : [];
        for (const t of tecs) {
          const tDep = normDep(t?.departamento_nombre || t?.nombre);
          if (tDep && (tDep === dep || dep.includes(tDep) || tDep.includes(dep))) {
            const n = Math.max(1, Math.floor(Number(t?.aplicaciones) || 1));
            if (n > aplic) aplic = n;
          }
        }
      }
      return { cantidad: cant, productoLabel: this.labelProductos(prods, producto), aplicaciones: aplic };
    };

    const creados: LoteProduccion[] = [];
    const avisosFaltantes: string[] = [];
    let padreId: number | null = null;

    for (const exec of sortedExecs) {
      const isFirstGroup = padreId === null;
      const pasosGrupo = grupos.get(exec)!;
      let ultimoDelGrupo: LoteProduccion | null = null;

      for (const paso of pasosGrupo) {
        const info = infoDepto(paso.departamento);
        lastSeq++;
        const lote = this.lotesRepo.create({
          orden_id:        ordenId,
          numero:          `${orden.numero}-L${lastSeq}`,
          producto:        info.productoLabel,
          departamento:    paso.departamento,
          tipo_lote:       paso.tipo_lote as TipoLote,
          tipo_ejecucion:  paso.tipo_ejecucion as TipoEjecucion,
          orden_ejecucion: paso.orden_ejecucion,
          cantidad:        info.cantidad,
          aplicaciones_por_pieza: info.aplicaciones,
          estado:          isFirstGroup ? EstadoLote.DESBLOQUEADO : EstadoLote.PENDIENTE,
          lote_padre_id:   isFirstGroup ? null : padreId,
          desbloquear_al:  paso.departamento === 'Terminación' ? 'en_proceso' : 'completado',
        });
        const saved = await this.lotesRepo.save(lote);
        creados.push(saved);
        ultimoDelGrupo = saved;

        // Sub-tareas del paso (ej. espejo "BORDADO EN MAQUINA", o "DISEÑO DE BORDADO")
        if (paso.tareas && paso.tareas.length > 0) {
          for (const tarea of paso.tareas) {
            const deptoTarea = tarea.departamento ?? paso.departamento;
            const infoT = infoDepto(deptoTarea);
            lastSeq++;
            const tareaLote = this.lotesRepo.create({
              orden_id:        ordenId,
              numero:          `${orden.numero}-L${lastSeq}`,
              producto:        infoT.productoLabel,
              departamento:    deptoTarea,
              tipo_lote:       paso.tipo_lote as TipoLote,
              tipo_ejecucion:  paso.tipo_ejecucion as TipoEjecucion,
              orden_ejecucion: paso.orden_ejecucion,
              cantidad:        infoT.cantidad,
              aplicaciones_por_pieza: infoT.aplicaciones,
              estado:          isFirstGroup ? EstadoLote.DESBLOQUEADO : EstadoLote.PENDIENTE,
              lote_padre_id:   saved.id,
              tipo:            'tarea' as any,
              tarea_nombre:    tarea.nombre,
            });
            await this.lotesRepo.save(tareaLote);
          }
        }
      }
      if (ultimoDelGrupo) padreId = ultimoDelGrupo.id;
    }

    // ─── VALIDACIÓN PREVENTIVA: técnicas pedidas (de cualquier línea) sin lote ──
    // El flujo (plantilla de pasos) puede no cubrir TODAS las técnicas que las
    // líneas requieren. Detectamos las faltantes y auto-creamos su lote único.
    const deptosRequeridos = new Map<string, string>(); // normalizado → nombre original
    for (const ln of lineasOrden as any[]) {
      const tecs = Array.isArray(ln?.tecnicas_aplicadas) ? ln.tecnicas_aplicadas : [];
      for (const t of tecs) {
        const dep = t?.departamento_nombre;
        if (dep && normDep(dep)) deptosRequeridos.set(normDep(dep), dep);
      }
    }
    const deptosCubiertos = new Set<string>();
    for (const l of [...creados, ...sobrevivientes]) {
      if (l.departamento) deptosCubiertos.add(normDep(l.departamento));
    }
    const faltantes: string[] = [];
    for (const [norm, nombre] of deptosRequeridos) {
      if (!deptosCubiertos.has(norm)) faltantes.push(nombre);
    }

    if (faltantes.length > 0) {
      const execProduccion = creados.length > 0
        ? Math.min(...creados.map(l => l.orden_ejecucion ?? 1))
        : 1;
      for (const dep of faltantes) {
        const info = infoDepto(dep);
        lastSeq++;
        const loteFaltante = this.lotesRepo.create({
          orden_id:        ordenId,
          numero:          `${orden.numero}-L${lastSeq}`,
          producto:        info.productoLabel,
          departamento:    dep,
          tipo_lote:       TipoLote.PROCESO,
          tipo_ejecucion:  TipoEjecucion.PARALELO,
          orden_ejecucion: execProduccion,
          cantidad:        info.cantidad,
          aplicaciones_por_pieza: info.aplicaciones,
          estado:          EstadoLote.DESBLOQUEADO,
          lote_padre_id:   null,
          desbloquear_al:  'completado',
          notas:           `Lote auto-agregado por validación de ruta: técnica "${dep}" que el flujo no incluía.`,
        });
        const saved = await this.lotesRepo.save(loteFaltante);
        creados.push(saved);
      }
      avisosFaltantes.push(faltantes.join(', '));
    }

    if (avisosFaltantes.length > 0) {
      const aviso = `[Ruta ${new Date().toISOString().slice(0, 10)}] Lotes auto-agregados por técnicas faltantes — ${avisosFaltantes.join(' | ')} (la plantilla de flujo no las cubría).`;
      const notasPrevias = orden.notas ?? '';
      await this.repo.update(ordenId, {
        notas: notasPrevias ? `${notasPrevias}\n${aviso}` : aviso,
      });
    }

    // Auto-update order estado if currently "pendiente" (not yet started)
    if (orden.estado === EstadoOrden.PENDIENTE) {
      await this.repo.update(ordenId, { estado: EstadoOrden.EN_PRODUCCION });
    }

    // Marcar lotes de diseño como completado si se indicó que el diseño ya existe
    if (marcarDisenoCompleto) {
      const todosLotes = await this.lotesRepo.find({ where: { orden_id: ordenId } });
      const lotesDiseno = todosLotes.filter(l =>
        l.departamento?.toLowerCase().includes('diseño') ||
        l.tarea_nombre?.toLowerCase().includes('diseño')
      );
      for (const ld of lotesDiseno) {
        await this.lotesRepo.update(ld.id, {
          estado:        EstadoLote.COMPLETADO,
          tiempo_inicio: ld.tiempo_inicio ?? new Date(),
          tiempo_fin:    new Date(),
          responsable:   null, // diseño existente: nadie lo ejecutó, no debe contársele a nadie
        });
      }
    }

    return creados;
  }

  // ── Procesos de lote ──────────────────────────────────────────────────────

  async getProcesosLote(loteId: number): Promise<ProcesoLote[]> {
    return this.procesosRepo.find({
      where: { lote_id: loteId },
      order: { orden: 'ASC' },
    });
  }

  async iniciarProceso(procesoId: number, responsable?: string): Promise<ProcesoLote> {
    const proceso = await this.procesosRepo.findOne({ where: { id: procesoId } });
    if (!proceso) throw new NotFoundException(`Proceso #${procesoId} no encontrado`);

    await this.procesosRepo.update(procesoId, {
      estado: EstadoProceso.EN_PROCESO,
      tiempo_inicio: proceso.tiempo_inicio ?? new Date(),
      responsable: responsable ?? proceso.responsable,
    });
    return this.procesosRepo.findOne({ where: { id: procesoId } });
  }

  async pausarProceso(procesoId: number, motivo: string): Promise<ProcesoLote> {
    const proceso = await this.procesosRepo.findOne({ where: { id: procesoId } });
    if (!proceso) throw new NotFoundException(`Proceso #${procesoId} no encontrado`);

    const pausas: PausaProceso[] = [...(proceso.pausas ?? []), {
      motivo,
      inicio: new Date().toISOString(),
      fin: null,
    }];
    await this.procesosRepo.update(procesoId, { pausas });
    return this.procesosRepo.findOne({ where: { id: procesoId } });
  }

  async reanudarProceso(procesoId: number): Promise<ProcesoLote> {
    const proceso = await this.procesosRepo.findOne({ where: { id: procesoId } });
    if (!proceso) throw new NotFoundException(`Proceso #${procesoId} no encontrado`);

    const pausas = (proceso.pausas ?? []).map((p, i, arr) =>
      i === arr.length - 1 && p.fin === null
        ? { ...p, fin: new Date().toISOString() }
        : p
    );
    await this.procesosRepo.update(procesoId, { pausas });
    return this.procesosRepo.findOne({ where: { id: procesoId } });
  }

  async completarProceso(procesoId: number): Promise<ProcesoLote> {
    const proceso = await this.procesosRepo.findOne({ where: { id: procesoId } });
    if (!proceso) throw new NotFoundException(`Proceso #${procesoId} no encontrado`);

    // Close any open pause
    const pausas = (proceso.pausas ?? []).map((p, i, arr) =>
      i === arr.length - 1 && p.fin === null
        ? { ...p, fin: new Date().toISOString() }
        : p
    );

    await this.procesosRepo.update(procesoId, {
      estado: EstadoProceso.COMPLETADO,
      tiempo_fin: new Date(),
      pausas: pausas.length ? pausas : proceso.pausas,
    });
    return this.procesosRepo.findOne({ where: { id: procesoId } });
  }

  async crearProcesosParaLote(loteId: number, nombres: string[]): Promise<ProcesoLote[]> {
    const existentes = await this.procesosRepo.find({ where: { lote_id: loteId } });
    if (existentes.length > 0) return existentes; // already has processes

    const nuevos = nombres.map((nombre, i) =>
      this.procesosRepo.create({
        lote_id: loteId,
        nombre,
        orden: i,
        estado: EstadoProceso.PENDIENTE,
      })
    );
    return this.procesosRepo.save(nuevos);
  }

  // ── Reporte ───────────────────────────────────────────────────────────────
  async getReporte(desde?: string, hasta?: string) {
    const qb = this.repo.createQueryBuilder('o')
      .leftJoin('clientes', 'cl', 'cl.id = o.cliente_id')
      .addSelect('cl.nombre', 'cl_nombre');

    if (desde && hasta) {
      qb.where('DATE(o.creado_en) BETWEEN :desde AND :hasta', { desde, hasta });
    }

    qb.addOrderBy(`CASE o.semaforo WHEN 'critico' THEN 0 WHEN 'alerta' THEN 1 ELSE 2 END`, 'ASC')
      .addOrderBy('COALESCE(o.fecha_hora_entrega, o.fecha_comprometida)', 'ASC');

    const { entities, raw } = await qb.getRawAndEntities();

    const ids = entities.map(e => e.id);
    const todasTareas = ids.length
      ? await this.tareasRepo.createQueryBuilder('t')
          .where('t.orden_id IN (:...ids)', { ids })
          .getMany()
      : [];
    const todasPausas = ids.length
      ? await this.pausasRepo.createQueryBuilder('p')
          .where('p.orden_id IN (:...ids)', { ids })
          .getMany()
      : [];

    return entities.map((e, i) => {
      const tareas = todasTareas.filter(t => t.orden_id === e.id);
      const pausas = todasPausas.filter(p => p.orden_id === e.id);

      // Tiempo trabajado en minutos
      let tiempoTrabajoMs = 0;
      if (e.tiempo_inicio) {
        const fin = e.tiempo_fin ? new Date(e.tiempo_fin).getTime() : Date.now();
        let pausaMs = 0;
        for (const p of pausas) {
          const pFin = p.fecha_fin ? new Date(p.fecha_fin).getTime() : fin;
          pausaMs += pFin - new Date(p.fecha_inicio).getTime();
        }
        tiempoTrabajoMs = Math.max(0, fin - new Date(e.tiempo_inicio).getTime() - pausaMs);
      }

      return {
        ...e,
        responsables_secundarios: e.responsables_secundarios ?? [],
        cliente_nombre: raw[i]?.cl_nombre ?? `Cliente #${e.cliente_id}`,
        progreso_pct: this.calcProgreso(tareas),
        tiempo_trabajo_min: Math.round(tiempoTrabajoMs / 60000),
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENTREGA Y CONDUCES
  // ══════════════════════════════════════════════════════════════════════════

  /** Verifica que la orden tenga una factura activa. Lanza BadRequestException con
   *  prefijo 'sin_factura:' para que el frontend pueda distinguirlo. */
  private async verificarFactura(ordenId: number) {
    const rows = await this.ds.query<{ id: number }[]>(
      `SELECT id FROM facturas WHERE orden_produccion_id = ? AND estado != 'anulada' LIMIT 1`,
      [ordenId],
    );
    if (!rows.length) {
      throw new BadRequestException(
        'sin_factura:Esta orden no tiene factura. Genera la factura antes de entregar.',
      );
    }
  }

  /** Entrega simple — sin conduce. Solo valida factura y cambia estado a Entregado. */
  async entregar(id: number, dto: { entregado_por: string }) {
    const orden = await this.repo.findOne({ where: { id } });
    if (!orden) throw new NotFoundException(`Orden #${id} no encontrada`);

    const estadosValidos = [EstadoOrden.LISTO, EstadoOrden.LISTO_PARCIAL];
    if (!estadosValidos.includes(orden.estado)) {
      throw new BadRequestException('La orden debe estar en estado Listo para ser entregada.');
    }

    await this.verificarFactura(id);

    orden.estado           = EstadoOrden.ENTREGADO;
    orden.entregado_por    = dto.entregado_por;
    orden.fecha_entrega_real = new Date();
    return this.repo.save(orden);
  }

  /** Crea un conduce de entrega (parcial o total) con líneas editables. */
  async crearConduce(ordenId: number, dto: {
    entregado_por: string;
    recibido_por?: string;
    notas?: string;
    items: { linea_idx: number; cantidad_entregada: number }[];
  }) {
    const orden = await this.repo.findOne({ where: { id: ordenId } });
    if (!orden) throw new NotFoundException(`Orden #${ordenId} no encontrada`);

    const estadosValidos = [EstadoOrden.LISTO, EstadoOrden.LISTO_PARCIAL];
    if (!estadosValidos.includes(orden.estado)) {
      throw new BadRequestException('La orden debe estar en estado Listo para emitir un conduce.');
    }

    // NOTA: El conduce es alternativa a la factura para autorizar la salida de
    // mercancía. NO se requiere factura previa — la regla "factura O conduce"
    // (task #1) habilita ambas vías. La función `entregar()` (entrega simple
    // sin conduce) sí sigue exigiendo factura por separado.

    // Conduces previos → ya entregado por línea
    const previos = await this.conduceRepo.find({ where: { orden_id: ordenId } });
    const yaEntregado: Record<number, number> = {};
    for (const c of previos) {
      for (const item of c.items) {
        yaEntregado[item.linea_idx] = (yaEntregado[item.linea_idx] ?? 0) + item.cantidad_entregada;
      }
    }

    // Construir items del conduce
    const lineas = orden.lineas_produccion ?? [];
    const items: ConduceItem[] = dto.items.map(di => {
      const l = lineas[di.linea_idx] ?? { producto: '—', descripcion: '—', tecnica: '—', cantidad: 0 };
      return {
        linea_idx:             di.linea_idx,
        producto:              l.producto,
        descripcion:           l.descripcion,
        tecnica:               l.tecnica,
        cantidad_pedida:       l.cantidad,
        cantidad_ya_entregada: yaEntregado[di.linea_idx] ?? 0,
        cantidad_entregada:    di.cantidad_entregada,
      };
    });

    // ¿Total? — todas las líneas cubierta por todos los conduces incluido éste
    const esTotal = lineas.every((l, idx) => {
      const ya  = yaEntregado[idx] ?? 0;
      const now = dto.items.find(i => i.linea_idx === idx)?.cantidad_entregada ?? 0;
      return (ya + now) >= l.cantidad;
    });

    // Número secuencial CD-YYYY-NNN
    const year  = new Date().getFullYear();
    const ulti  = await this.ds.query<{ numero: string }[]>(
      `SELECT numero FROM conduces_entrega WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`,
      [`CD-${year}-%`],
    );
    const lastSeq = ulti.length ? parseInt(ulti[0].numero.split('-').pop() ?? '0') : 0;
    const numero  = `CD-${year}-${String(lastSeq + 1).padStart(3, '0')}`;

    const conduce = this.conduceRepo.create({
      numero,
      orden_id:      ordenId,
      orden_numero:  orden.numero,
      tipo:          esTotal ? TipoConduce.TOTAL : TipoConduce.PARCIAL,
      fecha:         new Date(),
      entregado_por: dto.entregado_por,
      recibido_por:  dto.recibido_por ?? null,
      items,
      notas:         dto.notas ?? null,
    });
    await this.conduceRepo.save(conduce);

    // Actualizar estado de la orden
    orden.estado = esTotal ? EstadoOrden.ENTREGADO : EstadoOrden.LISTO_PARCIAL;
    if (!orden.entregado_por) orden.entregado_por = dto.entregado_por;
    if (esTotal) orden.fecha_entrega_real = new Date();
    await this.repo.save(orden);

    return conduce;
  }

  /** Lista todos los conduces de una orden. */
  async getConduces(ordenId: number) {
    return this.conduceRepo.find({
      where: { orden_id: ordenId },
      order: { id: 'ASC' },
    });
  }

  /** Conduce individual con datos de la orden (para impresión). */
  async getConduce(conduceId: number) {
    const conduce = await this.conduceRepo.findOne({ where: { id: conduceId } });
    if (!conduce) throw new NotFoundException(`Conduce #${conduceId} no encontrado`);
    const orden   = await this.repo.findOne({ where: { id: conduce.orden_id } });

    // Enriquecer con info del cliente y factura (igual que findOne)
    const clienteRow = await this.ds.query<{ nombre: string; documento: string; telefono: string }[]>(
      `SELECT nombre, documento, telefono FROM clientes WHERE id = ? LIMIT 1`,
      [orden?.cliente_id],
    );
    const facturaRow = await this.ds.query<{ id: number; numero: string }[]>(
      `SELECT id, numero FROM facturas WHERE orden_produccion_id = ? AND estado != 'anulada' LIMIT 1`,
      [conduce.orden_id],
    );
    return {
      ...conduce,
      orden: orden ? {
        ...orden,
        cliente_nombre:    clienteRow[0]?.nombre    ?? `Cliente #${orden.cliente_id}`,
        cliente_documento: clienteRow[0]?.documento ?? null,
        cliente_telefono:  clienteRow[0]?.telefono  ?? null,
        factura_id:        facturaRow[0]?.id         ?? null,
        factura_numero:    facturaRow[0]?.numero      ?? null,
      } : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DISEÑO — flujo simplificado (sin Iniciar/Pausar/Completar con piezas)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Departamentos que usan flujo simplificado de "marcar listo" */
  private esLoteDeDiseno(lote: LoteProduccion): boolean {
    const dept = (lote.departamento ?? '').toUpperCase().trim();
    return dept.startsWith('DISEÑO') || dept.startsWith('DISENO');
  }

  /**
   * Marcar UN diseño como listo (incremento de 1 en piezas_ok).
   *
   * Para opción B del usuario: contador 0/N, click marca 1 por vez con
   * confirmación parcial. Cuando piezas_ok llega a `cantidad`, el lote se
   * completa y se cascadea como en el flujo normal (delegando a
   * `actualizarEstadoLote`).
   *
   * Tiempos según opción C: tiempo_inicio = tiempo_fin = NOW cuando completa
   * (duración 0). No falsifica tiempo trabajado.
   */
  async marcarDisenoListo(loteId: number, responsable?: string) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);
    if (!this.esLoteDeDiseno(lote)) {
      throw new BadRequestException('Este lote no es de diseño — usa el flujo normal de iniciar/completar');
    }
    if (lote.estado === EstadoLote.COMPLETADO) {
      throw new BadRequestException('Este diseño ya está completado');
    }
    if (lote.estado === EstadoLote.CANCELADO) {
      throw new BadRequestException('Este lote está cancelado');
    }
    if (lote.estado === EstadoLote.PENDIENTE) {
      throw new BadRequestException('Este diseño aún está bloqueado — debe completarse el paso previo');
    }

    const cantidad     = Number(lote.cantidad) || 1;
    const piezasActual = Number(lote.piezas_ok) || 0;
    const piezasNuevas = piezasActual + 1;

    if (piezasNuevas >= cantidad) {
      // Se completó. Delegar a actualizarEstadoLote para que cascadee
      // (desbloquear hijos, recalcular orden, registrar métrica, etc.)
      return this.actualizarEstadoLote(
        loteId,
        EstadoLote.COMPLETADO,
        responsable || lote.responsable || undefined,
        {
          piezas_ok:        cantidad,
          piezas_retrabajo: 0,
          piezas_descarte:  0,
        },
      );
    }

    // Parcial — incrementa contador, marca en proceso, NO completa
    const update: Partial<LoteProduccion> = {
      estado:    EstadoLote.EN_PROCESO,
      piezas_ok: piezasNuevas,
    };
    if (responsable) update.responsable = responsable;
    // tiempo_inicio solo si no existe (primer click)
    if (!lote.tiempo_inicio) update.tiempo_inicio = new Date();
    await this.lotesRepo.update(loteId, update);
    return this.lotesRepo.findOne({ where: { id: loteId } });
  }

  /**
   * Deshacer "diseño listo" — opción A: ventana 5 min.
   * Solo si el último cambio fue hace menos de 5 minutos.
   *
   * - Si el lote estaba completado, vuelve a en_proceso o desbloqueado (según piezas_ok).
   * - Decrementa piezas_ok en 1.
   *
   * NOTA: si el lote ya cascadeó (desbloqueó otros lotes hijos), revertir esto
   * NO los re-bloquea. Si el usuario necesita revertir un diseño completo
   * después de la ventana, debe usar el flujo admin (cancelar/reabrir).
   */
  async deshacerDisenoListo(loteId: number) {
    const lote = await this.lotesRepo.findOne({ where: { id: loteId } });
    if (!lote) throw new NotFoundException(`Lote #${loteId} no encontrado`);
    if (!this.esLoteDeDiseno(lote)) {
      throw new BadRequestException('Este lote no es de diseño');
    }

    const piezasActual = Number(lote.piezas_ok) || 0;
    if (piezasActual <= 0) {
      throw new BadRequestException('No hay nada que deshacer en este lote');
    }

    // Ventana de 5 min: usar tiempo_fin si está completado, sino actualizado_en
    const refTimestamp = lote.tiempo_fin
      ? new Date(lote.tiempo_fin).getTime()
      : (lote.actualizado_en ? new Date(lote.actualizado_en).getTime() : 0);
    const ageMs = Date.now() - refTimestamp;
    if (refTimestamp === 0 || ageMs > 5 * 60 * 1000) {
      throw new BadRequestException(
        'Ventana de 5 minutos para deshacer ya expiró. Pide al admin reabrir el lote.',
      );
    }

    const piezasNuevas = piezasActual - 1;
    const cantidad     = Number(lote.cantidad) || 1;

    const update: Partial<LoteProduccion> = {
      piezas_ok: piezasNuevas,
    };
    if (piezasNuevas === 0) {
      // Volver a estado inicial — desbloqueado, sin tiempo_inicio
      update.estado        = EstadoLote.DESBLOQUEADO;
      update.tiempo_inicio = null as any;
      update.tiempo_fin    = null as any;
    } else if (piezasNuevas < cantidad) {
      // Tenía completado (todo listo) y ahora vuelve a en_proceso parcial
      update.estado     = EstadoLote.EN_PROCESO;
      update.tiempo_fin = null as any;
    }
    await this.lotesRepo.update(loteId, update);
    return this.lotesRepo.findOne({ where: { id: loteId } });
  }
}
