import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Cliente } from './entities/cliente.entity';
import { CreateClienteDto } from './dto/create-cliente.dto';

@Injectable()
export class ClientesService {
  constructor(@InjectRepository(Cliente) private repo: Repository<Cliente>) {}

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

  /** Verifica unicidad de nombre y teléfono. excludeId se usa en updates. */
  private async checkUnique(nombre: string, telefono: string, excludeId?: number) {
    // Nombre único
    const nameQb = this.repo.createQueryBuilder('c')
      .where('c.nombre = :nombre', { nombre });
    if (excludeId) nameQb.andWhere('c.id != :id', { id: excludeId });
    if (await nameQb.getOne()) {
      throw new ConflictException(`Ya existe un cliente con el nombre "${nombre}"`);
    }

    // Teléfono único (solo si se provee)
    if (telefono) {
      const phoneQb = this.repo.createQueryBuilder('c')
        .where('c.telefono = :telefono', { telefono });
      if (excludeId) phoneQb.andWhere('c.id != :id', { id: excludeId });
      if (await phoneQb.getOne()) {
        throw new ConflictException(`Ya existe un cliente con el teléfono "${telefono}"`);
      }
    }
  }

  async create(dto: CreateClienteDto) {
    const nombre = (dto.nombre ?? '').toUpperCase().trim();
    this.validarNombrePersona(dto.tipo, nombre);
    await this.checkUnique(nombre, dto.telefono ?? '');
    const cliente = this.repo.create({ ...dto, nombre });
    return this.repo.save(cliente);
  }

  async update(id: number, dto: Partial<CreateClienteDto>) {
    const current = await this.findOne(id);
    const nombre = dto.nombre ? dto.nombre.toUpperCase().trim() : current.nombre;
    const telefono = dto.telefono !== undefined ? dto.telefono : (current.telefono ?? '');
    const tipoEfectivo = dto.tipo ?? current.tipo;
    this.validarNombrePersona(tipoEfectivo, nombre);
    await this.checkUnique(nombre, telefono, id);
    const toSave: Partial<CreateClienteDto> = { ...dto, nombre };
    await this.repo.update(id, toSave);
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
