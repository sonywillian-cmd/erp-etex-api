import { Injectable, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import { TelegramUsuario } from './telegram-usuario.entity';
import { TelegramCodigo } from './telegram-codigo.entity';
import axios from 'axios';
import * as crypto from 'crypto';
import { cifrar, descifrar, enmascarar } from '../common/cifrado';

@Injectable()
export class TelegramService {
  constructor(
    @InjectRepository(TelegramUsuario) private usuariosRepo: Repository<TelegramUsuario>,
    @InjectRepository(TelegramCodigo)  private codigosRepo: Repository<TelegramCodigo>,
    @InjectDataSource() private ds: DataSource,
  ) {}

  // ═══════════════ CONFIGURACIÓN DEL BOT (Ajustes → Bot de Telegram) ═══════════════
  // Claves en configuracion_sistema (prefijo bot_, excluidas del GET /configuracion/sistema):
  //   bot_activo, bot_token (cifrado), bot_username, bot_gemini_api_key (cifrado),
  //   bot_gemini_model, bot_nombre_empresa, bot_avisos_usuarios (JSON de ids)
  // Si una clave no existe se usa el .env (TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, GEMINI_MODEL).

  private async leerClaves(): Promise<Record<string, string>> {
    const rows: { clave: string; valor: string }[] = await this.ds.query(
      `SELECT clave, valor FROM configuracion_sistema WHERE clave LIKE 'bot\\_%'`);
    return rows.reduce((a, r) => ({ ...a, [r.clave]: r.valor }), {} as Record<string, string>);
  }

  private async guardarClave(clave: string, valor: string | null, descripcion: string) {
    if (valor === null) { await this.ds.query(`DELETE FROM configuracion_sistema WHERE clave = ?`, [clave]); return; }
    await this.ds.query(
      `INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), descripcion = VALUES(descripcion)`, [clave, valor, descripcion]);
  }

  /** Token vigente del bot (Ajustes o .env). Lo usan los avisos push (crédito, etc.). */
  async tokenActual(): Promise<string> {
    const c = await this.leerClaves();
    return c.bot_token ? descifrar(c.bot_token) : (process.env.TELEGRAM_BOT_TOKEN ?? '');
  }

  /** Chats que reciben avisos: los usuarios marcados en Ajustes; si no hay, todos los admin activos. */
  async chatsParaAvisos(): Promise<{ chat_id: string; nombre: string; rol: string }[]> {
    const c = await this.leerClaves();
    let ids: number[] = [];
    try { ids = JSON.parse(c.bot_avisos_usuarios || '[]').map(Number).filter(Boolean); } catch { ids = []; }
    const rows = ids.length
      ? await this.ds.query(`SELECT t.chat_id, u.nombre, u.rol FROM telegram_usuarios t JOIN usuarios u ON u.id = t.usuario_id WHERE u.activo = 1 AND u.id IN (?)`, [ids])
      : await this.ds.query(`SELECT t.chat_id, u.nombre, u.rol FROM telegram_usuarios t JOIN usuarios u ON u.id = t.usuario_id WHERE u.activo = 1 AND u.rol = 'admin'`);
    return rows.map((r: any) => ({ chat_id: String(r.chat_id), nombre: r.nombre, rol: r.rol }));
  }

  /** Vista para el admin: nunca devuelve los secretos completos. */
  async configAdmin() {
    const c = await this.leerClaves();
    const token  = c.bot_token ? descifrar(c.bot_token) : (process.env.TELEGRAM_BOT_TOKEN ?? '');
    const gemini = c.bot_gemini_api_key ? descifrar(c.bot_gemini_api_key) : (process.env.GEMINI_API_KEY ?? '');
    let avisos: number[] = [];
    try { avisos = JSON.parse(c.bot_avisos_usuarios || '[]'); } catch { avisos = []; }
    const vinculados = await this.ds.query(
      `SELECT u.id, u.nombre, u.rol, t.telegram_username FROM telegram_usuarios t JOIN usuarios u ON u.id = t.usuario_id WHERE u.activo = 1 ORDER BY u.nombre`);
    return {
      activo:            c.bot_activo !== '0',
      username:          c.bot_username || process.env.TELEGRAM_BOT_USERNAME || '',
      token_mascara:     enmascarar(token), tiene_token: !!token,   origen_token:  c.bot_token ? 'ajustes' : (token ? 'env' : 'ninguno'),
      gemini_mascara:    enmascarar(gemini), tiene_gemini: !!gemini, origen_gemini: c.bot_gemini_api_key ? 'ajustes' : (gemini ? 'env' : 'ninguno'),
      gemini_model:      c.bot_gemini_model || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      nombre_empresa:    c.bot_nombre_empresa || '',
      avisos_usuario_ids: avisos,
      usuarios_vinculados: vinculados,
    };
  }

  /** Guarda desde Ajustes. Campos de secreto vacíos = no cambian. */
  async guardarConfigAdmin(body: {
    activo?: boolean; username?: string; token?: string; gemini_api_key?: string;
    gemini_model?: string; nombre_empresa?: string; avisos_usuario_ids?: number[];
  }) {
    if (body.activo !== undefined)         await this.guardarClave('bot_activo', body.activo ? '1' : '0', 'Bot de Telegram activo');
    if (body.username !== undefined)       await this.guardarClave('bot_username', String(body.username).replace(/^@/, '').trim(), 'Usuario del bot (@)');
    if (body.token && body.token.trim())   await this.guardarClave('bot_token', cifrar(body.token.trim()), 'Token del bot (cifrado)');
    if (body.gemini_api_key && body.gemini_api_key.trim()) await this.guardarClave('bot_gemini_api_key', cifrar(body.gemini_api_key.trim()), 'Clave de Gemini (cifrada)');
    if (body.gemini_model !== undefined)   await this.guardarClave('bot_gemini_model', String(body.gemini_model).trim() || 'gemini-2.5-flash', 'Modelo de Gemini del bot');
    if (body.nombre_empresa !== undefined) await this.guardarClave('bot_nombre_empresa', String(body.nombre_empresa).trim().slice(0, 80), 'Nombre con que se presenta el bot');
    if (body.avisos_usuario_ids !== undefined) await this.guardarClave('bot_avisos_usuarios', JSON.stringify((body.avisos_usuario_ids || []).map(Number).filter(Boolean)), 'Usuarios que reciben avisos del bot');
    return this.configAdmin();
  }

  /** Prueba un token contra Telegram (getMe). Sin token usa el vigente. */
  async probarToken(token?: string) {
    const t = (token && token.trim()) || await this.tokenActual();
    if (!t) throw new BadRequestException('No hay token configurado.');
    try {
      const r = await axios.get(`https://api.telegram.org/bot${t}/getMe`, { timeout: 12000 });
      const b = r.data?.result ?? {};
      return { ok: true, username: b.username, nombre: b.first_name, id: b.id };
    } catch (e: any) {
      const d = e?.response?.data?.description || e?.message;
      throw new BadRequestException(`Telegram rechazó el token: ${d}`);
    }
  }

  /** Lo que lee el bot al arrancar (x-bot-secret). Devuelve secretos descifrados y una versión para detectar cambios. */
  async configParaBot(secret: string) {
    if (!secret || secret !== process.env.TELEGRAM_BOT_SHARED_SECRET) throw new UnauthorizedException('Secret inválido');
    const c = await this.leerClaves();
    const out = {
      activo:         c.bot_activo !== '0',
      token:          c.bot_token ? descifrar(c.bot_token) : (process.env.TELEGRAM_BOT_TOKEN ?? ''),
      gemini_api_key: c.bot_gemini_api_key ? descifrar(c.bot_gemini_api_key) : (process.env.GEMINI_API_KEY ?? ''),
      gemini_model:   c.bot_gemini_model || process.env.GEMINI_MODEL || '',
      nombre_empresa: c.bot_nombre_empresa || '',
      origen:         c.bot_token ? 'ajustes' : 'env',
    };
    const version = crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 16);
    return { ...out, version };
  }

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
