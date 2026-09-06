import {
  Controller, Get, Post, Query, Body, Req,
  UnauthorizedException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FacturacionService } from './facturacion.service';
import { RecibosService } from '../recibos/recibos.service';
import { TipoPago } from './entities/factura-pago.entity';
import { TipoRecibo } from '../recibos/entities/recibo-ingreso.entity';

/**
 * Endpoints para el bot de Telegram (cobros conversacionales).
 * SIN JwtAuthGuard: se protegen con el header `x-bot-secret` (mismo esquema
 * que los módulos telegram/asistente) + vinculación chat_id ↔ usuario.
 */
@Controller('facturacion/bot')
export class FacturacionBotController {
  constructor(
    private svc: FacturacionService,
    private recibos: RecibosService,
    @InjectDataSource() private ds: DataSource,
  ) {}

  /** Fecha local RD (la DB corre en UTC) */
  private hoyRD(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
  }

  /** Valida secret + vinculación + rol. Devuelve el usuario vinculado. */
  private async validarBot(req: any, chatId?: string) {
    const secret = req?.headers?.['x-bot-secret'];
    if (!secret || secret !== process.env.TELEGRAM_BOT_SHARED_SECRET) {
      throw new UnauthorizedException('Secret inválido');
    }
    if (!chatId) throw new BadRequestException('chat_id requerido');
    const [v] = await this.ds.query(
      `SELECT v.usuario_id, u.nombre AS usuario_nombre, u.rol
       FROM telegram_usuarios v JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.chat_id = ? LIMIT 1`,
      [String(chatId)],
    );
    if (!v) throw new UnauthorizedException('Chat no vinculado al ERP');
    if (!['admin', 'supervisor', 'vendedor'].includes(v.rol)) {
      throw new ForbiddenException('Tu rol no puede registrar cobros');
    }
    return v;
  }

  /** Contexto de cobro de una orden: totales, factura si existe, saldo. */
  private async contextoOrden(ordenId: number) {
    const [o] = await this.ds.query(
      `SELECT o.id, o.numero, o.estado, o.cliente_id, c.nombre AS cliente
       FROM ordenes_produccion o LEFT JOIN clientes c ON c.id = o.cliente_id
       WHERE o.id = ?`, [ordenId]);
    if (!o) throw new BadRequestException('Orden no encontrada');

    const [f] = await this.ds.query(
      `SELECT id, numero, total, total_pagado, saldo_pendiente, estado, tipo_ncf
       FROM facturas
       WHERE orden_produccion_id = ? AND estado != 'anulada'
       ORDER BY id DESC LIMIT 1`, [ordenId]);

    if (f) {
      return {
        tipo: 'orden',
        orden: { id: o.id, numero: o.numero, estado: o.estado },
        cliente: o.cliente, cliente_id: o.cliente_id,
        destino: 'factura',
        factura_id: f.id, factura_numero: f.numero, factura_estado: f.estado,
        total: Number(f.total), cobrado: Number(f.total_pagado), saldo: Number(f.saldo_pendiente),
      };
    }

    // Sin factura: el total sale de la ORDEN confirmada (sus líneas), nunca de la
    // cotización. Misma regla de ITBIS que facturación: proforma sin ITBIS, B01/B02/B15
    // con ITBIS, B14 con ITBIS solo si la orden es anterior a la fecha de corte.
    const [oc] = await this.ds.query(
      `SELECT lineas_produccion, tipo_ncf_default, creado_en FROM ordenes_produccion WHERE id = ?`, [ordenId]);
    let total: number | null = null;
    try {
      const ls = typeof oc?.lineas_produccion === 'string' ? JSON.parse(oc.lineas_produccion) : (oc?.lineas_produccion ?? []);
      const ncf = String(oc?.tipo_ncf_default ?? 'PROFORMA').toUpperCase();
      const lleva = ncf === 'PROFORMA' ? false
                  : ncf === 'B14' ? (oc?.creado_en ? new Date(oc.creado_en) < new Date('2026-05-21T00:00:00') : true)
                  : true;
      if (Array.isArray(ls) && ls.length) {
        total = Math.round(ls.reduce((acc: number, l: any) => {
          const base = Number(l?.precio_unitario ?? 0) * Number(l?.cantidad ?? 1);
          const itb  = lleva && l?.aplica_itbis !== false ? base * (Number(l?.porcentaje_itbis ?? 18) / 100) : 0;
          return acc + base + itb;
        }, 0) * 100) / 100;
      }
    } catch { total = null; }
    const [rec] = await this.ds.query(
      `SELECT COALESCE(SUM(monto),0) AS cobrado FROM recibos_ingreso
       WHERE orden_produccion_id = ? AND factura_id IS NULL`, [ordenId]);
    const cobrado = Number(rec?.cobrado ?? 0);
    return {
      tipo: 'orden',
      orden: { id: o.id, numero: o.numero, estado: o.estado },
      cliente: o.cliente, cliente_id: o.cliente_id,
      destino: 'orden',
      factura_id: null,
      total, cobrado,
      saldo: total != null ? Math.max(0, total - cobrado) : null,
    };
  }

