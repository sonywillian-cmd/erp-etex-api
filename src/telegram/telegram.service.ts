import { Injectable, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import { TelegramUsuario } from './telegram-usuario.entity';
import { TelegramCodigo } from './telegram-codigo.entity';

@Injectable()
export class TelegramService {
  constructor(
    @InjectRepository(TelegramUsuario) private usuariosRepo: Repository<TelegramUsuario>,
    @InjectRepository(TelegramCodigo)  private codigosRepo: Repository<TelegramCodigo>,
    @InjectDataSource() private ds: DataSource,
  ) {}

  // ── Migración: crear tablas ──────────────────────────────────────────────
  async crearTablas() {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS telegram_usuarios (
        chat_id              BIGINT PRIMARY KEY,
        usuario_id           INT NOT NULL,
        usuario_nombre       VARCHAR(150) NOT NULL,
        telegram_username    VARCHAR(100) NULL,
        telegram_first_name  VARCHAR(100) NULL,
        vinculado_en         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        actualizado_en       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_tg_usuario_id (usuario_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS telegram_codigos (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        codigo      VARCHAR(10) NOT NULL UNIQUE,
        usuario_id  INT NOT NULL,
        expira_en   DATETIME NOT NULL,
        usado       TINYINT(1) NOT NULL DEFAULT 0,
        creado_en   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    return { ok: true };
  }

  // ── Generar código de vinculación (lo llama el ERP web autenticado) ──────
  async generarCodigo(usuarioId: number) {
    // Limpiar códigos viejos de este usuario (los invalida)
    await this.codigosRepo.delete({ usuario_id: usuarioId });

    // Generar 6 dígitos
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const expira = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    const entity = this.codigosRepo.create({
      codigo,
      usuario_id: usuarioId,
      expira_en: expira,
      usado: 0,
    });
    await this.codigosRepo.save(entity);

    return {
      codigo,
      expira_en: expira.toISOString(),
      expira_en_min: 10,
      bot_username: process.env.TELEGRAM_BOT_USERNAME || 'tu_bot',
    };
  }

  // ── Estado de vinculación del usuario actual ─────────────────────────────
  async miEstado(usuarioId: number) {
    const vinculaciones = await this.usuariosRepo.find({ where: { usuario_id: usuarioId } });
    const codigoActivo = await this.codigosRepo.findOne({
      where: { usuario_id: usuarioId, usado: 0 },
      order: { creado_en: 'DESC' },
    });
    return {
      vinculaciones: vinculaciones.map(v => ({
        chat_id: v.chat_id,
        telegram_username: v.telegram_username,
        telegram_first_name: v.telegram_first_name,
        vinculado_en: v.vinculado_en,
      })),
      codigo_activo: codigoActivo && codigoActivo.expira_en > new Date()
        ? { codigo: codigoActivo.codigo, expira_en: codigoActivo.expira_en }
        : null,
    };
  }

  // ── Desvincular un chat del usuario ──────────────────────────────────────
  async desvincular(usuarioId: number, chatId: string) {
    const v = await this.usuariosRepo.findOne({ where: { chat_id: chatId } });
    if (!v) throw new NotFoundException('Vinculación no encontrada');
    if (v.usuario_id !== usuarioId) {
      throw new UnauthorizedException('No puedes desvincular un chat que no es tuyo');
    }
    await this.usuariosRepo.remove(v);
    return { ok: true };
  }

  // ── BOT API: validar shared secret ───────────────────────────────────────
  private validarBotSecret(secret: string | undefined) {
    const expected = process.env.TELEGRAM_BOT_SHARED_SECRET;
    if (!expected) {
      throw new UnauthorizedException('TELEGRAM_BOT_SHARED_SECRET no configurado en el servidor');
    }
    if (secret !== expected) {
      throw new UnauthorizedException('Bot secret inválido');
    }
  }

  // ── BOT API: vincular un chat ingresando código ──────────────────────────
  async botVincular(secret: string | undefined, data: {
    chat_id: string;
    codigo: string;
    telegram_username?: string;
    telegram_first_name?: string;
  }) {
    this.validarBotSecret(secret);

    const codigo = await this.codigosRepo.findOne({
      where: { codigo: data.codigo.trim(), usado: 0 },
    });
    if (!codigo) {
      throw new BadRequestException('Código inválido o ya usado');
    }
    if (codigo.expira_en < new Date()) {
      throw new BadRequestException('Código expirado. Genera uno nuevo en el ERP.');
    }

    // Obtener nombre del usuario desde la tabla `usuarios`
    const userRow = await this.ds.query(
      `SELECT id, nombre FROM usuarios WHERE id = ? LIMIT 1`,
      [codigo.usuario_id],
    );
    if (!userRow.length) throw new NotFoundException('Usuario del código no existe');

    // Upsert en telegram_usuarios
    await this.usuariosRepo.save({
      chat_id: data.chat_id,
      usuario_id: codigo.usuario_id,
      usuario_nombre: userRow[0].nombre,
      telegram_username: data.telegram_username ?? null,
      telegram_first_name: data.telegram_first_name ?? null,
    });

    // Marcar código como usado
    codigo.usado = 1;
    await this.codigosRepo.save(codigo);

    return {
      ok: true,
      usuario_id: codigo.usuario_id,
      usuario_nombre: userRow[0].nombre,
    };
  }

  // ── BOT API: resolver chat_id → usuario ──────────────────────────────────
  async botResolverChat(secret: string | undefined, chatId: string) {
    this.validarBotSecret(secret);
    const v = await this.usuariosRepo.findOne({ where: { chat_id: chatId } });
    if (!v) return null;
    return {
      chat_id: v.chat_id,
      usuario_id: v.usuario_id,
      usuario_nombre: v.usuario_nombre,
    };
  }

  // ── BOT API: crear gasto en nombre del usuario vinculado ─────────────────
  async botCrearGasto(secret: string | undefined, data: {
    chat_id: string;
    tipo: 'formal' | 'informal' | 'personal';
    fecha: string;
    monto: number;
    descripcion?: string;
    categoria?: string;
    proveedor?: string;
    rnc?: string;
    ncf?: string;
    tipo_ncf?: string;
    subtotal?: number;
    itbis?: number;
    foto_url?: string;
    metodo_pago?: string;
    notas?: string;
  }) {
    this.validarBotSecret(secret);

    const v = await this.usuariosRepo.findOne({ where: { chat_id: data.chat_id } });
    if (!v) throw new UnauthorizedException('Chat no vinculado a ningún usuario');

    // Candado anti-duplicado por NCF (portado del dist del VPS, ver memoria dedup NCF)
    const __ncf = (data.ncf ?? '').trim();
    if (__ncf) {
      const __dup = await this.ds.query('SELECT id, proveedor, fecha, monto FROM gastos WHERE ncf = ? LIMIT 1', [__ncf]);
      if (__dup && __dup.length) {
        const __g = __dup[0];
        throw new BadRequestException(`ncf_duplicado:Esta factura ya fue registrada (NCF ${__ncf}): gasto #${__g.id}, ${__g.proveedor}, ${String(__g.fecha).slice(0, 10)}, RD$ ${Number(__g.monto).toLocaleString('es-DO', { minimumFractionDigits: 2 })}.`);
      }
    }

    // Insertar directo con raw query para evitar dependencia circular con GastosService
    const r = await this.ds.query(
      `INSERT INTO gastos
       (tipo, fecha, monto, descripcion, categoria, proveedor, rnc, ncf, tipo_ncf,
        subtotal, itbis, foto_url, metodo_pago, notas,
        registrado_por_id, registrado_por_nombre, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrado')`,
      [
        data.tipo,
        data.fecha,
        data.monto,
        data.descripcion ?? null,
        data.categoria ?? null,
        data.proveedor ?? null,
        data.rnc ?? null,
        data.ncf ?? null,
        data.tipo_ncf ?? null,
        data.subtotal ?? null,
        data.itbis ?? null,
        data.foto_url ?? null,
        data.metodo_pago ?? null,
        data.notas ?? null,
        v.usuario_id,
        v.usuario_nombre,
      ],
    );

    return { ok: true, gasto_id: r.insertId };
  }

  // ── Limpieza: borrar códigos expirados (puede correrse periódicamente) ───
  async limpiarCodigosExpirados() {
    const res = await this.codigosRepo.delete({
      expira_en: LessThan(new Date()),
    });
    return { eliminados: res.affected ?? 0 };
  }
}
