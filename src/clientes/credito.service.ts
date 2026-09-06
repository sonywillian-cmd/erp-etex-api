import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import axios from 'axios';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloAuditoria } from '../auditoria/entities/auditoria-financiera.entity';
import { TelegramService } from '../telegram/telegram.service';

/**
 * Crédito a clientes — política: SOLO el admin aprueba.
 *  - Vendedor/supervisor SOLICITAN (límite, plazo, motivo).
 *  - El admin aprueba/rechaza desde la web o desde Telegram (botones).
 *  - Mientras está pendiente, la producción sigue; facturar a crédito queda bloqueado.
 *  - Límite = exposición total del cliente (saldos pendientes de TODAS sus
 *    facturas no anuladas, proformas incluidas) + la factura nueva.
 */
@Injectable()
export class CreditoService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private auditoria: AuditoriaService,
    private telegram: TelegramService,
  ) {}

  private fmt(n: number) {
    return 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Exposición actual: suma de saldos pendientes de todas las facturas vivas del cliente. */
  async exposicion(clienteId: number): Promise<number> {
    const [r] = await this.ds.query(
      `SELECT COALESCE(SUM(saldo_pendiente),0) AS exp FROM facturas WHERE cliente_id = ? AND estado <> 'anulada'`,
      [clienteId],
    );
    return Number(r?.exp ?? 0);
  }

  /** Estado de crédito del cliente + si un monto dado sería permitido. */
  async estado(clienteId: number, monto?: number) {
    const [c] = await this.ds.query(
      `SELECT id, nombre, nombre_comercial, credito_estado, terminos_pago, limite_credito, plazo_credito,
              credito_aprobado_por, credito_aprobado_en
       FROM clientes WHERE id = ?`, [clienteId]);
    if (!c) throw new NotFoundException('Cliente no encontrado');
    const exposicion = await this.exposicion(clienteId);
    const limite = Number(c.limite_credito ?? 0);
    const disponible = Math.max(0, limite - exposicion);
    const [pend] = await this.ds.query(
      `SELECT id, limite_solicitado, plazo_solicitado, motivo, solicitado_por_nombre, creado_en
       FROM solicitudes_credito WHERE cliente_id = ? AND estado = 'pendiente' ORDER BY id DESC LIMIT 1`, [clienteId]);

    let permitido = false; let motivo = '';
    if (c.credito_estado !== 'aprobado') {
      motivo = c.credito_estado === 'pendiente'  ? 'Solicitud de crédito pendiente de aprobación del administrador.'
             : c.credito_estado === 'rechazado'  ? 'El crédito fue rechazado por el administrador.'
             : c.credito_estado === 'suspendido' ? 'El crédito está suspendido.'
             : 'Este cliente no tiene crédito aprobado. Solo el administrador puede autorizarlo.';
    } else if (monto != null && exposicion + Number(monto) > limite + 0.01) {
      motivo = `Límite excedido: límite ${this.fmt(limite)}, expuesto ${this.fmt(exposicion)}, disponible ${this.fmt(disponible)}; esta factura suma ${this.fmt(Number(monto))}.`;
    } else {
      permitido = true;
    }
    return {
      cliente_id: c.id, cliente: c.nombre, nombre_comercial: c.nombre_comercial,
      credito_estado: c.credito_estado, terminos_pago: c.terminos_pago,
      limite, plazo: Number(c.plazo_credito ?? 0) || null, exposicion, disponible,
      aprobado_por: c.credito_aprobado_por, aprobado_en: c.credito_aprobado_en,
      permitido, motivo, solicitud_pendiente: pend ?? null,
    };
  }

  /** Vendedor/supervisor/admin piden crédito para un cliente. Idempotente si ya hay una pendiente. */
  async solicitar(clienteId: number, dto: { limite: number; plazo: number; motivo?: string; orden_id?: number },
                  por: { id?: number; nombre?: string; rol?: string }) {
    const [c] = await this.ds.query(`SELECT id, nombre, credito_estado, limite_credito FROM clientes WHERE id = ?`, [clienteId]);
    if (!c) throw new NotFoundException('Cliente no encontrado');
    const limite = Number(dto.limite); const plazo = Math.floor(Number(dto.plazo));
    if (!limite || limite <= 0) throw new BadRequestException('Indica el límite de crédito solicitado.');
    if (!plazo || plazo <= 0)   throw new BadRequestException('Indica el plazo en días.');

    if (c.credito_estado === 'aprobado' && limite <= Number(c.limite_credito)) {
      throw new BadRequestException(`${c.nombre} ya tiene crédito aprobado por ${this.fmt(Number(c.limite_credito))}.`);
    }
    const [existente] = await this.ds.query(
      `SELECT id FROM solicitudes_credito WHERE cliente_id = ? AND estado = 'pendiente' LIMIT 1`, [clienteId]);
    if (existente) {
      return { ok: true, solicitud_id: existente.id, ya_existia: true,
               mensaje: 'Ya hay una solicitud pendiente para este cliente. El administrador la verá en Telegram y en Clientes → Créditos.' };
    }

    const r = await this.ds.query(
      `INSERT INTO solicitudes_credito
         (cliente_id, orden_id, solicitado_por_id, solicitado_por_nombre, limite_solicitado, plazo_solicitado, motivo)
       VALUES (?,?,?,?,?,?,?)`,
      [clienteId, dto.orden_id ?? null, por.id ?? null, por.nombre ?? null, limite, plazo, (dto.motivo ?? '').slice(0, 300) || null]);
    const solicitudId = r.insertId;
    // Un cliente ya aprobado que pide AUMENTO conserva su crédito mientras se decide.
    if (c.credito_estado !== 'aprobado') {
      await this.ds.query(`UPDATE clientes SET credito_estado = 'pendiente' WHERE id = ?`, [clienteId]);
    }
    await this.auditoria.registrar({
      modulo: ModuloAuditoria.FACTURACION, accion: 'credito_solicitado', entidad_id: clienteId, entidad_numero: c.nombre,
      usuario_id: por.id ?? null, usuario_nombre: por.nombre ?? null, usuario_rol: por.rol ?? null, monto: limite,
      datos: { solicitud_id: solicitudId, plazo, orden_id: dto.orden_id ?? null },
      descripcion: `Solicitud de crédito #${solicitudId} para ${c.nombre}: ${this.fmt(limite)} a ${plazo} días`,
    });

    const telegram = await this.notificarAdmin(solicitudId).catch(() => false);
    return { ok: true, solicitud_id: solicitudId, ya_existia: false, telegram_enviado: telegram,
             mensaje: telegram ? 'Solicitud enviada al administrador por Telegram.' : 'Solicitud registrada (el aviso por Telegram no se pudo enviar; el administrador la verá en Clientes → Créditos).' };
  }

  async listar(estado?: string) {
    const where = estado && estado !== 'todas' ? `WHERE s.estado = ?` : '';
    return this.ds.query(
      `SELECT s.*, c.nombre AS cliente, c.nombre_comercial, c.credito_estado, c.limite_credito AS limite_actual,
              o.numero AS orden_numero,
              (SELECT COALESCE(SUM(f.saldo_pendiente),0) FROM facturas f WHERE f.cliente_id = s.cliente_id AND f.estado <> 'anulada') AS exposicion
       FROM solicitudes_credito s
       JOIN clientes c ON c.id = s.cliente_id
       LEFT JOIN ordenes_produccion o ON o.id = s.orden_id
       ${where}
       ORDER BY FIELD(s.estado,'pendiente','aprobada','rechazada'), s.id DESC LIMIT 300`,
      estado && estado !== 'todas' ? [estado] : []);
  }

  private async solicitudPendiente(id: number) {
    const [s] = await this.ds.query(
      `SELECT s.*, c.nombre AS cliente FROM solicitudes_credito s JOIN clientes c ON c.id = s.cliente_id WHERE s.id = ?`, [id]);
    if (!s) throw new NotFoundException(`Solicitud #${id} no encontrada`);
    if (s.estado !== 'pendiente') throw new BadRequestException(`La solicitud #${id} ya fue ${s.estado} por ${s.resuelto_por ?? 'el administrador'}.`);
    return s;
  }

  /** SOLO ADMIN (lo garantiza el controlador). */
  async aprobar(id: number, admin: { id?: number; nombre?: string }, ajuste?: { limite?: number; plazo?: number }) {
    const s = await this.solicitudPendiente(id);
    const limite = Number(ajuste?.limite ?? s.limite_solicitado);
    const plazo  = Math.floor(Number(ajuste?.plazo ?? s.plazo_solicitado)) || 30;
    if (!limite || limite <= 0) throw new BadRequestException('Límite inválido');
    await this.ds.query(
      `UPDATE clientes SET terminos_pago = 'credito', limite_credito = ?, plazo_credito = ?,
              credito_estado = 'aprobado', credito_aprobado_por = ?, credito_aprobado_en = NOW()
       WHERE id = ?`, [limite, plazo, admin.nombre ?? 'admin', s.cliente_id]);
    await this.ds.query(
      `UPDATE solicitudes_credito SET estado = 'aprobada', resuelto_por = ?, resuelto_en = NOW(),
              respuesta = ?, limite_solicitado = ?, plazo_solicitado = ? WHERE id = ?`,
      [admin.nombre ?? 'admin', `Aprobado: ${this.fmt(limite)} a ${plazo} días`, limite, plazo, id]);
    await this.auditoria.registrar({
      modulo: ModuloAuditoria.FACTURACION, accion: 'credito_aprobado', entidad_id: s.cliente_id, entidad_numero: s.cliente,
      usuario_id: admin.id ?? null, usuario_nombre: admin.nombre ?? null, usuario_rol: 'admin', monto: limite,
      datos: { solicitud_id: id, plazo }, descripcion: `Crédito aprobado a ${s.cliente}: ${this.fmt(limite)} a ${plazo} días`,
    });
    return { ok: true, solicitud_id: id, cliente: s.cliente, limite, plazo };
  }

  async rechazar(id: number, admin: { id?: number; nombre?: string }, motivo?: string) {
    const s = await this.solicitudPendiente(id);
    await this.ds.query(
      `UPDATE solicitudes_credito SET estado = 'rechazada', resuelto_por = ?, resuelto_en = NOW(), respuesta = ? WHERE id = ?`,
      [admin.nombre ?? 'admin', (motivo ?? 'Rechazado por el administrador').slice(0, 300), id]);
    // Solo degrada a 'rechazado' si el cliente estaba esperando; un cliente ya aprobado que pedía aumento conserva su crédito.
    await this.ds.query(`UPDATE clientes SET credito_estado = 'rechazado' WHERE id = ? AND credito_estado = 'pendiente'`, [s.cliente_id]);
    await this.auditoria.registrar({
      modulo: ModuloAuditoria.FACTURACION, accion: 'credito_rechazado', entidad_id: s.cliente_id, entidad_numero: s.cliente,
      usuario_id: admin.id ?? null, usuario_nombre: admin.nombre ?? null, usuario_rol: 'admin', monto: Number(s.limite_solicitado),
      datos: { solicitud_id: id, motivo: motivo ?? null }, descripcion: `Crédito rechazado a ${s.cliente}${motivo ? ': ' + motivo : ''}`,
    });
    return { ok: true, solicitud_id: id, cliente: s.cliente };
  }

  /** Auditoría: todos los clientes con crédito activo/suspendido y su exposición (solo admin). */
  async listarConCredito() {
    return this.ds.query(
      `SELECT c.id, c.nombre, c.nombre_comercial, c.representante, c.credito_estado, c.terminos_pago,
              c.limite_credito, c.plazo_credito, c.credito_aprobado_por, c.credito_aprobado_en,
              (SELECT COUNT(*) FROM facturas f WHERE f.cliente_id = c.id AND f.metodo_pago = 'credito' AND f.estado <> 'anulada' AND f.saldo_pendiente > 0) AS facturas_vivas,
              (SELECT COALESCE(SUM(f.saldo_pendiente),0) FROM facturas f WHERE f.cliente_id = c.id AND f.estado <> 'anulada') AS exposicion,
              (SELECT MAX(f.fecha_emision) FROM facturas f WHERE f.cliente_id = c.id AND f.metodo_pago = 'credito' AND f.estado <> 'anulada') AS ultima_factura_credito,
              (SELECT MIN(f.fecha_vencimiento) FROM facturas f WHERE f.cliente_id = c.id AND f.estado <> 'anulada' AND f.saldo_pendiente > 0 AND f.fecha_vencimiento < CURDATE()) AS vencida_desde
       FROM clientes c
       WHERE c.credito_estado IN ('aprobado','suspendido')
       ORDER BY FIELD(c.credito_estado,'aprobado','suspendido'), exposicion DESC, c.nombre ASC`);
  }

  /**
   * Acciones de auditoría del admin sobre un cliente con crédito:
   *  - confirmar: ratifica el crédito heredado (queda "aprobado por" el admin, con fecha de hoy)
   *  - suspender: bloquea nuevas facturas a crédito, conserva límite/plazo
   *  - reactivar: vuelve a 'aprobado'
   *  - revocar:   quita el crédito (contado, límite 0)
   * Las facturas a crédito ya emitidas no se tocan.
   */
  async auditar(clienteId: number, accion: 'confirmar' | 'suspender' | 'reactivar' | 'revocar',
                admin: { id?: number; nombre?: string }, motivo?: string) {
    const [c] = await this.ds.query(`SELECT id, nombre, credito_estado, limite_credito, plazo_credito FROM clientes WHERE id = ?`, [clienteId]);
    if (!c) throw new NotFoundException('Cliente no encontrado');
    const quien = admin.nombre ?? 'admin';
    let descripcion = '';
    if (accion === 'confirmar') {
      if (c.credito_estado !== 'aprobado') throw new BadRequestException('Solo se confirma un crédito en estado aprobado.');
      await this.ds.query(`UPDATE clientes SET credito_aprobado_por = ?, credito_aprobado_en = NOW() WHERE id = ?`, [quien, clienteId]);
      descripcion = `Crédito de ${c.nombre} confirmado por ${quien}: ${this.fmt(Number(c.limite_credito))} a ${c.plazo_credito ?? 30} días`;
    } else if (accion === 'suspender') {
      if (c.credito_estado !== 'aprobado') throw new BadRequestException('Solo se suspende un crédito aprobado.');
      await this.ds.query(`UPDATE clientes SET credito_estado = 'suspendido' WHERE id = ?`, [clienteId]);
      descripcion = `Crédito de ${c.nombre} SUSPENDIDO por ${quien}${motivo ? ': ' + motivo : ''}`;
    } else if (accion === 'reactivar') {
      if (c.credito_estado !== 'suspendido') throw new BadRequestException('Solo se reactiva un crédito suspendido.');
      await this.ds.query(`UPDATE clientes SET credito_estado = 'aprobado', credito_aprobado_por = ?, credito_aprobado_en = NOW() WHERE id = ?`, [quien, clienteId]);
      descripcion = `Crédito de ${c.nombre} reactivado por ${quien}`;
    } else {
      await this.ds.query(
        `UPDATE clientes SET credito_estado = 'sin_credito', terminos_pago = 'contado', limite_credito = 0, plazo_credito = NULL,
                credito_aprobado_por = NULL, credito_aprobado_en = NULL WHERE id = ?`, [clienteId]);
      descripcion = `Crédito de ${c.nombre} RETIRADO por ${quien}${motivo ? ': ' + motivo : ''} (tenía ${this.fmt(Number(c.limite_credito))})`;
    }
    await this.auditoria.registrar({
      modulo: ModuloAuditoria.FACTURACION, accion: `credito_${accion}`, entidad_id: clienteId, entidad_numero: c.nombre,
      usuario_id: admin.id ?? null, usuario_nombre: admin.nombre ?? null, usuario_rol: 'admin', monto: Number(c.limite_credito ?? 0),
      datos: { estado_anterior: c.credito_estado, motivo: motivo ?? null }, descripcion,
    });
    return { ok: true, cliente_id: clienteId, cliente: c.nombre, accion };
  }

  /** Aviso por Telegram a TODOS los chats vinculados de usuarios admin, con botones Aprobar/Rechazar. */
  async notificarAdmin(solicitudId: number): Promise<boolean> {
    const token = await this.telegram.tokenActual();   // Ajustes o .env
    if (!token) return false;
    const [s] = await this.ds.query(
      `SELECT s.*, c.nombre AS cliente, c.nombre_comercial, o.numero AS orden_numero
       FROM solicitudes_credito s JOIN clientes c ON c.id = s.cliente_id
       LEFT JOIN ordenes_produccion o ON o.id = s.orden_id WHERE s.id = ?`, [solicitudId]);
    if (!s) return false;
    // Destinatarios: los marcados en Ajustes → Bot; si no hay, todos los admin vinculados
    const chats = await this.telegram.chatsParaAvisos();
    if (!chats.length) return false;
    const exposicion = await this.exposicion(s.cliente_id);
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const texto =
      `🔐 <b>Solicitud de crédito #${s.id}</b>\n` +
      `Cliente: <b>${esc(s.cliente)}</b>${s.nombre_comercial ? ` (${esc(s.nombre_comercial)})` : ''}\n` +
      `Límite: <b>${this.fmt(Number(s.limite_solicitado))}</b> · Plazo: <b>${s.plazo_solicitado} días</b>\n` +
      `Exposición actual: ${this.fmt(exposicion)}\n` +
      (s.orden_numero ? `Orden: ${esc(s.orden_numero)}\n` : '') +
      `Pide: ${esc(s.solicitado_por_nombre ?? '—')}\n` +
      (s.motivo ? `Motivo: ${esc(s.motivo)}\n` : '') +
      `\nSolo tú puedes autorizarlo.`;
    const reply_markup = { inline_keyboard: [[
      { text: '✅ Aprobar', callback_data: `cred_ok:${s.id}` },
      { text: '❌ Rechazar', callback_data: `cred_no:${s.id}` },
    ]] };
    let alguno = false;
    for (const ch of chats) {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: ch.chat_id, text: texto, parse_mode: 'HTML', reply_markup }, { timeout: 12000 });
        alguno = true;
      } catch (e: any) {
        console.error('[Credito] Telegram no enviado a', ch.chat_id, e?.response?.data?.description ?? e?.message);
      }
    }
    return alguno;
  }
}