  /** GET /facturacion/bot/cobro-contexto?q=768&chat_id=... */
  @Get('cobro-contexto')
  async cobroContexto(@Req() req: any, @Query('q') q?: string, @Query('chat_id') chatId?: string) {
    await this.validarBot(req, chatId);
    const qs = String(q ?? '').trim();
    if (!qs) throw new BadRequestException('q requerido');

    // 1. Número completo OP-YYYY-NNN
    const mFull = qs.toUpperCase().match(/OP[-\s]?(\d{4})[-\s]?(\d{1,4})/);
    if (mFull) {
      const numero = `OP-${mFull[1]}-${mFull[2].padStart(3, '0')}`;
      const [o] = await this.ds.query(`SELECT id FROM ordenes_produccion WHERE numero = ? LIMIT 1`, [numero]);
      if (!o) return { tipo: 'no_encontrada', q: numero };
      return this.contextoOrden(o.id);
    }

    // 2. Solo dígitos = sufijo de orden (año actual primero)
    if (/^\d{1,5}$/.test(qs)) {
      const suf = qs.padStart(3, '0');
      const rows = await this.ds.query(
        `SELECT id, numero FROM ordenes_produccion
         WHERE numero LIKE CONCAT('OP-%-', ?) ORDER BY id DESC LIMIT 2`, [suf]);
      if (!rows.length) return { tipo: 'no_encontrada', q: qs };
      return this.contextoOrden(rows[0].id);
    }

    // 3. Nombre de cliente → órdenes activas (para elegir con botones)
    const rows = await this.ds.query(
      `SELECT o.id, o.numero, o.estado, c.nombre AS cliente
       FROM ordenes_produccion o JOIN clientes c ON c.id = o.cliente_id
       WHERE c.nombre LIKE ? AND o.estado NOT IN ('entregado','cancelado')
       ORDER BY o.id DESC LIMIT 5`, [`%${qs}%`]);
    if (!rows.length) return { tipo: 'no_encontrada', q: qs };
    if (rows.length === 1) return this.contextoOrden(rows[0].id);
    return { tipo: 'lista', ordenes: rows };
  }

  /** GET /facturacion/bot/cuentas?chat_id=... — cuentas bancarias activas */
  @Get('cuentas')
  async cuentas(@Req() req: any, @Query('chat_id') chatId?: string) {
    await this.validarBot(req, chatId);
    return this.ds.query(
      `SELECT id, banco, digitos, alias FROM cuentas_banco WHERE activo = 1 ORDER BY id`);
  }

