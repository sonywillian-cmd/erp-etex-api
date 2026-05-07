import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Proveedor } from './entities/proveedor.entity';
import { ProveedorProducto } from './entities/proveedor-producto.entity';

@Injectable()
export class ProveedoresService {
  constructor(
    @InjectRepository(Proveedor) private provRepo: Repository<Proveedor>,
    @InjectRepository(ProveedorProducto) private ppRepo: Repository<ProveedorProducto>,
  ) {}

  findAll(q?: { search?: string; activo?: string }) {
    const qb = this.provRepo.createQueryBuilder('p').orderBy('p.nombre', 'ASC');
    if (q?.search) {
      qb.andWhere('(p.nombre LIKE :s OR p.email LIKE :s)', { s: `%${q.search}%` });
    }
    if (q?.activo !== undefined && q.activo !== '') {
      qb.andWhere('p.activo = :a', { a: q.activo === 'true' || q.activo === '1' });
    }
    return qb.getMany();
  }

  async findOne(id: number) {
    const p = await this.provRepo.findOne({ where: { id }, relations: ['productos'] });
    if (!p) throw new NotFoundException(`Proveedor #${id} no encontrado`);
    return p;
  }

  async create(data: {
    nombre: string;
    persona_contacto?: string;
    telefono?: string;
    email?: string;
    direccion?: string;
    notas?: string;
    activo?: boolean;
    productos?: Array<{
      producto_id: number;
      producto_nombre?: string;
      precio_compra?: number;
      tiempo_entrega?: string;
      codigo_proveedor?: string;
    }>;
  }) {
    const { productos, ...fields } = data;
    const proveedor = this.provRepo.create(fields);
    const saved = await this.provRepo.save(proveedor);

    if (productos && productos.length > 0) {
      const links = productos.map(p =>
        this.ppRepo.create({ ...p, proveedor_id: saved.id }),
      );
      await this.ppRepo.save(links);
    }

    return this.findOne(saved.id);
  }

  async update(id: number, data: {
    nombre?: string;
    persona_contacto?: string | null;
    telefono?: string | null;
    email?: string | null;
    direccion?: string | null;
    notas?: string | null;
    activo?: boolean;
    productos?: Array<{
      producto_id: number;
      producto_nombre?: string;
      precio_compra?: number;
      tiempo_entrega?: string;
      codigo_proveedor?: string;
    }>;
  }) {
    await this.findOne(id);
    const { productos, ...fields } = data;

    if (Object.keys(fields).length > 0) {
      await this.provRepo.update(id, fields as any);
    }

    if (productos !== undefined) {
      // Sync: delete existing and re-insert
      await this.ppRepo.delete({ proveedor_id: id });
      if (productos.length > 0) {
        const links = productos.map(p =>
          this.ppRepo.create({ ...p, proveedor_id: id }),
        );
        await this.ppRepo.save(links);
      }
    }

    return this.findOne(id);
  }

  async toggle(id: number) {
    const p = await this.findOne(id);
    await this.provRepo.update(id, { activo: !p.activo });
    return this.findOne(id);
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.provRepo.delete(id);
    return { message: `Proveedor #${id} eliminado` };
  }

  getProductos(id: number) {
    return this.ppRepo.find({ where: { proveedor_id: id }, order: { producto_nombre: 'ASC' } });
  }

  async addProducto(id: number, data: {
    producto_id: number;
    producto_nombre?: string;
    precio_compra?: number;
    tiempo_entrega?: string;
    codigo_proveedor?: string;
  }) {
    await this.findOne(id);
    const existing = await this.ppRepo.findOne({
      where: { proveedor_id: id, producto_id: data.producto_id },
    });
    if (existing) {
      throw new BadRequestException(`El producto #${data.producto_id} ya está asociado a este proveedor`);
    }
    const link = this.ppRepo.create({ ...data, proveedor_id: id });
    return this.ppRepo.save(link);
  }

  async updateProducto(proveedorId: number, productoId: number, data: {
    producto_nombre?: string;
    precio_compra?: number;
    tiempo_entrega?: string;
    codigo_proveedor?: string;
  }) {
    const link = await this.ppRepo.findOne({
      where: { proveedor_id: proveedorId, producto_id: productoId },
    });
    if (!link) {
      throw new NotFoundException(`Relación proveedor #${proveedorId} / producto #${productoId} no encontrada`);
    }
    await this.ppRepo.update(link.id, data);
    return this.ppRepo.findOne({ where: { id: link.id } });
  }

  async removeProducto(proveedorId: number, productoId: number) {
    const link = await this.ppRepo.findOne({
      where: { proveedor_id: proveedorId, producto_id: productoId },
    });
    if (!link) {
      throw new NotFoundException(`Relación proveedor #${proveedorId} / producto #${productoId} no encontrada`);
    }
    await this.ppRepo.delete(link.id);
    return { message: `Relación eliminada` };
  }

  getByProducto(productoId: number) {
    return this.ppRepo
      .createQueryBuilder('pp')
      .leftJoinAndSelect('pp.proveedor', 'p')
      .where('pp.producto_id = :pid', { pid: productoId })
      .andWhere('p.activo = true')
      .orderBy('p.nombre', 'ASC')
      .getMany();
  }
}
