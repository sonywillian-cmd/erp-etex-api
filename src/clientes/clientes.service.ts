import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Cliente } from './entities/cliente.entity';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { CreditoService } from './credito.service';

@Injectable()
export class ClientesService {
  constructor(
    @InjectRepository(Cliente) private repo: Repository<Cliente>,
    private credito: CreditoService,
  ) {}

  /**
   * POLÍTICA DE CRÉDITO: solo el admin otorga crédito directamente.
   * - Admin que marca 'credito' → queda APROBADO (registra quién y cuándo).
   * - Admin que marca 'contado' a un cliente aprobado → revoca (sin_credito, límite 0).
   * - Cualquier otro rol que marque 'credito' → NO se guarda como crédito; se convierte
   *   en una SOLICITUD al admin (Telegram + panel) y el cliente queda 'pendiente'.
   * Devuelve el dto saneado y, si aplica, la solicitud a crear tras guardar.
   */
  private aplicarPoliticaCredito(
    dto: Partial<CreateClienteDto>, user?: { id?: number; nombre?: string; rol?: string }, current?: Cliente,
  ): { dto: Partial<CreateClienteDto> & Record<string, any>; solicitar?: { limite: number; plazo: number } } {
    const out: Partial<CreateClienteDto> & Record<string, any> = { ...dto };
    if (dto.terminos_pago === undefined && dto.limite_credito === undefined && dto.plazo_credito === undefined) return { dto: out };
    const esAdmin = (user?.rol ?? '') === 'admin';
    const pideCredito = (dto.terminos_pago ?? current?.terminos_pago) === 'credito';
    if (esAdmin) {
      if (pideCredito) {
        out.terminos_pago = 'credito';
        out.credito_estado = 'aprobado';
        if (current?.credito_estado !== 'aprobado' || dto.limite_credito !== undefined || dto.plazo_credito !== undefined) {
          out.credito_aprobado_por = user?.nombre ?? 'admin';
          out.credito_aprobado_en  = new Date();
        }
      } else if (dto.terminos_pago === 'contado') {
        out.terminos_pago  = 'contado';
        out.credito_estado = 'sin_credito';
        out.limite_credito = 0;
        out.plazo_credito  = null as any;
      }
      return { dto: out };
    }
    // No admin: nunca puede escribir los campos de crédito
    delete out.terminos_pago; delete out.limite_credito; delete out.plazo_credito;
    if (dto.terminos_pago === 'credito' && current?.credito_estado !== 'aprobado') {
      const limite = Number(dto.limite_credito ?? 0); const plazo = Number(dto.plazo_credito ?? 30) || 30;
      if (limite > 0) return { dto: out, solicitar: { limite, plazo } };
    }
    return { dto: out };
  }

  /**
   * Para clientes tipo "persona" el nombre debe incluir al menos dos palabras
   * (nombre + apellido o dos nombres). Se aplica tanto al crear como al editar.
   * Las empresas pueden tener un solo nombre comercial.
   */
  private validarNombrePersona(tipo: string | undefined, nombre: string) {
    if ((tipo ?? 'empresa') !== 'persona') return;
    const palabras = nombre.trim().split(/\s+/).filter(p => p.length >= 2);
    if (palabras.length < 2) {
      throw new BadRequestException(
        `Para clientes tipo "persona" el nombre debe incluir al menos dos palabras (ej: nombre + apellido). Recibido: "${nombre.trim()}".`,
      );
    }
  }

  async findAll(query?: { search?: string; estado?: string; ciudad?: string }) {
    const qb = this.repo.createQueryBuilder('c').orderBy('c.nombre', 'ASC');
    if (query?.search) {
      qb.andWhere(
        '(c.nombre LIKE :s OR c.documento LIKE :s OR c.email LIKE :s OR c.telefono LIKE :s)',
        { s: `%${query.search}%` },
      );
    }
    if (query?.estado) qb.andWhere('c.estado = :estado', { estado: query.estado });
    if (query?.ciudad) qb.andWhere('c.ciudad LIKE :ciudad', { ciudad: `%${query.ciudad}%` });
    return qb.getMany();
  }

