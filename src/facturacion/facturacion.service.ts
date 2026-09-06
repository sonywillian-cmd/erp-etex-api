import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not, In } from 'typeorm';
import { Factura, EstadoFactura, TipoComprobante, MetodoPago } from './entities/factura.entity';
import { FacturaLinea } from './entities/factura-linea.entity';
import { FacturaPago, TipoPago } from './entities/factura-pago.entity';
import { NotaCredito, TipoNotaCredito, MotivoNotaCredito } from './entities/nota-credito.entity';
import { NcfSecuencia, TipoNcf } from './entities/ncf-secuencia.entity';
import { RecibosService } from '../recibos/recibos.service';
import { TipoRecibo } from '../recibos/entities/recibo-ingreso.entity';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloAuditoria, AccionAuditoria } from '../auditoria/entities/auditoria-financiera.entity';
import { CajaService }      from '../caja/caja.service';

// Interfaces mínimas para consultas en crudo (sin importar entidades externas)
interface OrdenRaw { cotizacion_id: number; }
interface LineaCotRaw {
  descripcion:     string;
  tecnica:         string | null;
  prod_nombre:     string | null;
  cantidad:        number;
  precio_unitario: number;
  producto_id:     number | null;
}

@Injectable()
export class FacturacionService {
  constructor(
    @InjectRepository(Factura)       private facturaRepo: Repository<Factura>,
    @InjectRepository(FacturaLinea)  private lineaRepo: Repository<FacturaLinea>,
    @InjectRepository(FacturaPago)   private pagoRepo: Repository<FacturaPago>,
    @InjectRepository(NotaCredito)   private ncRepo: Repository<NotaCredito>,
    @InjectRepository(NcfSecuencia)  private ncfRepo: Repository<NcfSecuencia>,
    private ds: DataSource,
    private recibosService: RecibosService,
    private auditoria: AuditoriaService,
    private cajaService: CajaService,
  ) {}

  // ── Número correlativo interno ─────────────────────────────────────────────
  // Recibe el entity-manager de la transacción en curso para ejecutar
  // SELECT … FOR UPDATE y evitar duplicados bajo carga concurrente.
  private async nextNumeroFactura(tipoNcf: string, em: any): Promise<string> {
    const year       = new Date().getFullYear();
    const isProforma = tipoNcf === 'PROFORMA';
    const prefix     = isProforma ? `PRO-${year}` : `FAC-${year}`;
    // Ordenar por el sufijo numérico, NO por id: si existe un número "adelantado"
    // (ej. PRO-2026-0473 de FADECU, renumerada a mano), ordenar por id devuelve
    // otro menor y el siguiente colisiona con uq_numero para siempre (ago-2026).
    const [last]     = await em.query(
      `SELECT numero FROM facturas WHERE numero LIKE ?
        ORDER BY CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED) DESC LIMIT 1 FOR UPDATE`,
      [`${prefix}%`],
    ) as { numero: string }[];
    if (!last) return `${prefix}-0001`;
    const match = last.numero.match(/(\d+)$/);
    const next  = match ? parseInt(match[1]) + 1 : 1;
    return `${prefix}-${String(next).padStart(4, '0')}`;
  }

  // ── Vista previa del próximo NCF (no consume secuencia) ───────────────────
  // Lo usa el modal de facturación (GET /facturacion/ncf/preview?tipo=B01).
  async previewNcf(tipo: string) {
    const t = String(tipo || '').toUpperCase();
    if (!t || t === 'PROFORMA') {
      return { proximo: null, disponibles: null, sin_limite: true, vence: null, dias_para_vencer: null, error: null, alerta_pronto: false, alerta_disponibles: false, mensaje: 'Proforma: no consume comprobante fiscal' };
    }
    const rows = await this.ds.query<any[]>(
      `SELECT * FROM ncf_secuencias WHERE tipo = ? AND activo = 1 LIMIT 1`, [t]);
    if (!rows.length) {
      return { proximo: null, disponibles: null, sin_limite: false, vence: null, dias_para_vencer: null, error: `No hay secuencia activa para ${t}`, alerta_pronto: false, alerta_disponibles: false };
    }
    const s = rows[0];
    const sinLimite   = Number(s.hasta) >= 99999999;
    const disponibles = sinLimite ? null : Math.max(0, Number(s.hasta) - Number(s.actual));
    const proximo     = `${t}${String(Number(s.actual) + 1).padStart(8, '0')}`;
    let vence: string | null = null, dias: number | null = null;
    if (s.fecha_vencimiento) {
      const d = new Date(s.fecha_vencimiento);
      if (!isNaN(d.getTime())) {
        vence = d.toISOString().slice(0, 10);
        dias  = Math.ceil((d.getTime() - Date.now()) / 86400000);
      }
    }
    const error = (!sinLimite && (disponibles as number) <= 0) ? `Secuencia ${t} agotada`
      : (dias != null && dias < 0 ? `Secuencia ${t} vencida` : null);
    return {
      proximo, disponibles, sin_limite: sinLimite, vence, dias_para_vencer: dias, error,
      alerta_pronto: dias != null && dias >= 0 && dias <= 30,
      alerta_disponibles: disponibles != null && disponibles <= 10,
    };
  }

  // ── Asignar siguiente NCF de la secuencia ─────────────────────────────────
  // Operación 100% atómica: un solo UPDATE que solo aplica si hay número disponible.
  // Elimina la condición de carrera que generaba NCF duplicados bajo carga concurrente.
  async siguienteNcf(tipo: TipoNcf): Promise<string> {
    const result: { affectedRows: number } = await this.ds.query(
      `UPDATE ncf_secuencias SET actual = actual + 1
       WHERE tipo = ? AND activo = 1 AND actual < hasta`,
      [tipo],
    );
    if (result.affectedRows === 0) {
      const seq = await this.ncfRepo.findOne({ where: { tipo, activo: true } });
      if (!seq) throw new BadRequestException(`No hay secuencia NCF activa para ${tipo}`);
      throw new BadRequestException(`Secuencia NCF ${tipo} agotada (último: ${seq.actual} / hasta: ${seq.hasta})`);
    }
    const [seq] = await this.ds.query<{ actual: number; tipo: string }[]>(
      `SELECT actual, tipo FROM ncf_secuencias WHERE tipo = ? AND activo = 1`,
      [tipo],
    );
    return `${seq.tipo}${String(seq.actual).padStart(8, '0')}`;
  }

  // ── Calcular totales de líneas (con descuento global opcional) ─────────────
  // El descuento global (heredado de la cotización) se aplica sobre el subtotal Y
  // proporcionalmente sobre el ITBIS (regla DGII: ITBIS sobre la base descontada),
  // igual que en cotizaciones.service. Antes la factura IGNORABA el descuento y
  // sobrecobraba (jun-2026, caso Electro Capellán COT-333 2.6%).
  private calcularTotales(
    lineas: { precio_unitario: number; cantidad: number; itbis_pct: number }[],
    descuentoPct = 0,
  ) {
    let subtotal = 0;
    let itbisBruto = 0;
    for (const l of lineas) {
      const sub    = Number(l.precio_unitario) * Number(l.cantidad);
      const itbisL = sub * (Number(l.itbis_pct) / 100);
      subtotal   += sub;
      itbisBruto += itbisL;
    }
    const pct             = Math.max(0, Number(descuentoPct) || 0);
    const descuento_monto = +(subtotal * pct / 100).toFixed(2);
    const base            = +(subtotal - descuento_monto).toFixed(2);
    const itbis           = +(itbisBruto * (1 - pct / 100)).toFixed(2);
    const total           = +(base + itbis).toFixed(2);
    return {
      subtotal:        +subtotal.toFixed(2),
      descuento_pct:   pct,
      descuento_monto,
      base,
      itbis,
      total,
    };
  }

