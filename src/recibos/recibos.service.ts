import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReciboIngreso, TipoRecibo } from './entities/recibo-ingreso.entity';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource }       from 'typeorm';
import { CajaService }      from '../caja/caja.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloAuditoria, AccionAuditoria } from '../auditoria/entities/auditoria-financiera.entity';

@Injectable()
export class RecibosService {
  constructor(
    @InjectRepository(ReciboIngreso)
    private repo: Repository<ReciboIngreso>,
    @InjectDataSource() private ds: DataSource,
    private cajaService: CajaService,
    private auditoria: AuditoriaService,
  ) {}

  // ── Número correlativo ─────────────────────────────────────────────────────
  private async nextNumero(): Promise<string> {
    const year = new Date().getFullYear();
    const last = await this.repo.createQueryBuilder('r')
      .where('YEAR(r.creado_en) = :year', { year })
      .orderBy('r.id', 'DESC')
      .getOne();
    if (!last) return `REC-${year}-0001`;
    const match = last.numero.match(/(\d+)$/);
    const next  = match ? parseInt(match[1]) + 1 : 1;
    return `REC-${year}-${String(next).padStart(4, '0')}`;
  }

  // ── Crear recibo (genérico) ────────────────────────────────────────────────
  async crear(dto: {
    tipo: TipoRecibo;
    orden_produccion_id?: number;
    factura_id?: number;
    factura_pago_id?: number;
    cliente_id?: number;
    cliente_nombre?: string;
    metodo: string;
    monto: number;
    fecha: string;
    referencia?: string;
    banco_nombre?: string;
    cuenta_digitos?: string;
    cuenta_banco_id?: number;
    notas?: string;
    creado_por?: string;
  }): Promise<ReciboIngreso> {
    // Enlazar automáticamente a la sesión de caja activa del cajero
    let sesion_caja_id: number | null = null;
    if (dto.creado_por) {
      const sesion = await this.cajaService.sesionActiva(dto.creado_por);
      sesion_caja_id = sesion?.id ?? null;
    }

    const numero = await this.nextNumero();
    const r = this.repo.create({
      numero,
      tipo:                 dto.tipo,
      orden_produccion_id:  dto.orden_produccion_id ?? null,
      factura_id:           dto.factura_id          ?? null,
      factura_pago_id:      dto.factura_pago_id     ?? null,
      cliente_id:           dto.cliente_id           ?? null,
      cliente_nombre:       dto.cliente_nombre,
      metodo:               dto.metodo,
      monto:                dto.monto,
      fecha:                dto.fecha,
      referencia:           dto.referencia,
      banco_nombre:         dto.banco_nombre,
      cuenta_digitos:       dto.cuenta_digitos,
      cuenta_banco_id:      dto.cuenta_banco_id      ?? null,
      notas:                dto.notas,
      creado_por:           dto.creado_por,
      sesion_caja_id,
    });
    return this.repo.save(r);
  }

  // ── Crear anticipo sobre una orden (sin factura) ───────────────────────────
  async crearAnticipo(dto: {
    orden_produccion_id: number;
    cliente_id?: number;
    cliente_nombre?: string;
    metodo: string;
    monto: number;
    fecha: string;
    referencia?: string;
    banco_nombre?: string;
    cuenta_digitos?: string;
    cuenta_banco_id?: number;
    notas?: string;
    creado_por?: string;
  }): Promise<ReciboIngreso> {
    return this.crear({ ...dto, tipo: TipoRecibo.ANTICIPO });
  }

