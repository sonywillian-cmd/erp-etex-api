import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { EmpleadoFicha, EstadoEmpleado } from './entities/empleado-ficha.entity';
import {
  EmpleadoVacacion, EstadoPagoVacacion,
} from './entities/empleado-vacacion.entity';
import {
  EmpleadoDocumento, TipoDocumento,
} from './entities/empleado-documento.entity';
import { CreateEmpleadoDto } from './dto/create-empleado.dto';
import { UpdateEmpleadoDto } from './dto/update-empleado.dto';
import {
  CreateVacacionDto, UpdateVacacionDto, RegistrarPagoVacacionDto,
} from './dto/vacacion.dto';

function upper(v: any): any {
  if (v == null) return v;
  if (typeof v !== 'string') return v;
  return v.toUpperCase();
}

@Injectable()
export class EmpleadosService {
  constructor(
    @InjectRepository(EmpleadoFicha)     private readonly fichaRepo: Repository<EmpleadoFicha>,
    @InjectRepository(EmpleadoVacacion)  private readonly vacRepo:   Repository<EmpleadoVacacion>,
    @InjectRepository(EmpleadoDocumento) private readonly docRepo:   Repository<EmpleadoDocumento>,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // FICHA — CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async listar(filtros?: {
    estado?: string; departamento?: string; q?: string;
  }): Promise<any[]> {
    const qb = this.fichaRepo.createQueryBuilder('e')
      .orderBy('e.estado', 'ASC')
      .addOrderBy('e.nombre_completo', 'ASC');

    if (filtros?.estado)       qb.andWhere('e.estado = :estado',          { estado: filtros.estado });
    if (filtros?.departamento) qb.andWhere('e.departamento = :dept',      { dept: filtros.departamento });
    if (filtros?.q) {
      qb.andWhere(
        '(e.nombre_completo LIKE :q OR e.cedula_pasaporte LIKE :q OR e.codigo_empleado LIKE :q OR e.puesto LIKE :q)',
        { q: `%${filtros.q}%` },
      );
    }
    return qb.getMany();
  }

  async obtener(id: number): Promise<EmpleadoFicha> {
    const e = await this.fichaRepo.findOne({
      where: { id },
      relations: ['vacaciones', 'documentos'],
    });
    if (!e) throw new NotFoundException(`Empleado #${id} no encontrado`);
    return e;
  }

  /** Unificación Operarios↔Empleados: ficha por usuario_id, creándola si no existe. */
  async fichaPorUsuario(usuarioId: number): Promise<{ id: number; usuario_id: number; creada: boolean }> {
    const existente = await this.fichaRepo.findOne({ where: { usuario_id: usuarioId } as any });
    if (existente) return { id: existente.id, usuario_id: usuarioId, creada: false };
    const u = await this.fichaRepo.manager.query(
      `SELECT nombre, departamento, cargo, codigo_empleado FROM usuarios WHERE id = ? AND activo = 1`,
      [usuarioId]);
    if (!u.length) throw new NotFoundException(`Usuario #${usuarioId} no existe o está inactivo`);
    const nueva = this.fichaRepo.create({
      usuario_id: usuarioId,
      nombre_completo: (u[0].nombre ?? `USUARIO ${usuarioId}`).toUpperCase(),
      departamento: u[0].departamento ?? null,
      cargo: u[0].cargo ?? null,
      codigo_empleado: u[0].codigo_empleado ?? (await this.generarCodigo()),
      creado_por: 'sistema',
    } as any) as unknown as EmpleadoFicha;
    const guardada = await this.fichaRepo.save(nueva);
    await this.sincronizarCodigoUsuario(guardada);
    return { id: guardada.id, usuario_id: usuarioId, creada: true };
  }

  /** Construye payload normalizado: nombre/dirección en MAYÚSCULAS, vacíos a null. */
  private normalizar(dto: any): any {
    const camposMayus = new Set([
      'nombre_completo', 'cedula_pasaporte', 'codigo_empleado',
      'direccion', 'sector_ciudad', 'cargo', 'departamento', 'sucursal',
      'supervisor_inmediato', 'profesion', 'carrera_estudiada',
      'institucion_educativa', 'banco', 'titular_cuenta',
      'emerg_nombre', 'emerg_parentesco', 'emerg_direccion',
      'ars', 'afp', 'firmada_por_rrhh', 'motivo_baja',
    ]);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v === '') out[k] = null;
      else if (camposMayus.has(k)) out[k] = upper(v);
      else out[k] = v;
    }
    return out;
  }

  async crear(dto: CreateEmpleadoDto, creadoPor?: string): Promise<EmpleadoFicha> {
    if (!dto.nombre_completo?.trim()) {
      throw new BadRequestException('El nombre completo es requerido');
    }
    // Unicidad de cédula si se da
    if (dto.cedula_pasaporte) {
      const dup = await this.fichaRepo.findOne({
        where: { cedula_pasaporte: dto.cedula_pasaporte },
      });
      if (dup) throw new ConflictException(`Ya existe un empleado con esa cédula/pasaporte`);
    }
    // Unicidad de codigo_empleado si se da
    if (dto.codigo_empleado) {
      const dup = await this.fichaRepo.findOne({
        where: { codigo_empleado: dto.codigo_empleado },
      });
      if (dup) throw new ConflictException(`Ya existe un empleado con ese código`);
    }
    // Si vincula a usuario, validar que no esté ocupado
    if (dto.usuario_id) {
      const dup = await this.fichaRepo.findOne({
        where: { usuario_id: dto.usuario_id },
      });
      if (dup) throw new ConflictException(`Ese usuario ya tiene una ficha de empleado`);
    }

    const e = this.fichaRepo.create({
      ...this.normalizar(dto),
      codigo_empleado: dto.codigo_empleado?.trim() || (await this.generarCodigo()),
      creado_por: creadoPor,
    } as Partial<EmpleadoFicha>);
    const guardado = await this.fichaRepo.save(e as EmpleadoFicha);
    await this.sincronizarCodigoUsuario(guardado);
    return guardado;
  }

  /** Genera el siguiente código secuencial ETX-001, ETX-002, ... */
  private async generarCodigo(): Promise<string> {
    const r = await this.fichaRepo.manager.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(codigo_empleado, 5) AS UNSIGNED)), 0) AS max
         FROM empleados_ficha WHERE codigo_empleado REGEXP '^ETX-[0-9]+$'`);
    const n = Number(r[0]?.max ?? 0) + 1;
    return `ETX-${String(n).padStart(3, '0')}`;
  }

  /** Mantiene usuarios.codigo_empleado igual al de la ficha vinculada. */
  private async sincronizarCodigoUsuario(f: EmpleadoFicha): Promise<void> {
    if (f.usuario_id && f.codigo_empleado) {
      await this.fichaRepo.manager.query(
        `UPDATE usuarios SET codigo_empleado = ? WHERE id = ?`,
        [f.codigo_empleado, f.usuario_id]);
    }
  }

  async actualizar(id: number, dto: UpdateEmpleadoDto): Promise<EmpleadoFicha> {
    await this.obtener(id);

    // Cédula única (si cambia)
    if (dto.cedula_pasaporte) {
      const dup = await this.fichaRepo.createQueryBuilder('e')
        .where('e.cedula_pasaporte = :c AND e.id != :id', { c: dto.cedula_pasaporte, id })
        .getOne();
      if (dup) throw new ConflictException('Otro empleado ya tiene esa cédula/pasaporte');
    }

    await this.fichaRepo.update(id, this.normalizar(dto) as any);
    return this.obtener(id);
  }

  async darDeBaja(id: number, motivo: string, fecha?: string): Promise<EmpleadoFicha> {
    await this.obtener(id);
    await this.fichaRepo.update(id, {
      estado:      EstadoEmpleado.BAJA,
      fecha_baja:  fecha || new Date().toISOString().slice(0, 10),
      motivo_baja: motivo || 'Sin motivo registrado',
    });
    return this.obtener(id);
  }

  async eliminar(id: number): Promise<{ ok: boolean }> {
    const e = await this.obtener(id);
    if (e.estado !== EstadoEmpleado.BAJA) {
      throw new BadRequestException(
        'Para eliminar primero hay que dar de baja al empleado',
      );
    }
    await this.fichaRepo.delete(id);
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VACACIONES
  // ═══════════════════════════════════════════════════════════════════════════

  async listarVacaciones(empleadoId: number): Promise<EmpleadoVacacion[]> {
    await this.obtener(empleadoId);
    return this.vacRepo.find({
      where: { empleado_id: empleadoId },
      order: { periodo: 'DESC' },
    });
  }

  async crearVacacion(
    empleadoId: number, dto: CreateVacacionDto, creadoPor?: string,
  ): Promise<EmpleadoVacacion> {
    await this.obtener(empleadoId);
    // Único por (empleado, periodo)
    const dup = await this.vacRepo.findOne({
      where: { empleado_id: empleadoId, periodo: dto.periodo },
    });
    if (dup) {
      throw new ConflictException(
        `Ya existe un registro de vacaciones del periodo ${dto.periodo} para este empleado`,
      );
    }
    const v = this.vacRepo.create({
      empleado_id: empleadoId,
      ...dto,
      creado_por:  creadoPor,
    } as Partial<EmpleadoVacacion>);
    return this.vacRepo.save(v as EmpleadoVacacion);
  }

  async actualizarVacacion(
    vacId: number, dto: UpdateVacacionDto,
  ): Promise<EmpleadoVacacion> {
    const v = await this.vacRepo.findOne({ where: { id: vacId } });
    if (!v) throw new NotFoundException(`Registro de vacación #${vacId} no encontrado`);
    await this.vacRepo.update(vacId, dto as any);
    return this.vacRepo.findOne({ where: { id: vacId } }) as Promise<EmpleadoVacacion>;
  }

  /**
   * Aplica un abono al pago de las vacaciones. Suma a `monto_pagado` y
   * recalcula `estado_pago` automáticamente.
   */
  async registrarPagoVacacion(
    vacId: number, dto: RegistrarPagoVacacionDto,
  ): Promise<EmpleadoVacacion> {
    const v = await this.vacRepo.findOne({ where: { id: vacId } });
    if (!v) throw new NotFoundException(`Registro de vacación #${vacId} no encontrado`);
    if (v.estado_pago === EstadoPagoVacacion.PAGADA) {
      throw new BadRequestException('Estas vacaciones ya están pagadas');
    }
    if (v.estado_pago === EstadoPagoVacacion.NO_APLICA) {
      throw new BadRequestException('Estas vacaciones se tomaron, no aplica pago');
    }

    const pagadoNuevo = Number(v.monto_pagado) + Number(dto.monto);
    const aPagar     = Number(v.monto_a_pagar) || 0;

    let estado: EstadoPagoVacacion = EstadoPagoVacacion.PARCIAL;
    if (aPagar > 0 && pagadoNuevo >= aPagar - 0.01) estado = EstadoPagoVacacion.PAGADA;
    if (pagadoNuevo === 0)                          estado = EstadoPagoVacacion.PENDIENTE;

    await this.vacRepo.update(vacId, {
      monto_pagado:  pagadoNuevo,
      estado_pago:   estado,
      fecha_pago:    dto.fecha || new Date().toISOString().slice(0, 10),
      metodo_pago:   dto.metodo_pago || v.metodo_pago,
      referencia:    dto.referencia  || v.referencia,
      notas:         dto.notas       || v.notas,
    });
    return this.vacRepo.findOne({ where: { id: vacId } }) as Promise<EmpleadoVacacion>;
  }

  async eliminarVacacion(vacId: number): Promise<{ ok: boolean }> {
    const v = await this.vacRepo.findOne({ where: { id: vacId } });
    if (!v) throw new NotFoundException(`Registro de vacación #${vacId} no encontrado`);
    if (Number(v.monto_pagado) > 0) {
      throw new BadRequestException('No se puede eliminar: ya tiene abonos registrados');
    }
    await this.vacRepo.delete(vacId);
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENTOS
  // ═══════════════════════════════════════════════════════════════════════════

  async listarDocumentos(empleadoId: number): Promise<EmpleadoDocumento[]> {
    await this.obtener(empleadoId);
    return this.docRepo.find({
      where: { empleado_id: empleadoId },
      order: { creado_en: 'DESC' },
    });
  }

  async agregarDocumento(empleadoId: number, dto: {
    tipo: TipoDocumento;
    nombre_archivo: string;
    url: string;
    mime_type?: string;
    tamano_bytes?: number;
    descripcion?: string;
    subido_por?: string;
  }): Promise<EmpleadoDocumento> {
    await this.obtener(empleadoId);
    const d = this.docRepo.create({ empleado_id: empleadoId, ...dto } as Partial<EmpleadoDocumento>);
    return this.docRepo.save(d as EmpleadoDocumento);
  }

  async eliminarDocumento(docId: number): Promise<{ ok: boolean }> {
    const d = await this.docRepo.findOne({ where: { id: docId } });
    if (!d) throw new NotFoundException(`Documento #${docId} no encontrado`);
    await this.docRepo.delete(docId);
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTADÍSTICAS GLOBALES (para el dashboard del módulo)
  // ═══════════════════════════════════════════════════════════════════════════

  async resumen(): Promise<{
    total: number;
    por_estado: { estado: string; cantidad: number }[];
    por_departamento: { departamento: string; cantidad: number }[];
    vacaciones_pendientes: number;
    monto_vacaciones_pendiente: number;
  }> {
    const total = await this.fichaRepo.count();

    const porEstadoRaw = await this.fichaRepo.createQueryBuilder('e')
      .select('e.estado', 'estado')
      .addSelect('COUNT(*)', 'cantidad')
      .groupBy('e.estado')
      .getRawMany<{ estado: string; cantidad: string }>();

    const porDeptoRaw = await this.fichaRepo.createQueryBuilder('e')
      .select("COALESCE(e.departamento, '')", 'departamento')
      .addSelect('COUNT(*)', 'cantidad')
      .groupBy('e.departamento')
      .orderBy('cantidad', 'DESC')
      .getRawMany<{ departamento: string; cantidad: string }>();

    const pend = await this.vacRepo.createQueryBuilder('v')
      .select('COUNT(*)', 'cant')
      .addSelect('COALESCE(SUM(v.monto_a_pagar - v.monto_pagado), 0)', 'monto')
      .where('v.estado_pago IN (:...e)', { e: ['pendiente', 'parcial'] })
      .getRawOne<{ cant: string; monto: string }>();

    return {
      total,
      por_estado:       porEstadoRaw.map(r => ({ estado: r.estado, cantidad: Number(r.cantidad) })),
      por_departamento: porDeptoRaw.map(r => ({ departamento: r.departamento || '', cantidad: Number(r.cantidad) })),
      vacaciones_pendientes:      Number(pend?.cant) || 0,
      monto_vacaciones_pendiente: Number(pend?.monto) || 0,
    };
  }
}