  /** POST /facturacion/bot/cobrar — registra el cobro (orden o factura) */
  @Post('cobrar')
  async cobrar(@Req() req: any, @Body() body: {
    chat_id: string;
    orden_id: number;
    monto: number;
    metodo: string;               // efectivo | transferencia | tarjeta | cheque
    cuenta_banco_id?: number;
    referencia?: string;
  }) {
    const v = await this.validarBot(req, body?.chat_id);

    const monto = Number(body.monto);
    if (!monto || monto <= 0) throw new BadRequestException('Monto inválido');
    const metodo = String(body.metodo || '').toLowerCase();
    if (!['efectivo', 'transferencia', 'tarjeta', 'cheque'].includes(metodo)) {
      throw new BadRequestException('Método inválido');
    }

    // Mismas reglas que la web: transferencia/cheque exigen cuenta + referencia; tarjeta exige referencia
    let banco_nombre: string | undefined;
    let cuenta_digitos: string | undefined;
    if (metodo === 'transferencia' || metodo === 'cheque') {
      if (!body.cuenta_banco_id) throw new BadRequestException('Selecciona la cuenta bancaria que recibió el pago');
      const [cta] = await this.ds.query(`SELECT banco, digitos FROM cuentas_banco WHERE id = ? AND activo = 1`, [body.cuenta_banco_id]);
      if (!cta) throw new BadRequestException('Cuenta bancaria no válida');
      banco_nombre = cta.banco;
      cuenta_digitos = cta.digitos;
      if (!body.referencia?.trim()) throw new BadRequestException(metodo === 'cheque' ? 'Falta el nº de cheque' : 'Falta el nº de confirmación');
    }
    if (metodo === 'tarjeta' && !body.referencia?.trim()) {
      throw new BadRequestException('Falta el nº de autorización de la tarjeta');
    }

    const ctx = await this.contextoOrden(Number(body.orden_id));
    const fecha = this.hoyRD();

    // ── Caso factura: reusar registrarPago (valida saldo, crea pago + recibo + auditoría) ──
    if (ctx.destino === 'factura') {
      const tipo = monto >= Number(ctx.saldo) - 0.01 ? TipoPago.TOTAL : TipoPago.ABONO;
      await this.svc.registrarPago(ctx.factura_id, {
        tipo,
        metodo: metodo as any,
        monto, fecha,
        referencia:      body.referencia?.trim() || undefined,
        banco_nombre, cuenta_digitos,
        cuenta_banco_id: body.cuenta_banco_id ?? undefined,
        nota:            'Registrado vía bot Telegram',
        creado_por:      v.usuario_nombre,
      });
      const [rec] = await this.ds.query(
        `SELECT id, numero FROM recibos_ingreso WHERE factura_id = ? ORDER BY id DESC LIMIT 1`, [ctx.factura_id]);
      const [f2] = await this.ds.query(`SELECT saldo_pendiente, estado FROM facturas WHERE id = ?`, [ctx.factura_id]);
      return {
        ok: true, destino: 'factura',
        factura_numero: ctx.factura_numero,
        recibo_id: rec?.id ?? null, recibo_numero: rec?.numero ?? null,
        nuevo_saldo: Number(f2?.saldo_pendiente ?? 0),
        factura_estado: f2?.estado,
      };
    }

    // ── Caso orden sin factura: anticipo/abono via recibos (regla de saldo si se conoce) ──
    if (ctx.saldo != null && monto > ctx.saldo + 0.01) {
      throw new BadRequestException(
        `El monto (RD$ ${monto.toFixed(2)}) supera el saldo de la orden (RD$ ${Number(ctx.saldo).toFixed(2)})`);
    }
    const recibo = await this.recibos.crear({
      tipo: (ctx.cobrado > 0 ? TipoRecibo.ABONO : TipoRecibo.ANTICIPO),
      orden_produccion_id: ctx.orden.id,
      cliente_id:     ctx.cliente_id ?? undefined,
      cliente_nombre: ctx.cliente ?? undefined,
      metodo, monto, fecha,
      referencia:      body.referencia?.trim() || undefined,
      banco_nombre, cuenta_digitos,
      cuenta_banco_id: body.cuenta_banco_id ?? undefined,
      notas:           'Registrado vía bot Telegram',
      creado_por:      v.usuario_nombre,
    });
    return {
      ok: true, destino: 'orden',
      orden_numero: ctx.orden.numero,
      recibo_id: recibo.id, recibo_numero: recibo.numero,
      nuevo_saldo: ctx.saldo != null ? Math.max(0, ctx.saldo - monto) : null,
    };
  }
}