  async findOne(id: number) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException(`Cliente #${id} no encontrado`);
    return c;
  }

  /**
   * Verifica unicidad de nombre, documento (RNC/cédula) y teléfono. excludeId se usa en updates.
   * (Portado desde dist del VPS el 6-sep-2026: devuelve el cliente duplicado en la respuesta
   *  para que el frontend ofrezca "usar el existente".)
   */
  private async checkUnique(nombre: string, telefono: string, documento: string, excludeId?: number) {
    const arrojarDuplicado = (campo: 'nombre' | 'documento' | 'telefono', cliente: Cliente) => {
      throw new ConflictException({
        message: `Ya existe un cliente con ese ${campo === 'documento' ? 'RNC/cédula' : campo}: "${cliente.nombre}"`,
        duplicado: {
          campo,
          cliente: {
            id: cliente.id,
            nombre: cliente.nombre,
            documento: cliente.documento ?? null,
            telefono: cliente.telefono ?? null,
          },
        },
      });
    };
    // 1) Nombre único (case-insensitive normalizado)
    const nameQb = this.repo.createQueryBuilder('c')
      .where('UPPER(TRIM(c.nombre)) = UPPER(TRIM(:nombre))', { nombre });
    if (excludeId) nameQb.andWhere('c.id != :id', { id: excludeId });
    const dupNombre = await nameQb.getOne();
    if (dupNombre) arrojarDuplicado('nombre', dupNombre);
    // 2) Documento (RNC/cédula) único — solo si se provee
    if (documento && String(documento).trim()) {
      const docNorm = String(documento).replace(/[^0-9A-Za-z]/g, '');
      if (docNorm) {
        const docQb = this.repo.createQueryBuilder('c')
          .where("REPLACE(REPLACE(c.documento, '-', ''), ' ', '') = :doc", { doc: docNorm });
        if (excludeId) docQb.andWhere('c.id != :id', { id: excludeId });
        const dupDoc = await docQb.getOne();
        if (dupDoc) arrojarDuplicado('documento', dupDoc);
      }
    }
    // 3) Teléfono único (solo si se provee)
    if (telefono && String(telefono).trim()) {
      const telNorm = String(telefono).replace(/[^0-9]/g, '');
      if (telNorm.length >= 7) {
        const phoneQb = this.repo.createQueryBuilder('c')
          .where("REGEXP_REPLACE(c.telefono, '[^0-9]', '') = :tel", { tel: telNorm });
        if (excludeId) phoneQb.andWhere('c.id != :id', { id: excludeId });
        const dupTel = await phoneQb.getOne();
        if (dupTel) arrojarDuplicado('telefono', dupTel);
      }
    }
  }

  async create(dto: CreateClienteDto, user?: { id?: number; nombre?: string; rol?: string }) {
    const nombre = (dto.nombre ?? '').toUpperCase().trim();
    this.validarNombrePersona(dto.tipo, nombre);
    await this.checkUnique(nombre, dto.telefono ?? '', dto.documento ?? '');
    const pol = this.aplicarPoliticaCredito(dto, user);
    const cliente = this.repo.create({ ...(pol.dto as any), nombre, terminos_pago: pol.dto.terminos_pago ?? 'contado' });
    const guardado: any = await this.repo.save(cliente);
    if (pol.solicitar) {
      const sol = await this.credito.solicitar(guardado.id, { ...pol.solicitar, motivo: 'Solicitado al crear el cliente' }, user ?? {})
        .catch(e => ({ ok: false, mensaje: e?.message }));
      return { ...(await this.findOne(guardado.id)), credito_solicitud: sol };
    }
    return guardado;
  }

  async update(id: number, dto: Partial<CreateClienteDto>, user?: { id?: number; nombre?: string; rol?: string }) {
    const current = await this.findOne(id);
    const nombre = dto.nombre ? dto.nombre.toUpperCase().trim() : current.nombre;
    const telefono = dto.telefono !== undefined ? dto.telefono : (current.telefono ?? '');
    const documento = dto.documento !== undefined ? dto.documento : (current.documento ?? '');
    const tipoEfectivo = dto.tipo ?? current.tipo;
    this.validarNombrePersona(tipoEfectivo, nombre);
    await this.checkUnique(nombre, telefono, documento, id);
    const pol = this.aplicarPoliticaCredito(dto, user, current);
    const toSave: any = { ...pol.dto, nombre };
    await this.repo.update(id, toSave);
    if (pol.solicitar) {
      const sol = await this.credito.solicitar(id, { ...pol.solicitar, motivo: 'Solicitado desde la ficha del cliente' }, user ?? {})
        .catch(e => ({ ok: false, mensaje: e?.message }));
      return { ...(await this.findOne(id)), credito_solicitud: sol };
    }
    return this.findOne(id);
  }

  async remove(id: number) {
    const c = await this.findOne(id);
    await this.repo.remove(c);
    return { message: `Cliente #${id} eliminado` };
  }

  // Búsqueda rápida para autocomplete (incluye teléfono)
  async buscar(q: string) {
    return this.repo.find({
      where: [
        { nombre: ILike(`%${q}%`) },
        { documento: ILike(`%${q}%`) },
        { telefono: ILike(`%${q}%`) },
      ],
      take: 8,
      order: { nombre: 'ASC' },
    });
  }
}
