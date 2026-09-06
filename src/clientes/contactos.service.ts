import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface ContactoDto {
  nombre: string;
  cargo?: string | null;
  telefono?: string | null;
  email?: string | null;
  principal?: boolean;
}

/**
 * Contactos por cliente (varias personas piden por una misma empresa).
 * El contacto `principal` se refleja en `clientes.representante`.
 */
@Injectable()
export class ContactosService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  private limpiar(dto: Partial<ContactoDto>) {
    const nombre = String(dto.nombre ?? '').trim().slice(0, 120);
    if (!nombre) throw new BadRequestException('El nombre del contacto es requerido.');
    return {
      nombre,
      cargo:    dto.cargo    ? String(dto.cargo).trim().slice(0, 80)     : null,
      telefono: dto.telefono ? String(dto.telefono).trim().slice(0, 30)  : null,
      email:    dto.email    ? String(dto.email).trim().slice(0, 120)    : null,
      principal: !!dto.principal,
    };
  }

  async listar(clienteId: number) {
    return this.ds.query(
      `SELECT id, cliente_id, nombre, cargo, telefono, email, principal, creado_en
       FROM cliente_contactos WHERE cliente_id = ? AND activo = 1
       ORDER BY principal DESC, nombre ASC`, [clienteId]);
  }

  private async sincronizarRepresentante(clienteId: number) {
    const [p] = await this.ds.query(
      `SELECT nombre FROM cliente_contactos WHERE cliente_id = ? AND activo = 1 AND principal = 1 ORDER BY id LIMIT 1`, [clienteId]);
    await this.ds.query(`UPDATE clientes SET representante = ? WHERE id = ?`, [p?.nombre ?? null, clienteId]);
  }

  async crear(clienteId: number, dto: ContactoDto) {
    const [cli] = await this.ds.query(`SELECT id FROM clientes WHERE id = ?`, [clienteId]);
    if (!cli) throw new NotFoundException('Cliente no encontrado');
    const c = this.limpiar(dto);
    // Si es el primero, es principal por defecto
    const [{ n }] = await this.ds.query(`SELECT COUNT(*) n FROM cliente_contactos WHERE cliente_id = ? AND activo = 1`, [clienteId]);
    const principal = c.principal || Number(n) === 0;
    if (principal) await this.ds.query(`UPDATE cliente_contactos SET principal = 0 WHERE cliente_id = ?`, [clienteId]);
    const r = await this.ds.query(
      `INSERT INTO cliente_contactos (cliente_id, nombre, cargo, telefono, email, principal) VALUES (?,?,?,?,?,?)`,
      [clienteId, c.nombre, c.cargo, c.telefono, c.email, principal ? 1 : 0]);
    await this.sincronizarRepresentante(clienteId);
    const [row] = await this.ds.query(`SELECT * FROM cliente_contactos WHERE id = ?`, [r.insertId]);
    return row;
  }

  async actualizar(contactoId: number, dto: Partial<ContactoDto>) {
    const [cur] = await this.ds.query(`SELECT * FROM cliente_contactos WHERE id = ? AND activo = 1`, [contactoId]);
    if (!cur) throw new NotFoundException('Contacto no encontrado');
    const c = this.limpiar({ ...cur, ...dto, principal: dto.principal ?? !!cur.principal });
    if (c.principal) await this.ds.query(`UPDATE cliente_contactos SET principal = 0 WHERE cliente_id = ? AND id <> ?`, [cur.cliente_id, contactoId]);
    await this.ds.query(
      `UPDATE cliente_contactos SET nombre = ?, cargo = ?, telefono = ?, email = ?, principal = ? WHERE id = ?`,
      [c.nombre, c.cargo, c.telefono, c.email, c.principal ? 1 : 0, contactoId]);
    await this.sincronizarRepresentante(cur.cliente_id);
    const [row] = await this.ds.query(`SELECT * FROM cliente_contactos WHERE id = ?`, [contactoId]);
    return row;
  }

  async eliminar(contactoId: number) {
    const [cur] = await this.ds.query(`SELECT cliente_id FROM cliente_contactos WHERE id = ? AND activo = 1`, [contactoId]);
    if (!cur) throw new NotFoundException('Contacto no encontrado');
    await this.ds.query(`UPDATE cliente_contactos SET activo = 0, principal = 0 WHERE id = ?`, [contactoId]);
    await this.sincronizarRepresentante(cur.cliente_id);
    return { ok: true };
  }
}