  // ── Recalcular saldo de factura ────────────────────────────────────────────
  // SELECT FOR UPDATE bloquea la fila durante el recálculo.
  // Previene condición de carrera cuando dos pagos llegan simultáneamente.
  private async recalcularSaldo(facturaId: number): Promise<void> {
    await this.ds.transaction(async (em) => {
      // Bloquear la fila: ningún otro hilo puede leer/escribir esta factura hasta que termine
      const [factura] = await em.query<{ id: number; total: string; estado: string }[]>(
        `SELECT id, total, estado FROM facturas WHERE id = ? FOR UPDATE`,
        [facturaId],
      );
      if (!factura) return;

      const [{ pagado }] = await em.query<{ pagado: string }[]>(
        `SELECT COALESCE(SUM(monto), 0) AS pagado
         FROM factura_pagos
         WHERE factura_id = ? AND (revertido IS NULL OR revertido = 0)`,
        [facturaId],
      );
      const [{ nc_total }] = await em.query<{ nc_total: string }[]>(
        `SELECT COALESCE(SUM(total), 0) AS nc_total
         FROM notas_credito WHERE factura_id = ?`,
        [facturaId],
      );

      const totalPagado  = +Number(pagado).toFixed(2);
      const totalNC      = +Number(nc_total).toFixed(2);
      const saldo        = +Math.max(0, Number(factura.total) - totalPagado - totalNC).toFixed(2);
      const creditoFavor = +Math.max(0, totalPagado + totalNC - Number(factura.total)).toFixed(2);

      let estado = factura.estado as EstadoFactura;
      if (factura.estado !== 'anulada') {
        if (saldo === 0)          estado = EstadoFactura.PAGADA;
        else if (totalPagado > 0) estado = EstadoFactura.PARCIAL;
      }

      await em.query(
        `UPDATE facturas
         SET total_pagado = ?, saldo_pendiente = ?, credito_a_favor = ?, estado = ?
         WHERE id = ?`,
        [totalPagado, saldo, creditoFavor, estado, facturaId],
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NCF SECUENCIAS
  // ═══════════════════════════════════════════════════════════════════════════

  findAllNcf() {
    return this.ncfRepo.find({ order: { tipo: 'ASC' } });
  }

  async upsertNcf(dto: { tipo: TipoNcf; desde: number; hasta: number; actual?: number; notas?: string; fecha_vencimiento?: string | null }) {
    const existe = await this.ncfRepo.findOne({ where: { tipo: dto.tipo } });
    if (existe) {
      await this.ncfRepo.update(existe.id, {
        desde:             dto.desde,
        hasta:             dto.hasta,
        actual:            dto.actual ?? existe.actual,
        notas:             dto.notas,
        fecha_vencimiento: dto.fecha_vencimiento ?? existe.fecha_vencimiento,
        activo:            true,
      });
      return this.ncfRepo.findOne({ where: { id: existe.id } });
    }
    const nuevo = this.ncfRepo.create({ ...dto, actual: dto.actual ?? dto.desde - 1 });
    return this.ncfRepo.save(nuevo);
  }

  async migrarColumnaNcfFechaVencimiento() {
    await this.ds.query(`
      ALTER TABLE ncf_secuencias
      ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE NULL
    `);
    return { ok: true };
  }

  async toggleNcf(id: number) {
    const seq = await this.ncfRepo.findOne({ where: { id } });
    if (!seq) throw new NotFoundException('Secuencia no encontrada');
    await this.ncfRepo.update(id, { activo: !seq.activo });
    return this.ncfRepo.findOne({ where: { id } });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FACTURAS
  // ═══════════════════════════════════════════════════════════════════════════

  findAll(filtros?: { estado?: string; tipo_ncf?: string; desde?: string; hasta?: string; orden_produccion_id?: number; cliente_id?: number }) {
    const qb = this.facturaRepo.createQueryBuilder('f').orderBy('f.id', 'DESC');
    if (filtros?.estado)              qb.andWhere('f.estado = :estado',              { estado: filtros.estado });
    if (filtros?.tipo_ncf)            qb.andWhere('f.tipo_ncf = :tipo',              { tipo: filtros.tipo_ncf });
    if (filtros?.orden_produccion_id) qb.andWhere('f.orden_produccion_id = :opid',  { opid: filtros.orden_produccion_id });
    if (filtros?.cliente_id)          qb.andWhere('f.cliente_id = :cid',            { cid: filtros.cliente_id });
    if (filtros?.desde)    qb.andWhere('f.fecha_emision >= :d',  { d: filtros.desde });
    if (filtros?.hasta)    qb.andWhere('f.fecha_emision <= :h',  { h: filtros.hasta });
    return qb.getMany();
  }

  // Facturas con saldo pendiente para un cliente (para módulo de cobros)
  async pendientesCliente(clienteId: number) {
    const facturas = await this.facturaRepo.createQueryBuilder('f')
      .where('f.cliente_id = :cid', { cid: clienteId })
      .andWhere('f.saldo_pendiente > 0')
      .andWhere('f.estado NOT IN (:...excluir)', { excluir: ['pagada', 'anulada', 'borrador'] })
      .orderBy('f.fecha_vencimiento', 'ASC')
      .addOrderBy('f.id', 'ASC')
      .getMany();

    // Órdenes sin factura con recibos pendientes
    const ordenes = await this.ds.query(`
      SELECT
        op.id,
        op.numero,
        op.cliente_id,
        op.estado_produccion,
        op.fecha_comprometida,
        op.fecha_hora_entrega,
        c.total AS total_cotizacion,
        COALESCE(SUM(ri.monto), 0) AS total_recibos
      FROM ordenes_produccion op
      LEFT JOIN cotizaciones c ON c.id = op.cotizacion_id
      LEFT JOIN recibos_ingreso ri ON ri.orden_produccion_id = op.id
      WHERE op.cliente_id = ?
        AND op.estado_produccion NOT IN ('cancelada')
        AND NOT EXISTS (
          SELECT 1 FROM facturas f2 WHERE f2.orden_produccion_id = op.id
        )
      GROUP BY op.id, op.numero, op.cliente_id, op.estado_produccion,
               op.fecha_comprometida, op.fecha_hora_entrega, c.total
      HAVING (c.total - COALESCE(SUM(ri.monto), 0)) > 0
      ORDER BY op.id ASC
    `, [clienteId]);

    return { facturas, ordenes };
  }

  async findOne(id: number) {
    const f = await this.facturaRepo.findOne({
      where: { id },
      relations: ['lineas', 'pagos', 'notas_credito'],
    });
    if (!f) throw new NotFoundException('Factura no encontrada');
    return f;
  }

  /** CANDADO DE CRÉDITO — aplica a TODA factura a crédito (proformas incluidas).
   *  El cliente debe tener crédito APROBADO por el admin y la exposición total
   *  (saldos pendientes de todas sus facturas no anuladas) + esta factura no puede
   *  superar el límite. Devuelve el plazo en días para calcular el vencimiento.
   *  Los mensajes llevan el prefijo 'credito:' para que el frontend ofrezca "Solicitar crédito". */
  private async validarCreditoCliente(em: any, clienteId: number | null, monto: number): Promise<number> {
    const fmt = (n: number) => 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!clienteId) {
      throw new BadRequestException('credito:La factura no está enlazada a un cliente registrado. Vincula el cliente antes de facturar a crédito.');
    }
    const [c] = await em.query(
      `SELECT nombre, credito_estado, limite_credito, plazo_credito FROM clientes WHERE id = ?`, [clienteId]);
    if (!c) throw new BadRequestException('credito:Cliente no encontrado.');
    if (c.credito_estado !== 'aprobado') {
      const detalle = c.credito_estado === 'pendiente'  ? 'tiene una solicitud de crédito pendiente de aprobación'
                    : c.credito_estado === 'rechazado'  ? 'tiene el crédito rechazado'
                    : c.credito_estado === 'suspendido' ? 'tiene el crédito suspendido'
                    : 'no tiene crédito aprobado';
      throw new BadRequestException(`credito:${c.nombre} ${detalle}. Solo el administrador puede autorizarlo.`);
    }
    const [e] = await em.query(
      `SELECT COALESCE(SUM(saldo_pendiente),0) AS exp FROM facturas WHERE cliente_id = ? AND estado <> 'anulada'`, [clienteId]);
    const exposicion = Number(e?.exp ?? 0);
    const limite     = Number(c.limite_credito ?? 0);
    if (exposicion + monto > limite + 0.01) {
      throw new BadRequestException(
        `credito:Límite de crédito excedido para ${c.nombre}. Límite ${fmt(limite)}, expuesto ${fmt(exposicion)}, ` +
        `disponible ${fmt(Math.max(0, limite - exposicion))}; esta factura suma ${fmt(monto)}.`);
    }
    return Number(c.plazo_credito ?? 30) || 30;
  }

  async crear(dto: {
    tipo_ncf: TipoComprobante;
    orden_produccion_id?: number;
    cotizacion_id?: number;
    cliente_id?: number;
    cliente_nombre?: string;
    cliente_rnc?: string;
    cliente_direccion?: string;
    cliente_telefono?: string;
    atencion_a?: string | null;
    metodo_pago?: MetodoPago;
    fecha_vencimiento?: string;
    notas?: string;
    creado_por?: string;
    itbis_forzado?: boolean; // true cuando B02 + tarjeta
    lineas: {
      producto_id?: number;
      descripcion: string;
      cantidad: number;
      precio_unitario: number;
      itbis_pct: number;
    }[];
  }) {
    const result = await this.ds.transaction(async em => {
      // ── Validar factura única por orden de producción ─────────────────────
      if (dto.orden_produccion_id) {
        const existente = await em.findOne(Factura, {
          where: {
            orden_produccion_id: dto.orden_produccion_id,
            estado: Not(In([EstadoFactura.ANULADA])),
          },
        });
        if (existente) {
          throw new BadRequestException(
            `Ya existe la factura ${existente.numero} (${existente.estado}) para esta orden. ` +
            `Anúlala primero si deseas reemplazarla.`,
          );
        }
      }

      // Asignar NCF (Proforma no consume secuencia)
      let ncf: string | null = null;
      if (dto.tipo_ncf !== TipoComprobante.PROFORMA) {
        ncf = await this.siguienteNcf(dto.tipo_ncf as unknown as TipoNcf);
      }

      const numero = await this.nextNumeroFactura(dto.tipo_ncf, em);

      // Auto-poblar líneas desde la ORDEN FINAL si no se enviaron.
      // Prioridad: lineas_produccion JSON (refleja la última edición de la orden).
      // Fallback: lineas_cotizacion (órdenes legacy sin precio en el JSON).
      let lineasInput = dto.lineas;
      if (lineasInput.length === 0 && dto.orden_produccion_id) {
        const [orden] = await em.query(
          `SELECT cotizacion_id, lineas_produccion FROM ordenes_produccion WHERE id = ?`,
          [dto.orden_produccion_id],
        ) as { cotizacion_id: number | null; lineas_produccion: any }[];

        // Parsear JSON de lineas_produccion de forma segura
        const lineasJson: any[] = (() => {
          try {
            const raw = orden?.lineas_produccion;
            return Array.isArray(raw) ? raw
              : (typeof raw === 'string' ? JSON.parse(raw) : []);
          } catch { return []; }
        })();

        // Usar lineas_produccion si tiene precios (órdenes creadas con la nueva lógica)
        const tienePrecios = lineasJson.some(
          l => l.precio_unitario != null && Number(l.precio_unitario) > 0,
        );

        if (tienePrecios) {
          lineasInput = lineasJson.map(l => {
            const base = `${l.producto}${l.descripcion ? ` — ${l.descripcion}` : ''}`;
            const desc  = l.tecnica ? `${base} | ${l.tecnica}` : base;
            return {
              descripcion:     desc.trim() || l.producto,
              cantidad:        Number(l.cantidad),
              precio_unitario: Number(l.precio_unitario),
              itbis_pct:       l.aplica_itbis ? Number(l.porcentaje_itbis ?? 18) : 0,
              producto_id:     l.producto_id ?? undefined,
            };
          });
        } else if (orden?.cotizacion_id) {
          // Fallback: órdenes creadas antes del fix — usar cotización bloqueada
          const lineaRows = await em.query(
            `SELECT lc.descripcion, lc.tecnica, lc.cantidad,
                    lc.precio_unitario, lc.producto_id,
                    p.nombre AS prod_nombre
             FROM lineas_cotizacion lc
             LEFT JOIN productos p ON p.id = lc.producto_id
             WHERE lc.cotizacion_id = ?
             ORDER BY lc.orden ASC`,
            [orden.cotizacion_id],
          ) as LineaCotRaw[];
          lineasInput = lineaRows.map(l => {
            const partes: string[] = [];
            if (l.prod_nombre) partes.push(l.prod_nombre);
            if (l.descripcion && l.descripcion !== l.prod_nombre) partes.push(l.descripcion);
            const base = partes.join(' — ');
            const descripcionCompleta = l.tecnica ? `${base} | ${l.tecnica}` : base;
            return {
              descripcion:     descripcionCompleta || l.descripcion,
              cantidad:        Number(l.cantidad),
              precio_unitario: Number(l.precio_unitario),
              itbis_pct:       0,
              producto_id:     l.producto_id ?? undefined,
            };
          });
        }
      }

      // Calcular ITBIS según tipo y método de pago
      const lineasCalc = lineasInput.map(l => {
        let itbis_pct = Number(l.itbis_pct);
        // PROFORMA nunca lleva ITBIS: no es comprobante fiscal, aunque la
        // cotización/orden traiga líneas con aplica_itbis marcado
        if (dto.tipo_ncf === TipoComprobante.PROFORMA) {
          itbis_pct = 0;
        }
        // B02 + tarjeta → ITBIS 18% forzado
        if (dto.tipo_ncf === TipoComprobante.B02 &&
            dto.metodo_pago === MetodoPago.TARJETA) {
          itbis_pct = 18;
        }
        const subtotal    = +(Number(l.precio_unitario) * Number(l.cantidad)).toFixed(2);
        const itbis_monto = +(subtotal * (itbis_pct / 100)).toFixed(2);
        return { ...l, itbis_pct, subtotal, itbis_monto, total: +(subtotal + itbis_monto).toFixed(2) };
      });

      // ── Descuento global heredado de la cotización ────────────────────────
      // La factura debe respetar el descuento pactado en la cotización; antes lo
      // ignoraba y el total salía inflado. Buscamos el cotizacion_id (del dto o
      // de la orden) y leemos su descuento_pct.
      let descuentoPct = 0;
      let cotIdDesc: number | null = dto.cotizacion_id ?? null;
      if (!cotIdDesc && dto.orden_produccion_id) {
        const [o2] = await em.query(
          `SELECT cotizacion_id FROM ordenes_produccion WHERE id = ?`,
          [dto.orden_produccion_id],
        ) as { cotizacion_id: number | null }[];
        cotIdDesc = o2?.cotizacion_id ?? null;
      }
      if (cotIdDesc) {
        const [c] = await em.query(
          `SELECT descuento_pct FROM cotizaciones WHERE id = ?`,
          [cotIdDesc],
        ) as { descuento_pct: number | null }[];
        descuentoPct = Math.max(0, Number(c?.descuento_pct ?? 0) || 0);
      }

      const totales = this.calcularTotales(lineasCalc, descuentoPct);

      // ── Cliente de la factura: si el modal no lo mandó, se resuelve por la orden ──
      let clienteIdFinal: number | null = dto.cliente_id ?? null;
      let atencionA: string | null = dto.atencion_a ? String(dto.atencion_a).trim().slice(0, 120) : null;
      if (dto.orden_produccion_id && (!clienteIdFinal || (!atencionA && dto.atencion_a === undefined))) {
        const [oc] = await em.query(`SELECT cliente_id, solicitado_por FROM ordenes_produccion WHERE id = ?`, [dto.orden_produccion_id]);
        clienteIdFinal = clienteIdFinal ?? (oc?.cliente_id ?? null);
        if (dto.atencion_a === undefined) atencionA = oc?.solicitado_por ?? null; // hereda de la orden
      }

      // ── Candado de crédito (todas las facturas a crédito, proformas incluidas) ──
      let fechaVencFinal = dto.fecha_vencimiento;
      if (String(dto.metodo_pago ?? '').toLowerCase() === 'credito') {
        const plazo = await this.validarCreditoCliente(em, clienteIdFinal, Number(totales.total));
        if (!fechaVencFinal) {
          const d = new Date(); d.setDate(d.getDate() + plazo);
          fechaVencFinal = d.toISOString().slice(0, 10);
        }
      }

      const factura = em.create(Factura, {
        numero,
        ncf,
        tipo_ncf:           dto.tipo_ncf,
        orden_produccion_id: dto.orden_produccion_id,
        cotizacion_id:      dto.cotizacion_id,
        cliente_id:         clienteIdFinal ?? undefined,
        cliente_nombre:     dto.cliente_nombre,
        cliente_rnc:        dto.cliente_rnc,
        cliente_direccion:  dto.cliente_direccion,
        cliente_telefono:   dto.cliente_telefono,
        atencion_a:         atencionA ?? undefined,
        metodo_pago:        dto.metodo_pago,
        subtotal:           totales.subtotal,
        descuento_pct:      totales.descuento_pct,
        descuento_monto:    totales.descuento_monto,
        itbis:              totales.itbis,
        total:              totales.total,
        saldo_pendiente:    totales.total,
        estado:             EstadoFactura.EMITIDA,
        fecha_vencimiento:  fechaVencFinal,
        notas:              dto.notas,
        creado_por:         dto.creado_por,
      });
      const saved = await em.save(Factura, factura);

      // Guardar líneas
      for (const l of lineasCalc) {
        await em.save(FacturaLinea, em.create(FacturaLinea, { ...l, factura_id: saved.id }));
      }

      return em.findOne(Factura, { where: { id: saved.id }, relations: ['lineas', 'pagos', 'notas_credito'] });
    });

    // ── Carry-forward: aplicar anticipos de la orden ───────────────────────
    let facturaFinal = result;
    if (result?.orden_produccion_id) {
      await this.aplicarAnticiposOrden(result.id, result.orden_produccion_id);
      facturaFinal = await this.findOne(result.id);
    }
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.FACTURACION,
      accion:         AccionAuditoria.FACTURA_CREADA,
      entidad_id:     facturaFinal?.id ?? null,
      entidad_numero: facturaFinal?.numero ?? null,
      usuario_nombre: dto.creado_por ?? null,
      monto:          facturaFinal?.total ?? null,
      datos: {
        tipo_ncf:            dto.tipo_ncf,
        cliente_nombre:      dto.cliente_nombre ?? null,
        orden_produccion_id: dto.orden_produccion_id ?? null,
      },
      descripcion: `Factura ${facturaFinal?.numero} creada por RD$ ${facturaFinal?.total}`,
    });
    return facturaFinal;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FACTURACIÓN CONSOLIDADA — varias órdenes en una sola factura (intermediarios)
  // ═══════════════════════════════════════════════════════════════════════════

  private async asegurarTablaFacturaOrdenes(): Promise<void> {
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS factura_ordenes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          factura_id INT NOT NULL,
          orden_id INT NOT NULL,
          UNIQUE KEY uq_fo (factura_id, orden_id),
          INDEX idx_fo_orden (orden_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    } catch { /* ya existe */ }
  }

  /** Líneas facturables de una orden, con el descuento de su cotización ya
   *  aplicado al precio unitario (para poder mezclar órdenes con descuentos distintos). */
  private async lineasDeOrden(ordenId: number): Promise<any[]> {
    const [orden] = await this.ds.query(
      `SELECT cotizacion_id, lineas_produccion FROM ordenes_produccion WHERE id = ?`, [ordenId],
    ) as { cotizacion_id: number | null; lineas_produccion: any }[];
    if (!orden) return [];

    let desc = 0;
    if (orden.cotizacion_id) {
      const [c] = await this.ds.query(`SELECT descuento_pct FROM cotizaciones WHERE id = ?`, [orden.cotizacion_id]);
      desc = Math.max(0, Number(c?.descuento_pct ?? 0) || 0);
    }
    const factorDesc = 1 - desc / 100;

    const lineasJson: any[] = (() => {
      try {
        const raw = orden.lineas_produccion;
        return Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
      } catch { return []; }
    })();

    return lineasJson
      .filter(l => Number(l.cantidad) > 0 && Number(l.precio_unitario) >= 0)
      .map(l => {
        const base = `${l.producto}${l.descripcion ? ` — ${l.descripcion}` : ''}`;
        const descTxt = l.tecnica ? `${base} | ${l.tecnica}` : base;
        return {
          descripcion:     (descTxt.trim() || l.producto),
          cantidad:        Number(l.cantidad),
          precio_unitario: +(Number(l.precio_unitario) * factorDesc).toFixed(2),
          itbis_pct:       l.aplica_itbis ? Number(l.porcentaje_itbis ?? 18) : 0,
          producto_id:     l.producto_id ?? undefined,
        };
      });
  }

  /** Órdenes de un cliente que están listas/entregadas y aún NO facturadas
   *  (ni por factura simple ni consolidada). Candidatas a consolidar. */
  async ordenesConsolidables(clienteId: number): Promise<any[]> {
    await this.asegurarTablaFacturaOrdenes();
    return this.ds.query(`
      SELECT o.id, o.numero, o.estado,
             DATE_FORMAT(CONVERT_TZ(COALESCE(o.fecha_hora_entrega, o.fecha_comprometida),'+00:00','-04:00'),'%Y-%m-%d') AS entrega,
             o.lineas_produccion
        FROM ordenes_produccion o
       WHERE o.cliente_id = ?
         AND o.estado IN ('listo','listo_parcial','en_terminacion','entregado')
         AND NOT EXISTS (SELECT 1 FROM facturas f
                          WHERE f.orden_produccion_id = o.id AND f.estado != 'anulada')
         AND NOT EXISTS (SELECT 1 FROM factura_ordenes fo
                          JOIN facturas f2 ON f2.id = fo.factura_id AND f2.estado != 'anulada'
                          WHERE fo.orden_id = o.id)
       ORDER BY o.numero ASC`, [clienteId]);
  }

  /** Crea UNA factura (normalmente proforma) que agrupa varias órdenes. */
  async crearConsolidada(dto: {
    cliente_id: number;
    orden_ids: number[];
    tipo_ncf?: TipoComprobante;
    metodo_pago?: MetodoPago;
    fecha_vencimiento?: string;
    notas?: string;
    creado_por?: string;
  }) {
    await this.asegurarTablaFacturaOrdenes();
    if (!dto.orden_ids?.length) throw new BadRequestException('Selecciona al menos una orden.');

    // Validar que ninguna esté ya facturada y que todas sean del cliente
    const candidatas = await this.ordenesConsolidables(dto.cliente_id);
    const idsValidos = new Set(candidatas.map((o: any) => Number(o.id)));
    const invalidas = dto.orden_ids.filter(id => !idsValidos.has(Number(id)));
    if (invalidas.length) {
      throw new BadRequestException(`Estas órdenes ya están facturadas o no pertenecen al cliente: ${invalidas.join(', ')}`);
    }

    // Datos del cliente
    const [cli] = await this.ds.query(
      `SELECT nombre, documento AS rnc, direccion, telefono FROM clientes WHERE id = ?`, [dto.cliente_id]);

    // Juntar todas las líneas (todo corrido, con descuento por orden ya aplicado)
    const lineas: any[] = [];
    for (const oid of dto.orden_ids) lineas.push(...await this.lineasDeOrden(oid));
    if (!lineas.length) throw new BadRequestException('Las órdenes seleccionadas no tienen líneas facturables.');

    const numeros = candidatas.filter((o: any) => dto.orden_ids.includes(Number(o.id))).map((o: any) => o.numero);
    const notaOrdenes = `Factura consolidada de ${dto.orden_ids.length} órdenes: ${numeros.join(', ')}.`;

    // Reusar crear() con las líneas combinadas (sin orden_produccion_id → sin descuento global extra)
    const factura = await this.crear({
      tipo_ncf:        dto.tipo_ncf ?? TipoComprobante.PROFORMA,
      cliente_id:      dto.cliente_id,
      cliente_nombre:  cli?.nombre,
      cliente_rnc:     cli?.rnc,
      cliente_direccion: cli?.direccion,
      cliente_telefono:  cli?.telefono,
      metodo_pago:     dto.metodo_pago,
      fecha_vencimiento: dto.fecha_vencimiento,
      notas:           dto.notas ? `${dto.notas}\n${notaOrdenes}` : notaOrdenes,
      creado_por:      dto.creado_por,
      lineas,
    });

    // Enlazar todas las órdenes a la factura + trasladar anticipos de cada una
    if (factura?.id) {
      for (const oid of dto.orden_ids) {
        await this.ds.query(
          `INSERT IGNORE INTO factura_ordenes (factura_id, orden_id) VALUES (?, ?)`, [factura.id, oid]);
        await this.aplicarAnticiposOrden(factura.id, oid);
      }
      return this.findOne(factura.id);
    }
    return factura;
  }

  /** Traslada los anticipos pendientes de una orden a la nueva factura */
  private async aplicarAnticiposOrden(facturaId: number, ordenId: number): Promise<void> {
    try {
      const anticipos = await this.ds.query<any[]>(
        `SELECT * FROM recibos_ingreso
         WHERE orden_produccion_id = ? AND tipo = 'anticipo'
           AND (factura_id IS NULL OR factura_id = 0)`,
        [ordenId],
      );
      for (const a of anticipos) {
        const pago = this.pagoRepo.create({
          factura_id:     facturaId,
          tipo:           TipoPago.ANTICIPO,
          metodo:         (a.metodo as MetodoPago) ?? MetodoPago.EFECTIVO,
          monto:          Number(a.monto),
          fecha:          a.fecha,
          referencia:     a.referencia,
          nota:           `Anticipo trasladado de orden #${ordenId} — ${a.numero}`,
          creado_por:     a.creado_por ?? 'Sistema',
          sesion_caja_id: a.sesion_caja_id ?? null,
        } as any);
        await this.pagoRepo.save(pago);
        // Vincular el recibo existente a la factura (sin crear uno nuevo)
        await this.ds.query(
          `UPDATE recibos_ingreso SET factura_id = ? WHERE id = ?`,
          [facturaId, a.id],
        );
      }
      if (anticipos.length > 0) {
        await this.recalcularSaldo(facturaId);
      }
    } catch (e) {
      console.error('[FacturacionService] Error carry-forward anticipos:', e?.message);
    }
  }

  async actualizarEstado(id: number, estado: EstadoFactura, fecha_vencimiento?: string, usuario_rol?: string) {
    const rolesAutorizados = ['admin', 'supervisor'];
    const f = await this.facturaRepo.findOne({ where: { id }, relations: ['pagos'] });
    if (!f) throw new NotFoundException('Factura no encontrada');
    if (f.estado === EstadoFactura.ANULADA) throw new BadRequestException('La factura está anulada');

    // Bloque B-3: No se puede marcar como PAGADA manualmente
    if (estado === EstadoFactura.PAGADA) {
      throw new BadRequestException(
        'No se puede marcar una factura como pagada manualmente. Use el módulo de pagos.',
      );
    }

    // Bloque B-4: Anular requiere admin/supervisor y no puede tener pagos activos
    if (estado === EstadoFactura.ANULADA) {
      if (!rolesAutorizados.includes(usuario_rol ?? '')) {
        throw new ForbiddenException('Solo un administrador o supervisor puede anular facturas.');
      }
      const pagosActivos = (f.pagos ?? []).filter((p: any) => !p.revertido);
      if (pagosActivos.length > 0) {
        throw new BadRequestException(
          `Esta factura tiene ${pagosActivos.length} pago(s) activo(s). Reviértelos antes de anular.`,
        );
      }
    }

    await this.facturaRepo.update(id, { estado, ...(fecha_vencimiento ? { fecha_vencimiento } : {}) });
    const accion = estado === EstadoFactura.ANULADA
      ? AccionAuditoria.FACTURA_ANULADA
      : AccionAuditoria.FACTURA_ESTADO_CAMBIADO;
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.FACTURACION,
      accion,
      entidad_id:     id,
      entidad_numero: f.numero,
      usuario_rol:    usuario_rol ?? null,
      datos:          { estado_anterior: f.estado, estado_nuevo: estado },
      descripcion:    `Factura ${f.numero}: estado cambiado de "${f.estado}" a "${estado}"`,
    });
    return this.findOne(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGOS
  // ═══════════════════════════════════════════════════════════════════════════

  async registrarPago(facturaId: number, dto: {
    tipo: TipoPago;
    metodo: MetodoPago;
    monto: number;
    fecha: string;
    referencia?: string;
    banco_nombre?: string;
    cuenta_digitos?: string;
    cuenta_banco_id?: number;
    nota?: string;
    creado_por?: string;
  }) {
    const factura = await this.facturaRepo.findOne({ where: { id: facturaId } });
    if (!factura)                                throw new NotFoundException('Factura no encontrada');
    if (factura.estado === EstadoFactura.ANULADA) throw new BadRequestException('Factura anulada');
    if (factura.estado === EstadoFactura.PAGADA)  throw new BadRequestException('La factura ya está pagada');

    // Bloque B-5: monto debe ser positivo
    if (!dto.monto || dto.monto <= 0) {
      throw new BadRequestException('El monto del pago debe ser mayor a cero.');
    }
    // Bloque B-5: no exceder el saldo pendiente
    const saldoActual = Number(factura.saldo_pendiente);
    if (dto.monto > saldoActual + 0.01) {
      throw new BadRequestException(
        `El monto (RD$ ${dto.monto.toLocaleString()}) supera el saldo pendiente (RD$ ${saldoActual.toLocaleString()}). Use una Nota de Crédito para manejar el excedente.`,
      );
    }

    // Enlazar a la sesión de caja activa del cajero que registra el pago
    let sesion_caja_id: number | null = null;
    if (dto.creado_por) {
      const sesion = await this.cajaService.sesionActiva(dto.creado_por);
      sesion_caja_id = sesion?.id ?? null;
    }

    const pago = this.pagoRepo.create({
      ...dto,
      factura_id:      facturaId,
      banco_nombre:    dto.banco_nombre    ?? null,
      cuenta_digitos:  dto.cuenta_digitos  ?? null,
      cuenta_banco_id: dto.cuenta_banco_id ?? null,
      sesion_caja_id,
    });
    await this.pagoRepo.save(pago);
    await this.recalcularSaldo(facturaId);

    // ── Generar Recibo de Ingreso automáticamente ─────────────────────────
    const facturaActualizada = await this.facturaRepo.findOne({ where: { id: facturaId } });
    const tipoRecibo = facturaActualizada?.estado === EstadoFactura.PAGADA
      ? TipoRecibo.PAGO_TOTAL
      : TipoRecibo.ABONO;
    try {
      await this.recibosService.crear({
        tipo:                tipoRecibo,
        factura_id:          facturaId,
        factura_pago_id:     pago.id,
        orden_produccion_id: factura.orden_produccion_id ?? undefined,
        cliente_id:          factura.cliente_id ?? undefined,
        cliente_nombre:      factura.cliente_nombre,
        metodo:              dto.metodo,
        monto:               dto.monto,
        fecha:               dto.fecha,
        referencia:          dto.referencia,
        banco_nombre:        dto.banco_nombre,
        cuenta_digitos:      dto.cuenta_digitos,
        cuenta_banco_id:     dto.cuenta_banco_id,
        notas:               dto.nota,
        creado_por:          dto.creado_por,
      });
    } catch (e) {
      // No bloquear el pago si el recibo falla
      console.error('[RecibosService] Error al generar recibo:', e?.message);
    }

    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.FACTURACION,
      accion:         AccionAuditoria.PAGO_REGISTRADO,
      entidad_id:     facturaId,
      entidad_numero: factura.numero,
      usuario_nombre: dto.creado_por ?? null,
      monto:          dto.monto,
      datos: {
        metodo:     dto.metodo,
        tipo:       dto.tipo,
        referencia: dto.referencia ?? null,
      },
      descripcion: `Pago RD$ ${dto.monto} (${dto.metodo}) en factura ${factura.numero}`,
    });
    return this.findOne(facturaId);
  }

  async revertirPago(facturaId: number, pagoId: number, motivo: string, revertido_por?: string, usuario_rol?: string) {
    // Bloque B-1: solo admin/supervisor pueden revertir pagos
    const rolesAutorizados = ['admin', 'supervisor'];
    if (!rolesAutorizados.includes(usuario_rol ?? '')) {
      throw new ForbiddenException('Solo un administrador o supervisor puede revertir pagos.');
    }
    if (!motivo || motivo.trim().length < 5) {
      throw new BadRequestException('Debe indicar un motivo de reversión (mínimo 5 caracteres).');
    }

    const pago = await this.pagoRepo.findOne({ where: { id: pagoId, factura_id: facturaId } });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    if (pago.revertido) throw new BadRequestException('El pago ya fue revertido');
    await this.pagoRepo.update(pagoId, {
      revertido:        true,
      revertido_motivo: motivo,
      revertido_por:    revertido_por ?? null,
      revertido_en:     new Date(),
    });
    await this.recalcularSaldo(facturaId);
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.FACTURACION,
      accion:         AccionAuditoria.PAGO_REVERTIDO,
      entidad_id:     facturaId,
      usuario_nombre: revertido_por ?? null,
      usuario_rol:    usuario_rol   ?? null,
      monto:          Number(pago.monto),
      datos:          { pago_id: pagoId, motivo },
      descripcion:    `Pago #${pagoId} de RD$ ${pago.monto} revertido. Motivo: ${motivo}`,
    });
    return this.findOne(facturaId);
  }

  async validarPago(pagoId: number, validado_por: string) {
    const pago = await this.pagoRepo.findOne({ where: { id: pagoId } });
    if (!pago) throw new NotFoundException(`Pago #${pagoId} no encontrado`);
    await this.pagoRepo.update(pagoId, {
      validado:    true,
      validado_por,
      validado_en: new Date(),
    });
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.FACTURACION,
      accion:         AccionAuditoria.PAGO_REGISTRADO,
      entidad_id:     pago.factura_id,
      usuario_nombre: validado_por,
      monto:          Number(pago.monto),
      datos:          { pago_id: pagoId, accion: 'validar' },
      descripcion:    `Pago #${pagoId} de RD$ ${pago.monto} validado por ${validado_por}`,
    });
    return { ok: true };
  }

  async desvalidarPago(pagoId: number, desvalidado_por?: string) {
    const pago = await this.pagoRepo.findOne({ where: { id: pagoId } });
    if (!pago) throw new NotFoundException(`Pago #${pagoId} no encontrado`);
    await this.pagoRepo.update(pagoId, { validado: false, validado_por: null, validado_en: null });
    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.FACTURACION,
      accion:         AccionAuditoria.PAGO_REVERTIDO,
      entidad_id:     pago.factura_id,
      usuario_nombre: desvalidado_por ?? null,
      monto:          Number(pago.monto),
      datos:          { pago_id: pagoId, accion: 'desvalidar' },
      descripcion:    `Pago #${pagoId} de RD$ ${pago.monto} desvalidado`,
    });
    return { ok: true };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTAS DE CRÉDITO
  // ═══════════════════════════════════════════════════════════════════════════

  // Datos completos de una nota de crédito para su impresión (comprobante B04)
  async getNotaCredito(id: number) {
    const rows = await this.ds.query(`
      SELECT nc.*,
             f.numero AS factura_numero, f.cliente_direccion, f.cliente_telefono,
             f.orden_produccion_id, f.subtotal AS factura_subtotal, f.itbis AS factura_itbis, f.total AS factura_total
        FROM notas_credito nc
        JOIN facturas f ON f.id = nc.factura_id
       WHERE nc.id = ? LIMIT 1`, [id]);
    if (!rows.length) throw new NotFoundException('Nota de crédito no encontrada');
    const nc = rows[0];
    // Para NC total, mostramos las líneas de la factura acreditada
    const lineas = await this.ds.query(
      `SELECT id, descripcion, cantidad, precio_unitario, itbis_pct, itbis_monto, subtotal, total
         FROM factura_lineas WHERE factura_id = ? ORDER BY id`, [nc.factura_id]);
    return { ...nc, lineas };
  }

  async emitirNotaCredito(facturaId: number, dto: {
    tipo: TipoNotaCredito;
    motivo: MotivoNotaCredito;
    monto: number;
    itbis_monto?: number;
    notas?: string;
    creado_por?: string;
    usuario_rol?: string;
  }) {
    // Bloque B-2: solo admin/supervisor pueden emitir notas de crédito
    const rolesAutorizados = ['admin', 'supervisor'];
    if (!rolesAutorizados.includes(dto.usuario_rol ?? '')) {
      throw new ForbiddenException('Solo un administrador o supervisor puede emitir Notas de Crédito.');
    }
    // Bloque B-5: monto válido
    if (!dto.monto || dto.monto <= 0) {
      throw new BadRequestException('El monto de la Nota de Crédito debe ser mayor a cero.');
    }

    const factura = await this.facturaRepo.findOne({ where: { id: facturaId } });
    if (!factura) throw new NotFoundException('Factura no encontrada');
    if (!factura.ncf) throw new BadRequestException('Las Proformas no admiten Notas de Crédito');
    if (factura.estado === EstadoFactura.ANULADA) throw new BadRequestException('Factura anulada');

    // Bloque B-2: NC parcial no puede exceder el saldo pendiente
    if (dto.tipo !== TipoNotaCredito.TOTAL) {
      const saldoActual = Number(factura.saldo_pendiente);
      if (dto.monto > saldoActual + 0.01) {
        throw new BadRequestException(
          `El monto de la NC (RD$ ${dto.monto.toLocaleString()}) supera el saldo pendiente (RD$ ${saldoActual.toLocaleString()}).`,
        );
      }
    }

    const ncfNota = await this.siguienteNcf(TipoNcf.B04);
    const itbis   = dto.itbis_monto ?? 0;
    const total   = +(dto.monto + itbis).toFixed(2);

    const nc = this.ncRepo.create({
      ncf:            ncfNota,
      ncf_referencia: factura.ncf,
      factura_id:     facturaId,
      tipo:           dto.tipo,
      motivo:         dto.motivo,
      cliente_nombre: factura.cliente_nombre,
      cliente_rnc:    factura.cliente_rnc,
      monto:          dto.monto,
      itbis_monto:    itbis,
      total,
      notas:          dto.notas,
      creado_por:     dto.creado_por,
    });
    await this.ncRepo.save(nc);

    // Si es total → anular factura y dejar saldo en 0
    if (dto.tipo === TipoNotaCredito.TOTAL) {
      await this.facturaRepo.update(facturaId, {
        estado:          EstadoFactura.ANULADA,
        saldo_pendiente: 0,
      });
    } else {
      await this.recalcularSaldo(facturaId);
    }

    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.FACTURACION,
      accion:         AccionAuditoria.NOTA_CREDITO_EMITIDA,
      entidad_id:     facturaId,
      entidad_numero: factura.numero,
      usuario_nombre: dto.creado_por   ?? null,
      usuario_rol:    dto.usuario_rol  ?? null,
      monto:          total,
      datos: {
        ncf_nc:  ncfNota,
        tipo:    dto.tipo,
        motivo:  dto.motivo,
        notas:   dto.notas ?? null,
      },
      descripcion: `NC ${ncfNota} (${dto.tipo}) por RD$ ${total} en factura ${factura.numero}`,
    });
    return this.findOne(facturaId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT 606 (formato DGII)
  // ═══════════════════════════════════════════════════════════════════════════

  async export606(desde: string, hasta: string): Promise<string> {
    const tiposReportables = [TipoComprobante.B01, TipoComprobante.B02, TipoComprobante.B14, TipoComprobante.B15];
    // Cargar facturas con sus pagos activos para calcular método y fecha real de cobro
    const facturas = await this.facturaRepo
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.pagos', 'p', 'p.revertido = false OR p.revertido IS NULL')
      .where('f.tipo_ncf IN (:...tipos)', { tipos: tiposReportables })
      .andWhere('f.estado != :anulada', { anulada: EstadoFactura.ANULADA })
      .andWhere('DATE(f.fecha_emision) >= :desde', { desde })
      .andWhere('DATE(f.fecha_emision) <= :hasta', { hasta })
      .orderBy('f.fecha_emision', 'ASC')
      .getMany();

    // Formato DGII 606
    const header = 'RNC_CEDULA|TIPO_BIENES_SERVICIOS|NCF|NCF_MODIFICADO|FECHA_COMPROBANTE|FECHA_PAGO|MONTO_FACTURADO_SERVICIOS|MONTO_FACTURADO_BIENES|TOTAL_MONTO_FACTURADO|ITBIS_FACTURADO|ITBIS_RETENIDO|ITBIS_PERCIBIDO|ISR_RETENCION|MONTO_PROPINA_LEGAL|EFECTIVO|CHEQUE_TRANSFERENCIA|TARJETA_DEBITO_CREDITO|CREDITO|BONOS_CERTIFICADOS';

    const rows = facturas.map(f => {
      const rnc  = f.cliente_rnc ?? '';
      const tipo = '2'; // 2 = Servicios
      const fechaDoc = f.fecha_emision
        ? new Date(f.fecha_emision).toISOString().slice(0, 10).replace(/-/g, '')
        : '';

      // Fecha de pago = fecha del último pago real (no la fecha de emisión)
      const pagosActivos = (f.pagos ?? []).filter((p: any) => !p.revertido);
      const ultimoPago   = pagosActivos.sort((a: any, b: any) => b.id - a.id)[0];
      const fechaPago    = ultimoPago?.fecha?.replace(/-/g, '') ?? '';

      // Montos por método de pago (desde los registros reales de factura_pagos)
      const sum = (metodos: string[]) =>
        pagosActivos
          .filter((p: any) => metodos.includes(p.metodo))
          .reduce((s: number, p: any) => s + Number(p.monto), 0)
          .toFixed(2);

      const efectivo = sum(['efectivo']);
      const cheque   = sum(['transferencia', 'cheque']);
      const tarjeta  = sum(['tarjeta']);
      const credito  = sum(['credito']);

      return [
        rnc, tipo, f.ncf ?? '', '',
        fechaDoc, fechaPago,
        Number(f.subtotal).toFixed(2), '0.00',
        Number(f.total).toFixed(2),
        Number(f.itbis).toFixed(2),
        '0.00', '0.00', '0.00', '0.00',
        efectivo, cheque, tarjeta, credito, '0.00',
      ].join('|');
    });

    return [header, ...rows].join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORTE 607 — Comprobantes fiscales emitidos (DGII)
  // ═══════════════════════════════════════════════════════════════════════════

  async reporte607(mes: number, anio: number): Promise<string> {
    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const hasta = new Date(anio, mes, 0).toISOString().slice(0, 10); // último día del mes

    const tiposReportables = [TipoComprobante.B01, TipoComprobante.B02, TipoComprobante.B14, TipoComprobante.B15];
    const facturas = await this.facturaRepo
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.pagos', 'p', 'p.revertido = false OR p.revertido IS NULL')
      .where('f.tipo_ncf IN (:...tipos)', { tipos: tiposReportables })
      .andWhere('f.estado != :anulada', { anulada: EstadoFactura.ANULADA })
      .andWhere('DATE(f.fecha_emision) >= :desde', { desde })
      .andWhere('DATE(f.fecha_emision) <= :hasta', { hasta })
      .orderBy('f.ncf', 'ASC')
      .getMany();

    // Encabezado DGII 607
    const header = [
      'RNC_CEDULA_COMPRADOR',
      'TIPO_ID',
      'TIPO_BIENES_SERVICIOS',
      'NCF',
      'NCF_MODIFICADO',
      'TIPO_INGRESO',
      'FECHA_COMPROBANTE',
      'FECHA_COBRO',
      'MONTO_FACTURADO',
      'ITBIS_FACTURADO',
      'ITBIS_COBRADO',
      'MONTO_COBRADO_EFECTIVO',
      'MONTO_COBRADO_BANCO',
      'MONTO_COBRADO_TARJETA',
      'DESCUENTOS',
      'BONIFICACIONES',
      'TOTAL_MONTO_FACTURADO',
    ].join('|');

    const rows = facturas.map(f => {
      const rnc     = f.cliente_rnc ?? '';
      const tipoId  = rnc.length === 9 ? '2' : (rnc.length === 11 ? '1' : '3'); // 1=cédula, 2=RNC, 3=pasaporte
      const tipoBs  = '2'; // 2 = Servicios
      const tipoIng = '1'; // 1 = Ingresos por operaciones
      const fechaDoc = f.fecha_emision
        ? new Date(f.fecha_emision).toISOString().slice(0, 10).replace(/-/g, '')
        : '';

      // Fecha de cobro = fecha del último pago efectivo
      const pagosActivos = (f.pagos ?? []).filter((p: any) => !p.revertido);
      const ultimoPago   = pagosActivos.sort((a: any, b: any) => b.id - a.id)[0];
      const fechaCobro   = ultimoPago?.fecha?.replace(/-/g, '') ?? '';

      const totalPagado = pagosActivos.reduce((s: number, p: any) => s + Number(p.monto), 0);
      const efectivo    = pagosActivos.filter((p: any) => p.metodo === 'efectivo').reduce((s: number, p: any) => s + Number(p.monto), 0);
      const banco       = pagosActivos.filter((p: any) => ['transferencia', 'cheque'].includes(p.metodo)).reduce((s: number, p: any) => s + Number(p.monto), 0);
      const tarjeta     = pagosActivos.filter((p: any) => p.metodo === 'tarjeta').reduce((s: number, p: any) => s + Number(p.monto), 0);

      return [
        rnc,
        tipoId,
        tipoBs,
        f.ncf ?? '',
        '',          // NCF_MODIFICADO (nota de crédito referencia)
        tipoIng,
        fechaDoc,
        fechaCobro,
        Number(f.subtotal).toFixed(2),
        Number(f.itbis).toFixed(2),
        Number(f.itbis).toFixed(2),  // ITBIS cobrado
        efectivo.toFixed(2),
        banco.toFixed(2),
        tarjeta.toFixed(2),
        '0.00',      // Descuentos
        '0.00',      // Bonificaciones
        Number(f.total).toFixed(2),
      ].join('|');
    });

    return [header, ...rows].join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORTE 608 — Comprobantes anulados (DGII)
  // ═══════════════════════════════════════════════════════════════════════════

  async reporte608(mes: number, anio: number): Promise<string> {
    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const hasta = new Date(anio, mes, 0).toISOString().slice(0, 10);

    const facturas = await this.facturaRepo
      .createQueryBuilder('f')
      .where('f.estado = :anulada', { anulada: EstadoFactura.ANULADA })
      .andWhere('f.ncf IS NOT NULL')
      .andWhere('DATE(f.fecha_emision) >= :desde', { desde })
      .andWhere('DATE(f.fecha_emision) <= :hasta', { hasta })
      .orderBy('f.ncf', 'ASC')
      .getMany();

    // Encabezado DGII 608
    const header = 'TIPO_ANULACION|NCF|FECHA_COMPROBANTE|FECHA_ANULACION';

    const rows = facturas.map(f => {
      const fechaDoc = f.fecha_emision
        ? new Date(f.fecha_emision).toISOString().slice(0, 10).replace(/-/g, '')
        : '';
      const fechaAnul = f.actualizado_en
        ? new Date(f.actualizado_en).toISOString().slice(0, 10).replace(/-/g, '')
        : fechaDoc;

      return [
        '1',          // 1 = Anulación
        f.ncf ?? '',
        fechaDoc,
        fechaAnul,
      ].join('|');
    });

    return [header, ...rows].join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CUENTAS POR COBRAR (tabla plana + KPIs aging)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Días de crédito asumidos cuando la factura no tiene fecha_vencimiento */
  private static readonly PLAZO_CREDITO_DEFAULT_DIAS = 30;

  private enrichWithAging(f: Factura, hoy: Date) {
    let diasMora = 0;
    let bucket: 'al_dia' | '1_30' | '31_60' | '61_90' | 'mas_90' = 'al_dia';
    let semaforo: 'verde' | 'amarillo' | 'rojo' = 'verde';

    // Normaliza Date u string a 'YYYY-MM-DD' (en hora local, sin corrimiento UTC)
    const aYmd = (v: any): string | null => {
      if (!v) return null;
      if (v instanceof Date) {
        if (isNaN(v.getTime())) return null;
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
      }
      const s = String(v).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    };

    // Sin vencimiento explícito: se asume crédito estándar de 30 días desde la emisión
    let vencimiento: string | null = aYmd(f.fecha_vencimiento);
    let vencimientoAsumido = false;
    const emision = aYmd(f.fecha_emision);
    if (!vencimiento && emision) {
      const d = new Date(emision + 'T00:00:00');
      d.setDate(d.getDate() + FacturacionService.PLAZO_CREDITO_DEFAULT_DIAS);
      vencimiento = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      vencimientoAsumido = true;
    }

    if (vencimiento) {
      const venc  = new Date(vencimiento + 'T00:00:00');
      diasMora    = Math.floor((hoy.getTime() - venc.getTime()) / 86400000);
      if      (diasMora > 90) { bucket = 'mas_90'; semaforo = 'rojo';     }
      else if (diasMora > 60) { bucket = '61_90';  semaforo = 'rojo';     }
      else if (diasMora > 30) { bucket = '31_60';  semaforo = 'amarillo'; }
      else if (diasMora > 0)  { bucket = '1_30';   semaforo = 'amarillo'; }
      else if (diasMora >= -7){ bucket = 'al_dia';  semaforo = 'amarillo'; } // vence pronto
      else                    { bucket = 'al_dia';  semaforo = 'verde';    }
    }
    return { ...f, diasMora, bucket, semaforo, vencimiento_calculado: vencimiento, vencimiento_asumido: vencimientoAsumido };
  }

  async cuentasPorCobrar() {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    const facturas = await this.facturaRepo
      .createQueryBuilder('f')
      .where('f.saldo_pendiente > 0')
      // Las PROFORMA emitidas con saldo SÍ son deuda real (ventas a crédito sin
      // NCF) — entran a CxC. Los reportes fiscales (606/607) las excluyen aparte.
      .andWhere('f.estado NOT IN (:...excluidos)', { excluidos: [EstadoFactura.ANULADA, EstadoFactura.PAGADA] })
      .orderBy('f.fecha_vencimiento', 'ASC')
      .addOrderBy('f.cliente_nombre', 'ASC')
      .getMany();

    let enriquecidas: any[] = facturas.map(f => this.enrichWithAging(f, hoy));

    // Número de orden de producción para navegar factura → orden
    const ordenIds = [...new Set(enriquecidas.map(f => f.orden_produccion_id).filter(Boolean))];
    if (ordenIds.length) {
      const ordenes = await this.ds.query(
        `SELECT id, numero FROM ordenes_produccion WHERE id IN (${ordenIds.map(() => '?').join(',')})`,
        ordenIds);
      const porId = new Map(ordenes.map((o: any) => [Number(o.id), o.numero]));
      enriquecidas = enriquecidas.map(f => ({
        ...f,
        orden_numero: f.orden_produccion_id ? (porId.get(Number(f.orden_produccion_id)) ?? null) : null,
      }));
    }

    const kpis = {
      total_adeudado: +enriquecidas.reduce((s, f) => s + Number(f.saldo_pendiente), 0).toFixed(2),
      al_dia:  { count: 0, monto: 0 },
      '1_30':  { count: 0, monto: 0 },
      '31_60': { count: 0, monto: 0 },
      '61_90': { count: 0, monto: 0 },
      mas_90:  { count: 0, monto: 0 },
    } as Record<string, any>;

    for (const f of enriquecidas) {
      kpis[f.bucket].count++;
      kpis[f.bucket].monto = +( kpis[f.bucket].monto + Number(f.saldo_pendiente)).toFixed(2);
    }

    return { kpis, facturas: enriquecidas };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGO MASIVO — distribuye un monto entre varias facturas (oldest first)
  // ═══════════════════════════════════════════════════════════════════════════

  private static readonly LIMITE_PAGO_MASIVO_LIBRE = 50_000;

  async pagoMasivo(dto: {
    factura_ids: number[];
    monto: number;
    metodo: MetodoPago;
    fecha: string;
    referencia?: string;
    nota?: string;
    creado_por?: string;
    usuario_rol?: string;
  }) {
    // Bloque C-1: requiere sesión de caja propia del usuario que registra
    const sesionUsuario = await this.cajaService.sesionActiva(dto.creado_por ?? undefined);
    if (!sesionUsuario) {
      throw new BadRequestException(
        dto.creado_por
          ? `No tienes una sesión de caja abierta. Abre tu sesión antes de registrar cobros.`
          : 'No hay una sesión de caja abierta. Abre una sesión de caja antes de registrar cobros.',
      );
    }

    // Bloque B-5: monto positivo
    if (!dto.monto || dto.monto <= 0) {
      throw new BadRequestException('El monto del pago masivo debe ser mayor a cero.');
    }
    // Bloque B-6: montos grandes requieren admin/supervisor
    const rolesAutorizados = ['admin', 'supervisor'];
    if (
      dto.monto > FacturacionService.LIMITE_PAGO_MASIVO_LIBRE &&
      !rolesAutorizados.includes(dto.usuario_rol ?? '')
    ) {
      throw new ForbiddenException(
        `Los pagos masivos mayores a RD$ ${FacturacionService.LIMITE_PAGO_MASIVO_LIBRE.toLocaleString()} requieren autorización de administrador o supervisor.`,
      );
    }
    const facturas = await this.facturaRepo.find({ where: { id: In(dto.factura_ids) } });
    // Ordenar por vencimiento más antiguo primero
    facturas.sort((a, b) => {
      if (!a.fecha_vencimiento) return 1;
      if (!b.fecha_vencimiento) return -1;
      return a.fecha_vencimiento.localeCompare(b.fecha_vencimiento);
    });

    let restante = +dto.monto;
    const resultados: { factura_id: number; numero: string; aplicado: number }[] = [];

    for (const f of facturas) {
      if (restante <= 0) break;
      const saldo       = +Number(f.saldo_pendiente).toFixed(2);
      const aplicado    = +Math.min(restante, saldo).toFixed(2);
      await this.registrarPago(f.id, {
        tipo:       TipoPago.ABONO,
        metodo:     dto.metodo,
        monto:      aplicado,
        fecha:      dto.fecha,
        referencia: dto.referencia,
        nota:       dto.nota ?? `Pago masivo — ${dto.factura_ids.length} facturas`,
        creado_por: dto.creado_por,
      });
      restante = +(restante - aplicado).toFixed(2);
      resultados.push({ factura_id: f.id, numero: f.numero, aplicado });
    }

    await this.auditoria.registrar({
      modulo:         ModuloAuditoria.FACTURACION,
      accion:         AccionAuditoria.PAGO_MASIVO,
      usuario_nombre: dto.creado_por  ?? null,
      usuario_rol:    dto.usuario_rol ?? null,
      monto:          dto.monto,
      datos: {
        factura_ids: dto.factura_ids,
        metodo:      dto.metodo,
        referencia:  dto.referencia ?? null,
        resultados,
        restante,
      },
      descripcion: `Pago masivo RD$ ${dto.monto} distribuido en ${resultados.length} facturas`,
    });
    return { resultados, restante };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTADO DE CUENTA por cliente (Reportes)
  // ═══════════════════════════════════════════════════════════════════════════

  async estadoCuenta(clienteId: number, filtros?: { desde?: string; hasta?: string }) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    const qb = this.facturaRepo
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.pagos', 'p')
      .where('f.cliente_id = :cid', { cid: clienteId })
      .andWhere('f.estado != :anulada', { anulada: EstadoFactura.ANULADA })
      .orderBy('f.fecha_emision', 'ASC');

    if (filtros?.desde) qb.andWhere('DATE(f.fecha_emision) >= :desde', { desde: filtros.desde });
    if (filtros?.hasta) qb.andWhere('DATE(f.fecha_emision) <= :hasta', { hasta: filtros.hasta });

    const facturas    = await qb.getMany();
    const enriquecidas = facturas.map(f => this.enrichWithAging(f, hoy));

    // Info del cliente
    const [cliente] = await this.ds.query(
      `SELECT id, nombre, nombre_comercial, documento, telefono, email, direccion, ciudad
       FROM clientes WHERE id = ?`,
      [clienteId],
    ).catch(() => [null]);

    const resumen = {
      total_facturado:  +enriquecidas.reduce((s, f) => s + Number(f.total), 0).toFixed(2),
      total_pagado:     +enriquecidas.reduce((s, f) => s + Number(f.total_pagado), 0).toFixed(2),
      saldo_pendiente:  +enriquecidas.reduce((s, f) => s + Number(f.saldo_pendiente), 0).toFixed(2),
      al_dia:  enriquecidas.filter(f => f.bucket === 'al_dia').reduce((s, f) => s + Number(f.saldo_pendiente), 0),
      '1_30':  enriquecidas.filter(f => f.bucket === '1_30').reduce((s, f) => s + Number(f.saldo_pendiente), 0),
      '31_60': enriquecidas.filter(f => f.bucket === '31_60').reduce((s, f) => s + Number(f.saldo_pendiente), 0),
      '61_90': enriquecidas.filter(f => f.bucket === '61_90').reduce((s, f) => s + Number(f.saldo_pendiente), 0),
      mas_90:  enriquecidas.filter(f => f.bucket === 'mas_90').reduce((s, f) => s + Number(f.saldo_pendiente), 0),
    };

    return { cliente, facturas: enriquecidas, resumen };
  }
}