  // ── Buscar por id ──────────────────────────────────────────────────────────
  async findOne(id: number): Promise<ReciboIngreso> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Recibo no encontrado');
    return r;
  }

  // ── Listar por factura ─────────────────────────────────────────────────────
  async porFactura(facturaId: number): Promise<ReciboIngreso[]> {
    return this.repo.find({
      where: { factura_id: facturaId },
      order: { id: 'ASC' },
    });
  }

  // ── Listar por orden ───────────────────────────────────────────────────────
  async porOrden(ordenId: number): Promise<ReciboIngreso[]> {
    return this.repo.find({
      where: { orden_produccion_id: ordenId },
      order: { id: 'ASC' },
    });
  }

  // ── Listar todos (con filtros opcionales) ──────────────────────────────────
  async listar(params?: { fecha?: string; desde?: string; hasta?: string; tipo?: string; cliente_nombre?: string; metodo?: string }): Promise<ReciboIngreso[]> {
    const qb = this.repo.createQueryBuilder('r').orderBy('r.id', 'DESC');
    if (params?.fecha)          qb.andWhere('r.fecha = :f',                   { f:  params.fecha });
    if (params?.desde)          qb.andWhere('r.fecha >= :desde',              { desde: params.desde });
    if (params?.hasta)          qb.andWhere('r.fecha <= :hasta',              { hasta: params.hasta });
    if (params?.tipo)           qb.andWhere('r.tipo = :tipo',                 { tipo: params.tipo });
    if (params?.metodo)         qb.andWhere('r.metodo = :metodo',             { metodo: params.metodo });
    if (params?.cliente_nombre) qb.andWhere('r.cliente_nombre LIKE :cn',      { cn: `%${params.cliente_nombre}%` });
    return qb.getMany();
  }

  // ── Listar transferencias (para panel de validación) ──────────────────────
  async listarTransferencias(params?: {
    desde?: string; hasta?: string;
    validado?: string; cuenta_banco_id?: string;
  }) {
    // Unir recibos_ingreso + factura_pagos en una vista unificada via raw SQL
    const condRecibos: string[] = [`ri.metodo = 'transferencia'`];
    const condPagos:   string[] = [`fp.metodo = 'transferencia'`, `fp.revertido = 0`];
    const bind: Record<string, any> = {};

    // NOTA: `ds.query` (SQL crudo) solo entiende placeholders POSICIONALES `?`,
    // no nombrados (`:desde`). Cada rama del UNION repite las mismas condiciones
    // en el mismo orden, por eso al final se pasan los valores duplicados.
    if (params?.desde) {
      condRecibos.push(`ri.fecha >= ?`); condPagos.push(`fp.fecha >= ?`);
      bind.desde = params.desde;
    }
    if (params?.hasta) {
      condRecibos.push(`ri.fecha <= ?`); condPagos.push(`fp.fecha <= ?`);
      bind.hasta = params.hasta;
    }
    if (params?.validado !== undefined && params.validado !== '') {
      const v = params.validado === 'true' ? 1 : 0;
      condRecibos.push(`ri.validado = ${v}`); condPagos.push(`fp.validado = ${v}`);
    }
    if (params?.cuenta_banco_id) {
      condRecibos.push(`ri.cuenta_banco_id = ?`); condPagos.push(`fp.cuenta_banco_id = ?`);
      bind.cbid = parseInt(params.cuenta_banco_id);
    }

    const whereR = condRecibos.join(' AND ');
    const whereP = condPagos.join(' AND ');

    // Los recibos trasladados a factura (factura_id IS NOT NULL) ya aparecen en
    // la rama de factura_pagos — excluirlos aquí evita doble-conteo
    condRecibos.push(`ri.factura_id IS NULL`);

    const whereRFinal = condRecibos.join(' AND ');
    const wherePFinal = condPagos.join(' AND ');
    const bindValues  = Object.values(bind);

    const sql = `
      SELECT
        ri.id              AS id,
        'recibo'           AS fuente,
        ri.numero          AS numero,
        ri.cliente_nombre  AS cliente_nombre,
        ri.monto           AS monto,
        ri.fecha           AS fecha,
        ri.referencia      AS referencia,
        ri.banco_nombre    AS banco_nombre,
        ri.cuenta_digitos  AS cuenta_digitos,
        ri.cuenta_banco_id AS cuenta_banco_id,
        ri.validado        AS validado,
        ri.validado_por    AS validado_por,
        ri.validado_en     AS validado_en,
        ri.creado_por      AS creado_por,
        ri.orden_produccion_id AS orden_id,
        NULL               AS factura_id,
        ri.tipo            AS tipo_doc
      FROM recibos_ingreso ri
      WHERE ${whereRFinal}

      UNION ALL

      SELECT
        fp.id              AS id,
        'pago'             AS fuente,
        f.numero           AS numero,
        f.cliente_nombre   AS cliente_nombre,
        fp.monto           AS monto,
        fp.fecha           AS fecha,
        fp.referencia      AS referencia,
        fp.banco_nombre    AS banco_nombre,
        fp.cuenta_digitos  AS cuenta_digitos,
        fp.cuenta_banco_id AS cuenta_banco_id,
        fp.validado        AS validado,
        fp.validado_por    AS validado_por,
        fp.validado_en     AS validado_en,
        fp.creado_por      AS creado_por,
        f.orden_produccion_id AS orden_id,
        fp.factura_id      AS factura_id,
        fp.tipo            AS tipo_doc
      FROM factura_pagos fp
      INNER JOIN facturas f ON f.id = fp.factura_id
      WHERE ${wherePFinal}

      ORDER BY fecha DESC, id DESC
    `;

    return this.ds.query(sql, [...bindValues, ...bindValues]);
  }

  // ── Validar recibo (admin certifica que llegó a la cuenta) ────────────────
  async validarRecibo(id: number, validado_por: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`Recibo #${id} no encontrado`);
    r.validado    = true;
    r.validado_por = validado_por;
    r.validado_en  = new Date();
    const saved = await this.repo.save(r);
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.CAJA,
      accion:         AccionAuditoria.RECIBO_VALIDADO,
      entidad_id:     r.id,
      entidad_numero: r.numero,
      usuario_nombre: validado_por,
      monto:          Number(r.monto),
      datos:          { recibo_id: r.id, metodo: r.metodo, referencia: r.referencia },
      descripcion:    `Recibo ${r.numero} (${r.metodo}) de RD$ ${r.monto} validado por ${validado_por}`,
    });
    return saved;
  }

  async desvalidarRecibo(id: number, desvalidado_por?: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`Recibo #${id} no encontrado`);
    r.validado     = false;
    r.validado_por = null;
    r.validado_en  = null;
    const saved = await this.repo.save(r);
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.CAJA,
      accion:         AccionAuditoria.RECIBO_DESVALIDADO,
      entidad_id:     r.id,
      entidad_numero: r.numero,
      usuario_nombre: desvalidado_por ?? null,
      monto:          Number(r.monto),
      datos:          { recibo_id: r.id, metodo: r.metodo, referencia: r.referencia },
      descripcion:    `Recibo ${r.numero} (${r.metodo}) de RD$ ${r.monto} desvalidado${desvalidado_por ? ` por ${desvalidado_por}` : ''}`,
    });
    return saved;
  }
}
