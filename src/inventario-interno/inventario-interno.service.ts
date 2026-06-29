import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { InsumoDepto }           from './entities/insumo-depto.entity';
import { InsumoUnidad, EstadoUnidad } from './entities/insumo-unidad.entity';
import { InsumoRequerimiento, EstadoRequerimiento } from './entities/insumo-requerimiento.entity';
import { InsumoRequerimientoItem } from './entities/insumo-requerimiento-item.entity';

@Injectable()
export class InventarioInternoService {
  constructor(
    @InjectRepository(InsumoDepto)           private insumosRepo:  Repository<InsumoDepto>,
    @InjectRepository(InsumoUnidad)          private unidadesRepo: Repository<InsumoUnidad>,
    @InjectRepository(InsumoRequerimiento)   private reqRepo:      Repository<InsumoRequerimiento>,
    @InjectRepository(InsumoRequerimientoItem) private reqItemRepo: Repository<InsumoRequerimientoItem>,
  ) {}

  // ── CATÁLOGO DE INSUMOS ────────────────────────────────────────────────────

  async listarInsumos(departamento_id?: number): Promise<InsumoDepto[]> {
    const where: any = { activo: true };
    if (departamento_id) where.departamento_id = departamento_id;
    return this.insumosRepo.find({ where, order: { nombre: 'ASC' } });
  }

  async crearInsumo(dto: {
    departamento_id: number;
    departamento_nombre: string;
    nombre: string;
    descripcion?: string;
    unidad: string;
    stock_minimo?: number;
    creado_por?: string;
  }): Promise<InsumoDepto> {
    const insumo = this.insumosRepo.create({
      departamento_id:     dto.departamento_id,
      departamento_nombre: dto.departamento_nombre,
      nombre:              dto.nombre,
      descripcion:         dto.descripcion,
      unidad:              dto.unidad,
      stock_minimo:        dto.stock_minimo ?? 1,
      creado_por:          dto.creado_por,
    });
    return this.insumosRepo.save(insumo);
  }

  async actualizarInsumo(id: number, dto: Partial<{
    nombre: string;
    descripcion: string;
    unidad: string;
    stock_minimo: number;
    activo: boolean;
  }>): Promise<InsumoDepto> {
    await this.insumosRepo.update(id, dto);
    return this.insumosRepo.findOne({ where: { id } });
  }

  async eliminarInsumo(id: number): Promise<void> {
    await this.insumosRepo.update(id, { activo: false });
  }

  // ── RESUMEN POR DEPARTAMENTO (para el dashboard) ───────────────────────────

  async resumen(departamento_id?: number): Promise<any[]> {
    const where: any = { activo: true };
    if (departamento_id) where.departamento_id = departamento_id;
    const insumos = await this.insumosRepo.find({ where, order: { nombre: 'ASC' } });
    if (!insumos.length) return [];

    const ids = insumos.map(i => i.id);

    // Contar unidades por insumo y estado
    const counts = await this.unidadesRepo
      .createQueryBuilder('u')
      .select('u.insumo_id', 'insumo_id')
      .addSelect('u.estado', 'estado')
      .addSelect('COUNT(*)', 'total')
      .where('u.insumo_id IN (:...ids)', { ids })
      .groupBy('u.insumo_id')
      .addGroupBy('u.estado')
      .getRawMany();

    // Agrupar counts por insumo
    const countMap: Record<number, Record<string, number>> = {};
    for (const c of counts) {
      if (!countMap[c.insumo_id]) countMap[c.insumo_id] = {};
      countMap[c.insumo_id][c.estado] = parseInt(c.total);
    }

    return insumos.map(insumo => {
      const c = countMap[insumo.id] ?? {};
      const sellados = c[EstadoUnidad.SELLADO] ?? 0;
      const en_uso   = c[EstadoUnidad.EN_USO]  ?? 0;
      const agotados = c[EstadoUnidad.AGOTADO] ?? 0;
      return {
        ...insumo,
        sellados,
        en_uso,
        agotados,
        alerta: sellados < insumo.stock_minimo,
      };
    });
  }

  // ── UNIDADES INDIVIDUALES ──────────────────────────────────────────────────

  async listarUnidades(insumo_id: number): Promise<InsumoUnidad[]> {
    return this.unidadesRepo.find({
      where: { insumo_id },
      order: { creado_en: 'DESC' },
    });
  }

  async agregarUnidades(dto: {
    insumo_id: number;
    cantidad: number;
    notas?: string;
    registrado_por?: string;
  }): Promise<InsumoUnidad[]> {
    const insumo = await this.insumosRepo.findOne({ where: { id: dto.insumo_id } });
    if (!insumo) throw new NotFoundException('Insumo no encontrado');

    const unidades: InsumoUnidad[] = [];
    for (let i = 0; i < dto.cantidad; i++) {
      const u = this.unidadesRepo.create({
        insumo_id:     dto.insumo_id,
        estado:        EstadoUnidad.SELLADO,
        notas:         dto.notas,
        registrado_por: dto.registrado_por,
      });
      unidades.push(u);
    }
    return this.unidadesRepo.save(unidades);
  }

