import { Injectable, BadRequestException, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Pago }         from './entities/pago.entity';
import { EgresoCaja }   from './entities/egreso-caja.entity';
import { SesionCaja, EstadoSesion } from './entities/sesion-caja.entity';
import { Producto }     from '../productos/entities/producto.entity';
import { Movimiento, TipoMovimiento } from '../inventario/entities/movimiento.entity';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloAuditoria, AccionAuditoria } from '../auditoria/entities/auditoria-financiera.entity';

export interface MovimientoRaw {
  fp_id:            number;
  fp_monto:         number;
  fp_metodo:        string;
  fp_tipo:          string;
  fp_fecha:         string;
  fp_creado_en:     string;
  fp_referencia:    string;
  f_id:             number | null;
  f_numero:         string;
  f_ncf:            string | null;
  f_cliente_nombre: string;
  f_total:          number;
  f_estado:         string;
  fuente:           'factura' | 'anticipo';
}

export interface ResumenMetodo {
  metodo:   string;
  total:    number;
  cantidad: number;
}

@Injectable()
export class CajaService {
  constructor(
    @InjectRepository(Pago)        private pagoRepo:   Repository<Pago>,
    @InjectRepository(EgresoCaja)  private egresoRepo: Repository<EgresoCaja>,
    @InjectRepository(SesionCaja)  private sesionRepo: Repository<SesionCaja>,
    @InjectRepository(Producto)    private prodRepo:   Repository<Producto>,
    @InjectRepository(Movimiento)  private movRepo:    Repository<Movimiento>,
    private ds: DataSource,
    private auditoria: AuditoriaService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // NÚMERO CORRELATIVO
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Genera el siguiente CAJ/<year>/NNNN.
   *
   * Filtra SOLO números con el prefijo CAJ/<year>/ para evitar leer
   * sesiones legacy con otro formato (ej. "SES-202606-001") que rompen el
   * cálculo y generan colisiones con la constraint UNIQUE de `numero`.
   *
   * El sufijo se ordena numéricamente (CAST a UNSIGNED), no lexicográficamente,
   * para que CAJ/2026/0019 > CAJ/2026/0009.
   */
  private async nextNumeroSesion(): Promise<string> {
    const year   = new Date().getFullYear();
    const prefix = `CAJ/${year}/`;
    const row = await this.ds.query<{ max_seq: string | null }[]>(`
      SELECT MAX(CAST(SUBSTRING_INDEX(numero, '/', -1) AS UNSIGNED)) AS max_seq
      FROM sesiones_caja
      WHERE numero LIKE ?
    `, [prefix + '%']);
    const next = (Number(row[0]?.max_seq) || 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESIONES — CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /** Listar todas las sesiones (con resumen de pagos calculado) */
  async listarSesiones(params?: { estado?: string; usuario_id?: number; usuario_nombre?: string; desde?: string; hasta?: string }) {
    const qb = this.sesionRepo.createQueryBuilder('s').orderBy('s.id', 'DESC');
    if (params?.estado)          qb.andWhere('s.estado = :e',  { e: params.estado });
    if (params?.usuario_id)      qb.andWhere('s.usuario_id = :u', { u: params.usuario_id });
    if (params?.usuario_nombre)  qb.andWhere('s.usuario_nombre LIKE :un', { un: `%${params.usuario_nombre}%` });
    if (params?.desde)           qb.andWhere('DATE(s.fecha_apertura) >= :desde', { desde: params.desde });
    if (params?.hasta)           qb.andWhere('DATE(s.fecha_apertura) <= :hasta', { hasta: params.hasta });
    const sesiones = await qb.getMany();
    return Promise.all(sesiones.map(s => this.enriquecerSesion(s)));
  }

  /** Obtener una sesión con detalle completo */
  async findOneSesion(id: number) {
    const sesion = await this.sesionRepo.findOne({ where: { id } });
    if (!sesion) throw new NotFoundException(`Sesión #${id} no encontrada`);
    return this.enriquecerSesion(sesion);
  }

  /** Sesión activa del usuario (estado = abierta) */
  async sesionActiva(usuarioNombre?: string): Promise<SesionCaja | null> {
    const qb = this.sesionRepo.createQueryBuilder('s')
      .where('s.estado = :e', { e: EstadoSesion.ABIERTA })
      .orderBy('s.id', 'DESC');
    if (usuarioNombre) qb.andWhere('s.usuario_nombre = :u', { u: usuarioNombre });
    return qb.getOne();
  }

  /** Verificar si hay caja abierta (backward compat con facturación) */
  async cajaAbierta(usuarioNombre?: string): Promise<boolean> {
    const s = await this.sesionActiva(usuarioNombre);
    return !!s;
  }

  /** Abrir nueva sesión */
  async abrirSesion(dto: {
    efectivo_inicial: number;
    usuario_nombre:   string;
    usuario_id?:      number;
  }): Promise<SesionCaja> {
    // ── SEGURIDAD: evitar múltiples sesiones abiertas por el mismo usuario ────
    const sesionExistente = await this.sesionRepo.findOne({
      where: {
        estado:          EstadoSesion.ABIERTA,
        usuario_nombre:  dto.usuario_nombre,
      },
    });
    if (sesionExistente) {
      throw new BadRequestException(
        `Ya tienes una sesión de caja abierta (${sesionExistente.numero}). ` +
        `Ciérrala antes de abrir una nueva.`,
      );
    }

    const numero = await this.nextNumeroSesion();
    const s = this.sesionRepo.create({
      numero,
      usuario_nombre:   dto.usuario_nombre,
      usuario_id:       dto.usuario_id ?? null,
      efectivo_inicial: dto.efectivo_inicial,
      estado:           EstadoSesion.ABIERTA,
    });
    const sesionGuardada = await this.sesionRepo.save(s);
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.CAJA,
      accion:         AccionAuditoria.SESION_ABIERTA,
      entidad_id:     sesionGuardada.id,
      entidad_numero: sesionGuardada.numero,
      usuario_id:     dto.usuario_id ?? null,
      usuario_nombre: dto.usuario_nombre,
      monto:          dto.efectivo_inicial,
      descripcion:    `Sesión ${sesionGuardada.numero} abierta con efectivo inicial RD$ ${dto.efectivo_inicial}`,
    });
    return sesionGuardada;
  }

  /** Cerrar sesión → pasa a por_validar */
  async cerrarSesion(id: number, dto: {
    efectivo_final_real: number;
    notas_cierre?:       string;
    cerrado_por?:        string;
    usuario_cierre?:     { id: number; nombre: string; rol: string };
  }): Promise<any> {
    const sesion = await this.sesionRepo.findOne({ where: { id } });
    if (!sesion)                                   throw new NotFoundException('Sesión no encontrada');
    if (sesion.estado !== EstadoSesion.ABIERTA)    throw new BadRequestException('Solo se pueden cerrar sesiones abiertas');

    // ── SEGURIDAD: solo el cajero propietario o admin/supervisor puede cerrar ─
    if (dto.usuario_cierre) {
      const rolesAutorizados = ['admin', 'supervisor'];
      const esAdmin    = rolesAutorizados.includes(dto.usuario_cierre.rol);
      const esPropietario =
        (sesion.usuario_id   && sesion.usuario_id   === dto.usuario_cierre.id) ||
        (sesion.usuario_nombre === dto.usuario_cierre.nombre);
      if (!esAdmin && !esPropietario) {
        throw new ForbiddenException(
          `Solo el cajero responsable (${sesion.usuario_nombre}) o un administrador ` +
          `puede cerrar esta sesión.`,
        );
      }
    }

    // Calcular efectivo_cobrado usando la misma lógica que enriquecerSesion
    // (sesion_caja_id explícito OR fallback legacy por usuario+rango) + excluir revertidos
    const cobradoRows = await this.ds.query<{ total: string }[]>(`
      SELECT COALESCE(SUM(monto), 0) AS total FROM (
        SELECT fp.monto
        FROM factura_pagos fp
        JOIN facturas fa ON fa.id = fp.factura_id
        WHERE fp.metodo = 'efectivo'
          AND (fp.revertido IS NULL OR fp.revertido = 0)
          AND fa.estado != 'anulada'
          AND (
            fp.sesion_caja_id = ?
            OR (fp.sesion_caja_id IS NULL
                AND fp.creado_por = ?
                AND fp.creado_en >= ?
                AND fp.creado_en <= NOW())
          )
        UNION ALL
        SELECT ri.monto
        FROM recibos_ingreso ri
        WHERE ri.metodo = 'efectivo'
          AND ri.factura_id IS NULL
          AND (
            ri.sesion_caja_id = ?
            OR (ri.sesion_caja_id IS NULL
                AND ri.creado_por = ?
                AND ri.creado_en >= ?
                AND ri.creado_en <= NOW())
          )
      ) combined
    `, [sesion.id, sesion.usuario_nombre, sesion.fecha_apertura,
        sesion.id, sesion.usuario_nombre, sesion.fecha_apertura]);
    const efectivoCobrado = parseFloat(cobradoRows[0]?.total || '0');

    await this.sesionRepo.update(id, {
      estado:              EstadoSesion.POR_VALIDAR,
      efectivo_cobrado:    efectivoCobrado,
      efectivo_final_real: dto.efectivo_final_real,
      notas_cierre:        dto.notas_cierre,
      cerrado_por:         dto.cerrado_por,
      fecha_cierre:        new Date(),
    });
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.CAJA,
      accion:         AccionAuditoria.SESION_CERRADA,
      entidad_id:     id,
      entidad_numero: sesion.numero,
      usuario_id:     dto.usuario_cierre?.id ?? null,
      usuario_nombre: dto.usuario_cierre?.nombre ?? dto.cerrado_por ?? null,
      usuario_rol:    dto.usuario_cierre?.rol ?? null,
      monto:          dto.efectivo_final_real,
      datos: {
        efectivo_inicial:    Number(sesion.efectivo_inicial),
        efectivo_cobrado:    efectivoCobrado,
        efectivo_final_real: dto.efectivo_final_real,
        notas_cierre:        dto.notas_cierre ?? null,
      },
      descripcion: `Sesión ${sesion.numero} cerrada. Efectivo final: RD$ ${dto.efectivo_final_real}`,
    });
    return this.findOneSesion(id);
  }

  /** Validar sesión — requiere credenciales de admin */
  async validarSesion(id: number, dto: {
    email:    string;
    password: string;
    validado_por?: string;
  }): Promise<any> {
    // Verificar credenciales admin
    const adminRow = await this.ds.query<any[]>(
      `SELECT id, password_hash, rol FROM usuarios WHERE email = ? AND activo = 1 LIMIT 1`,
      [dto.email],
    );
    if (!adminRow.length) throw new UnauthorizedException('Credenciales incorrectas');
    const valid = await bcrypt.compare(dto.password, adminRow[0].password_hash);
    if (!valid)           throw new UnauthorizedException('Credenciales incorrectas');
    if (adminRow[0].rol !== 'admin') throw new UnauthorizedException('Se requiere rol de administrador');

    const sesion = await this.sesionRepo.findOne({ where: { id } });
    if (!sesion)                                       throw new NotFoundException('Sesión no encontrada');
    if (sesion.estado !== EstadoSesion.POR_VALIDAR)    throw new BadRequestException('La sesión no está pendiente de validación');

    await this.sesionRepo.update(id, {
      estado:           EstadoSesion.VALIDADA,
      validado_por:     dto.validado_por ?? dto.email,
      fecha_validacion: new Date(),
    });
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.CAJA,
      accion:         AccionAuditoria.SESION_VALIDADA,
      entidad_id:     id,
      entidad_numero: sesion.numero,
      usuario_id:     adminRow[0].id,
      usuario_nombre: dto.validado_por ?? dto.email,
      usuario_rol:    'admin',
      descripcion:    `Sesión ${sesion.numero} validada por ${dto.validado_por ?? dto.email}`,
    });
    return this.findOneSesion(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGOS DE UNA SESIÓN (factura_pagos + recibos_ingreso de órdenes)
  // ═══════════════════════════════════════════════════════════════════════════
  async pagosDeSesion(id: number): Promise<MovimientoRaw[]> {
    const sesion = await this.sesionRepo.findOne({ where: { id } });
    if (!sesion) throw new NotFoundException('Sesión no encontrada');

    const hasta = sesion.fecha_cierre ?? new Date();
    return this.ds.query<MovimientoRaw[]>(`
      SELECT
        fp.id                                      AS fp_id,
        fp.monto                                   AS fp_monto,
        CONVERT(fp.metodo    USING utf8mb4)        AS fp_metodo,
        CONVERT(fp.tipo      USING utf8mb4)        AS fp_tipo,
        fp.fecha                                   AS fp_fecha,
        fp.creado_en                               AS fp_creado_en,
        CONVERT(fp.referencia USING utf8mb4)       AS fp_referencia,
        fa.id                                      AS f_id,
        CONVERT(fa.numero    USING utf8mb4)        AS f_numero,
        CONVERT(fa.ncf       USING utf8mb4)        AS f_ncf,
        CONVERT(fa.cliente_nombre USING utf8mb4)   AS f_cliente_nombre,
        fa.total                                   AS f_total,
        CONVERT(fa.estado    USING utf8mb4)        AS f_estado,
        'factura'                                  AS fuente
      FROM factura_pagos fp
      JOIN facturas fa ON fa.id = fp.factura_id
      WHERE fa.estado != 'anulada'
        AND (
          fp.sesion_caja_id = ?
          OR (fp.sesion_caja_id IS NULL
              AND fp.creado_por = ?
              AND fp.creado_en >= ?
              AND fp.creado_en <= ?)
        )

      UNION ALL

      SELECT
        ri.id                                                               AS fp_id,
        ri.monto                                                            AS fp_monto,
        CONVERT(ri.metodo     USING utf8mb4)                               AS fp_metodo,
        CONVERT(ri.tipo       USING utf8mb4)                               AS fp_tipo,
        ri.fecha                                                            AS fp_fecha,
        ri.creado_en                                                        AS fp_creado_en,
        CONVERT(ri.referencia USING utf8mb4)                               AS fp_referencia,
        op.id                                                               AS f_id,
        CONVERT(COALESCE(op.numero, CONCAT('OP-', ri.orden_produccion_id)) USING utf8mb4) AS f_numero,
        NULL                                                                AS f_ncf,
        CONVERT(ri.cliente_nombre USING utf8mb4)                           AS f_cliente_nombre,
        ri.monto                                                            AS f_total,
        'vigente'                                                           AS f_estado,
        'anticipo'                                                          AS fuente
      FROM recibos_ingreso ri
      LEFT JOIN ordenes_produccion op ON op.id = ri.orden_produccion_id
      WHERE ri.factura_id IS NULL
        AND (
          ri.sesion_caja_id = ?
          OR (ri.sesion_caja_id IS NULL
              AND ri.creado_por = ?
              AND ri.creado_en >= ?
              AND ri.creado_en <= ?)
        )

      ORDER BY fp_creado_en DESC
    `, [sesion.id, sesion.usuario_nombre, sesion.fecha_apertura, hasta,
        sesion.id, sesion.usuario_nombre, sesion.fecha_apertura, hasta]);
  }

  /** Resumen por método de pago de una sesión (factura_pagos + recibos_ingreso) */
  async resumenMetodosSesion(id: number): Promise<ResumenMetodo[]> {
    const sesion = await this.sesionRepo.findOne({ where: { id } });
    if (!sesion) throw new NotFoundException('Sesión no encontrada');
    const hasta = sesion.fecha_cierre ?? new Date();

    const rows = await this.ds.query<{ metodo: string; total: string; cantidad: string }[]>(`
      SELECT metodo,
             COALESCE(SUM(monto), 0) AS total,
             COUNT(*)                AS cantidad
      FROM (
        SELECT CONVERT(fp.metodo USING utf8mb4) AS metodo, fp.monto
        FROM factura_pagos fp
        JOIN facturas fa ON fa.id = fp.factura_id
        WHERE fa.estado != 'anulada'
          AND (
            fp.sesion_caja_id = ?
            OR (fp.sesion_caja_id IS NULL
                AND fp.creado_por = ?
                AND fp.creado_en >= ?
                AND fp.creado_en <= ?)
          )
        UNION ALL
        SELECT CONVERT(ri.metodo USING utf8mb4) AS metodo, ri.monto
        FROM recibos_ingreso ri
        WHERE ri.factura_id IS NULL
          AND (
            ri.sesion_caja_id = ?
            OR (ri.sesion_caja_id IS NULL
                AND ri.creado_por = ?
                AND ri.creado_en >= ?
                AND ri.creado_en <= ?)
          )
      ) combined
      GROUP BY metodo
    `, [sesion.id, sesion.usuario_nombre, sesion.fecha_apertura, hasta,
        sesion.id, sesion.usuario_nombre, sesion.fecha_apertura, hasta]);

    return rows.map(r => ({
      metodo:   r.metodo,
      total:    parseFloat(r.total),
      cantidad: parseInt(r.cantidad),
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EGRESOS
  // ═══════════════════════════════════════════════════════════════════════════
  async getEgresos(params?: { desde?: string; hasta?: string; categoria?: string; sesion_id?: number }) {
    const qb = this.egresoRepo.createQueryBuilder('e').orderBy('e.creado_en', 'DESC');
    if (params?.desde)     qb.andWhere('e.fecha >= :desde',    { desde: params.desde });
    if (params?.hasta)     qb.andWhere('e.fecha <= :hasta',    { hasta: params.hasta });
    if (params?.categoria) qb.andWhere('e.categoria = :cat',  { cat: params.categoria });
    if (params?.sesion_id) qb.andWhere('e.sesion_caja_id = :sid', { sid: params.sesion_id });
    return qb.getMany();
  }

  // Monto máximo que un cajero/vendedor puede registrar sin autorización
  private static readonly LIMITE_EGRESO_LIBRE = 5_000;

  async registrarEgreso(dto: {
    monto:           number;
    destinatario:    string;
    categoria:       string;
    comentario?:     string;
    registrado_por?: string;
    fecha?:          string;
    usuario_rol?:    string;  // rol del usuario que hace la petición
  }) {
    // ── SEGURIDAD: validar monto positivo ─────────────────────────────────────
    if (!dto.monto || dto.monto <= 0) {
      throw new BadRequestException('El monto del egreso debe ser mayor a cero.');
    }

    // ── SEGURIDAD: egresos grandes requieren admin o supervisor ───────────────
    const rolesAutorizados = ['admin', 'supervisor'];
    const esAutorizado     = dto.usuario_rol && rolesAutorizados.includes(dto.usuario_rol);
    if (dto.monto > CajaService.LIMITE_EGRESO_LIBRE && !esAutorizado) {
      throw new ForbiddenException(
        `Los egresos mayores a RD$ ${CajaService.LIMITE_EGRESO_LIBRE.toLocaleString()} ` +
        `requieren autorización de administrador o supervisor.`,
      );
    }

    const f      = dto.fecha || new Date().toISOString().split('T')[0];
    // Buscar la sesión del usuario que registra el egreso, no cualquier sesión abierta
    const sesion = await this.sesionActiva(dto.registrado_por ?? undefined);
    if (!sesion) throw new BadRequestException(
      dto.registrado_por
        ? `No tienes una sesión de caja abierta. Abre tu sesión primero.`
        : 'No hay una sesión de caja abierta',
    );

    const egreso = this.egresoRepo.create({
      monto:          dto.monto,
      destinatario:   dto.destinatario,
      categoria:      dto.categoria,
      comentario:     dto.comentario,
      registrado_por: dto.registrado_por,
      fecha:          f,
      sesion_caja_id: sesion.id,
    } as any);
    const egresoGuardado = await this.egresoRepo.save(egreso);
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.EGRESOS,
      accion:         AccionAuditoria.EGRESO_REGISTRADO,
      entidad_id:     sesion.id,
      entidad_numero: sesion.numero,
      usuario_nombre: dto.registrado_por ?? null,
      usuario_rol:    dto.usuario_rol    ?? null,
      monto:          dto.monto,
      datos: {
        destinatario: dto.destinatario,
        categoria:    dto.categoria,
        comentario:   dto.comentario ?? null,
        fecha:        f,
        egreso_id:    (egresoGuardado as any).id ?? null,
      },
      descripcion: `Egreso RD$ ${dto.monto} — ${dto.categoria} — ${dto.destinatario}`,
    });
    return egresoGuardado;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VENTAS DIRECTAS (POS)
  // ═══════════════════════════════════════════════════════════════════════════
  private async nextNumeroCobro(): Promise<string> {
    const year = new Date().getFullYear();
    const last = await this.pagoRepo.createQueryBuilder('p')
      .where('YEAR(p.creado_en) = :year', { year })
      .orderBy('p.id', 'DESC').getOne();
    const seq = last ? parseInt(last.numero.split('-').pop()) + 1 : 1;
    return `COB-${year}-${String(seq).padStart(3, '0')}`;
  }

  findAll(q?: { cliente_id?: string; metodo?: string; estado?: string }) {
    const qb = this.pagoRepo.createQueryBuilder('p').orderBy('p.creado_en', 'DESC');
    if (q?.cliente_id) qb.andWhere('p.cliente_id = :cid', { cid: q.cliente_id });
    if (q?.metodo)     qb.andWhere('p.metodo = :m',       { m: q.metodo });
    if (q?.estado)     qb.andWhere('p.estado = :e',       { e: q.estado });
    return qb.getMany();
  }

  async registrar(data: Partial<Pago> & {
    lineas?: { producto_id: number; nombre: string; cantidad: number; precio_unit: number; subtotal: number }[]
  }) {
    const abierta = await this.cajaAbierta();
    if (!abierta) throw new BadRequestException('No hay sesión de caja abierta. Abre una sesión antes de registrar cobros.');

    const numero = await this.nextNumeroCobro();
    const base   = data.incluye_itbis !== false ? Number(data.monto_total) / 1.18 : Number(data.monto_total);
    const itbis  = data.incluye_itbis !== false ? Number(data.monto_total) - base  : 0;
    const pago   = this.pagoRepo.create({ ...data, numero, base_imponible: base, itbis_monto: itbis });
    const saved  = await this.pagoRepo.save(pago);

    if (data.lineas?.length) {
      for (const linea of data.lineas) {
        if (!linea.producto_id || linea.cantidad <= 0) continue;
        const prod = await this.prodRepo.findOne({ where: { id: linea.producto_id } });
        if (!prod || !prod.maneja_inventario) continue;
        await this.prodRepo.update(linea.producto_id, { stock_actual: Math.max(0, (prod.stock_actual ?? 0) - linea.cantidad) });
        await this.movRepo.save(this.movRepo.create({
          producto_id: linea.producto_id,
          tipo:        TipoMovimiento.SALIDA,
          cantidad:    linea.cantidad,
          referencia:  saved.numero,
          nota:        `Venta directa — ${linea.nombre}`,
        }));
      }
    }
    return saved;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVADO — enriquecer sesión con totales
  // ═══════════════════════════════════════════════════════════════════════════
  private async enriquecerSesion(s: SesionCaja) {
    const hasta = s.fecha_cierre ?? new Date();

    // ── Total de todos los cobros (todos los métodos) ─────────────────────────
    // Registros nuevos: enlazados explícitamente vía sesion_caja_id (robusto, multi-cajero)
    // Registros legacy: sin sesion_caja_id → se asignan por rango de tiempo + usuario
    const rows = await this.ds.query<{ total: string; cantidad: string }[]>(`
      SELECT COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad FROM (
        SELECT fp.monto
        FROM factura_pagos fp
        JOIN facturas fa ON fa.id = fp.factura_id
        WHERE fa.estado != 'anulada'
          AND (fp.revertido IS NULL OR fp.revertido = 0)
          AND (
            fp.sesion_caja_id = ?
            OR (fp.sesion_caja_id IS NULL
                AND fp.creado_por  = ?
                AND fp.creado_en  >= ?
                AND fp.creado_en  <= ?)
          )
        UNION ALL
        SELECT ri.monto
        FROM recibos_ingreso ri
        WHERE ri.factura_id IS NULL
          AND (
            ri.sesion_caja_id = ?
            OR (ri.sesion_caja_id IS NULL
                AND ri.creado_por  = ?
                AND ri.creado_en  >= ?
                AND ri.creado_en  <= ?)
          )
      ) combined
    `, [s.id, s.usuario_nombre, s.fecha_apertura, hasta,
        s.id, s.usuario_nombre, s.fecha_apertura, hasta]);

    // ── Efectivo cobrado (solo metodo = 'efectivo') ────────────────────────────
    const efRows = await this.ds.query<{ total: string }[]>(`
      SELECT COALESCE(SUM(monto), 0) AS total FROM (
        SELECT fp.monto
        FROM factura_pagos fp
        JOIN facturas fa ON fa.id = fp.factura_id
        WHERE fa.estado != 'anulada'
          AND fp.metodo = 'efectivo'
          AND (fp.revertido IS NULL OR fp.revertido = 0)
          AND (
            fp.sesion_caja_id = ?
            OR (fp.sesion_caja_id IS NULL
                AND fp.creado_por  = ?
                AND fp.creado_en  >= ?
                AND fp.creado_en  <= ?)
          )
        UNION ALL
        SELECT ri.monto
        FROM recibos_ingreso ri
        WHERE ri.factura_id IS NULL
          AND ri.metodo = 'efectivo'
          AND (
            ri.sesion_caja_id = ?
            OR (ri.sesion_caja_id IS NULL
                AND ri.creado_por  = ?
                AND ri.creado_en  >= ?
                AND ri.creado_en  <= ?)
          )
      ) combined
    `, [s.id, s.usuario_nombre, s.fecha_apertura, hasta,
        s.id, s.usuario_nombre, s.fecha_apertura, hasta]);

    // ── Egresos de caja de esta sesión ────────────────────────────────────────
    const egresoRows = await this.ds.query<{ total: string }[]>(
      `SELECT COALESCE(SUM(monto), 0) AS total FROM egresos_caja WHERE sesion_caja_id = ?`,
      [s.id],
    );

    const totalPagos      = parseFloat(rows[0]?.total     || '0');
    const cantidadPagos   = parseInt(rows[0]?.cantidad    || '0');
    const efectivoCobrado = parseFloat(efRows[0]?.total   || '0');
    const totalEgresos    = parseFloat(egresoRows[0]?.total || '0');

    // Efectivo esperado = inicial + cobros en efectivo − egresos de caja
    // (tarjeta/transferencia no entran al cajón físico)
    const efectivoEsperado = Number(s.efectivo_inicial) + efectivoCobrado - totalEgresos;
    const diferencia       = Number(s.efectivo_final_real) - efectivoEsperado;

    return {
      ...s,
      efectivo_cobrado:    efectivoCobrado,  // tiempo real, no el guardado en BD
      total_egresos:       totalEgresos,     // expuesto para consistencia con el frontend
      total_pagos:         totalPagos,
      cantidad_pagos:      cantidadPagos,
      efectivo_esperado:   efectivoEsperado,
      diferencia_efectivo: diferencia,
    };
  }
}