  async cambiarEstado(id: number, dto: {
    estado: EstadoUnidad;
    modificado_por?: string;
    notas?: string;
  }): Promise<InsumoUnidad> {
    const unidad = await this.unidadesRepo.findOne({ where: { id } });
    if (!unidad) throw new NotFoundException('Unidad no encontrada');

    // Validar transiciones: sellado → en_uso → agotado (o directo sellado → agotado)
    const transicionesValidas: Record<EstadoUnidad, EstadoUnidad[]> = {
      [EstadoUnidad.SELLADO]:  [EstadoUnidad.EN_USO, EstadoUnidad.AGOTADO],
      [EstadoUnidad.EN_USO]:   [EstadoUnidad.AGOTADO, EstadoUnidad.SELLADO],
      [EstadoUnidad.AGOTADO]:  [],
    };
    if (!transicionesValidas[unidad.estado].includes(dto.estado)) {
      throw new BadRequestException(
        `No se puede cambiar de '${unidad.estado}' a '${dto.estado}'`
      );
    }

    unidad.estado              = dto.estado;
    unidad.modificado_por      = dto.modificado_por;
    unidad.fecha_cambio_estado = new Date();
    if (dto.notas) unidad.notas = dto.notas;

    return this.unidadesRepo.save(unidad);
  }

  // ── REQUERIMIENTOS DE COMPRA ───────────────────────────────────────────────

  async listarRequerimientos(params?: {
    departamento_id?: number;
    estado?: EstadoRequerimiento;
  }): Promise<InsumoRequerimiento[]> {
    const where: any = {};
    if (params?.departamento_id) where.departamento_id = params.departamento_id;
    if (params?.estado)         where.estado           = params.estado;
    return this.reqRepo.find({
      where,
      relations: ['items'],
      order: { creado_en: 'DESC' },
    });
  }

  async crearRequerimiento(dto: {
    departamento_id: number;
    departamento_nombre: string;
    solicitado_por: string;
    notas_solicitud?: string;
    items: Array<{
      insumo_id?: number;
      nombre: string;
      unidad: string;
      cantidad_solicitada: number;
      notas?: string;
    }>;
  }): Promise<InsumoRequerimiento> {
    if (!dto.items?.length) throw new BadRequestException('El requerimiento debe tener al menos un ítem');

    const req = this.reqRepo.create({
      departamento_id:     dto.departamento_id,
      departamento_nombre: dto.departamento_nombre,
      solicitado_por:      dto.solicitado_por,
      notas_solicitud:     dto.notas_solicitud,
      estado:              EstadoRequerimiento.PENDIENTE,
      items:               dto.items.map(item => this.reqItemRepo.create({
        insumo_id:          item.insumo_id ?? null,
        nombre:             item.nombre,
        unidad:             item.unidad,
        cantidad_solicitada: item.cantidad_solicitada,
        notas:              item.notas,
      })),
    });
    return this.reqRepo.save(req);
  }

  async aprobarRequerimiento(id: number, aprobado_por: string, notas_admin?: string): Promise<InsumoRequerimiento> {
    const req = await this.reqRepo.findOne({ where: { id }, relations: ['items'] });
    if (!req) throw new NotFoundException(`Requerimiento #${id} no encontrado`);
    if (req.estado !== EstadoRequerimiento.PENDIENTE)
      throw new BadRequestException('Solo se pueden aprobar requerimientos pendientes');

    req.estado      = EstadoRequerimiento.APROBADO;
    req.aprobado_por = aprobado_por;
    req.aprobado_en  = new Date();
    req.notas_admin  = notas_admin;
    return this.reqRepo.save(req);
  }

  async rechazarRequerimiento(id: number, aprobado_por: string, notas_admin?: string): Promise<InsumoRequerimiento> {
    const req = await this.reqRepo.findOne({ where: { id }, relations: ['items'] });
    if (!req) throw new NotFoundException(`Requerimiento #${id} no encontrado`);

    req.estado      = EstadoRequerimiento.RECHAZADO;
    req.aprobado_por = aprobado_por;
    req.aprobado_en  = new Date();
    req.notas_admin  = notas_admin;
    return this.reqRepo.save(req);
  }

  async marcarComprado(id: number): Promise<InsumoRequerimiento> {
    const req = await this.reqRepo.findOne({ where: { id }, relations: ['items'] });
    if (!req) throw new NotFoundException(`Requerimiento #${id} no encontrado`);
    req.estado = EstadoRequerimiento.COMPRADO;
    return this.reqRepo.save(req);
  }

  /** Al recibir la compra: registra cantidades recibidas y agrega unidades selladas al stock */
  async recibirRequerimiento(id: number, dto: {
    recibido_por: string;
    items: Array<{ item_id: number; cantidad_recibida: number }>;
  }): Promise<InsumoRequerimiento> {
    const req = await this.reqRepo.findOne({ where: { id }, relations: ['items'] });
    if (!req) throw new NotFoundException(`Requerimiento #${id} no encontrado`);

    for (const recepcion of dto.items) {
      const item = req.items.find(i => i.id === recepcion.item_id);
      if (!item) continue;

      item.cantidad_recibida = recepcion.cantidad_recibida;
      await this.reqItemRepo.save(item);

      // Agregar unidades selladas al inventario si tiene insumo vinculado
      if (item.insumo_id && recepcion.cantidad_recibida > 0) {
        await this.agregarUnidades({
          insumo_id:      item.insumo_id,
          cantidad:       recepcion.cantidad_recibida,
          notas:          `Recibido con req #${id}`,
          registrado_por: dto.recibido_por,
        });
      }
    }

    req.estado = EstadoRequerimiento.RECIBIDO;
    return this.reqRepo.save(req);
  }
}
