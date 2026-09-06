import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';

/**
 * Servicio del portal del CONTADOR.
 * Genera reportes mensuales de DGII (606/607/608), resumen ITBIS,
 * listados de cobros/egresos. Diseñado para auto-servicio del despacho contable.
 */
@Injectable()
export class ContabilidadService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  // ─── Helpers ────────────────────────────────────────────────────────────
  private rangoMes(periodo: string): { desde: string; hasta: string } {
    // periodo formato YYYYMM
    if (!/^\d{6}$/.test(periodo)) {
      throw new BadRequestException('Período inválido. Formato esperado: YYYYMM');
    }
    const año = Number(periodo.slice(0, 4));
    const mes = Number(periodo.slice(4, 6));
    const desde = `${año}-${String(mes).padStart(2, '0')}-01`;
    const finDate = new Date(año, mes, 0); // último día del mes
    const hasta = `${año}-${String(mes).padStart(2, '0')}-${String(finDate.getDate()).padStart(2, '0')}`;
    return { desde, hasta };
  }

  private fmtDateDgii(fecha: string | Date | null): string {
    if (!fecha) return '';
    const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  private fmtNum(n: number | string | null | undefined, decimales = 2): string {
    const v = Number(n ?? 0);
    return v.toFixed(decimales);
  }

  // Detecta tipo identificación según formato del RNC/Cédula
  // 1 = RNC (9 dígitos), 2 = Cédula (11 dígitos), 3 = Pasaporte (alfanumérico)
  private tipoIdentificacion(rnc: string | null): string {
    if (!rnc) return '';
    const clean = rnc.replace(/[^0-9A-Za-z]/g, '');
    if (/^\d{9}$/.test(clean)) return '1';   // RNC
    if (/^\d{11}$/.test(clean)) return '2';  // Cédula
    return '3';                              // Pasaporte u otro
  }

  // Categoría → código DGII de bienes/servicios (01-12)
  private codigoBienesServicios(categoria: string | null): string {
    // Códigos DGII 606 'Tipo de Bienes y Servicios' (01-11) corregidos (parche del VPS portado el 6 sep 2026)
    const c = (categoria ?? '').toLowerCase().trim();
    if (c.includes('mercanc') || c.includes('inventario') || c.includes('materia prima') || c.includes('materia_prima') || c.includes('import')) return '09';
    if (c.includes('nomina') || c.includes('nómina') || c.includes('personal')) return '01';
    if (c.includes('alquiler') || c.includes('arrenda')) return '03';
    if (c.includes('activo') || c.includes('equipo')) return '04';
    if (c.includes('representac') || c.includes('comida')) return '05';
    if (c.includes('financ') || c.includes('banco') || c.includes('interes')) return '07';
    if (c.includes('seguro')) return '11';
    return '02';
  }

  // Mapeo método de pago → código DGII (01-07)
  private codigoFormaPago(metodo: string | null): string {
    const m = (metodo ?? '').toLowerCase();
    if (m === 'efectivo')                        return '01';
    if (m.includes('cheque') || m.includes('transferencia') || m.includes('deposito') || m.includes('depósito')) return '02';
    if (m.includes('tarjeta'))                   return '03';
    if (m.includes('credito') || m.includes('crédito')) return '04';
    if (m.includes('permuta'))                   return '05';
    return '07'; // Mixto / Otro
  }

  // ─── DASHBOARD del periodo ──────────────────────────────────────────────
  async dashboard(periodo: string) {
    const { desde, hasta } = this.rangoMes(periodo);

    // Ventas (facturas emitidas no anuladas)
    const ventas = await this.ds.query(
      `SELECT
         COUNT(*)                AS cantidad,
         COALESCE(SUM(subtotal),0) AS subtotal,
         COALESCE(SUM(itbis),0)    AS itbis,
         COALESCE(SUM(total),0)    AS total
       FROM facturas
       WHERE DATE(fecha_emision) BETWEEN ? AND ?
         AND tipo_ncf != 'PROFORMA'
         AND estado != 'anulada'`,
      [desde, hasta],
    );

    // Gastos formales (con NCF)
    const gastos = await this.ds.query(
      `SELECT
         COUNT(*)              AS cantidad,
         COALESCE(SUM(subtotal),0) AS subtotal,
         COALESCE(SUM(itbis),0)    AS itbis,
         COALESCE(SUM(monto),0)    AS total
       FROM gastos
       WHERE fecha BETWEEN ? AND ?
         AND tipo = 'formal'`,
      [desde, hasta],
    );

    // Anulados
    const anulados = await this.ds.query(
      `SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
       FROM facturas
       WHERE DATE(fecha_emision) BETWEEN ? AND ?
         AND estado = 'anulada'`,
      [desde, hasta],
    );

    // Cobros del periodo — SOLO los vinculados a facturas FORMALES (excluye proformas)
    // Los cobros de proformas y anticipos sin factura son contabilidad interna,
    // no entran en el reporte del contador (doble contabilidad).
    const cobros = await this.ds.query(
      `SELECT COUNT(*) AS cantidad, COALESCE(SUM(r.monto),0) AS total
       FROM recibos_ingreso r
       INNER JOIN facturas f ON f.id = r.factura_id
       WHERE r.fecha BETWEEN ? AND ?
         AND f.tipo_ncf != 'PROFORMA'
         AND f.ncf IS NOT NULL
         AND f.ncf != ''
         AND f.estado != 'anulada'`,
      [desde, hasta],
    );

    // Egresos del periodo
    const egresos = await this.ds.query(
      `SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto),0) AS total
       FROM egresos_caja
       WHERE fecha BETWEEN ? AND ?`,
      [desde, hasta],
    );

    // ITBIS deducible (gastos formales con NCF que da crédito fiscal)
    const itbisDeducible = await this.ds.query(
      `SELECT COALESCE(SUM(itbis),0) AS total
       FROM gastos
       WHERE fecha BETWEEN ? AND ?
         AND tipo = 'formal'
         AND tipo_ncf IN ('B01','B11','B15','E31','E44','E45')`,
      [desde, hasta],
    );
    // Compras del mes con NCF (todas las categorías) y pagos a proveedores (CxP)
    const comprasNcf = await this.ds.query("SELECT COUNT(*) AS cantidad, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(monto),0) AS total FROM gastos WHERE fecha BETWEEN ? AND ? AND ncf IS NOT NULL AND ncf != ''", [desde, hasta]);
    const abonosProv = await this.ds.query("SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto),0) AS total FROM cuentas_por_pagar_abonos WHERE fecha BETWEEN ? AND ?", [desde, hasta]);

    const itbisCobrado    = Number(ventas[0]?.itbis ?? 0);
    const itbisPagadoDed  = Number(itbisDeducible[0]?.total ?? 0);
    const itbisADepositar = Math.max(0, itbisCobrado - itbisPagadoDed);

    return {
      periodo,
      rango: { desde, hasta },
      ventas: {
        cantidad: Number(ventas[0]?.cantidad ?? 0),
        subtotal: Number(ventas[0]?.subtotal ?? 0),
        itbis:    itbisCobrado,
        total:    Number(ventas[0]?.total ?? 0),
      },
      gastos_formales: {
        cantidad: Number(gastos[0]?.cantidad ?? 0),
        subtotal: Number(gastos[0]?.subtotal ?? 0),
        itbis:    Number(gastos[0]?.itbis ?? 0),
        total:    Number(gastos[0]?.total ?? 0),
      },
      compras_ncf: {
        cantidad: Number(comprasNcf[0]?.cantidad ?? 0),
        subtotal: Number(comprasNcf[0]?.subtotal ?? 0),
        total:    Number(comprasNcf[0]?.total ?? 0),
      },
      pagos_proveedores: {
        cantidad: Number(abonosProv[0]?.cantidad ?? 0),
        total:    Number(abonosProv[0]?.total ?? 0),
      },
      anulados: {
        cantidad: Number(anulados[0]?.cantidad ?? 0),
        total:    Number(anulados[0]?.total ?? 0),
      },
      cobros: {
        cantidad: Number(cobros[0]?.cantidad ?? 0),
        total:    Number(cobros[0]?.total ?? 0),
      },
      egresos: {
        cantidad: Number(egresos[0]?.cantidad ?? 0),
        total:    Number(egresos[0]?.total ?? 0),
      },
      itbis: {
        cobrado:        itbisCobrado,
        pagado_deducible: itbisPagadoDed,
        a_depositar:    itbisADepositar,
      },
    };
  }

  // ─── 606 — COMPRAS (gastos formales con NCF) ───────────────────────────
  async generar606(periodo: string, formato: 'dgii' | 'json' = 'dgii') {
    const { desde, hasta } = this.rangoMes(periodo);

    const rnc = process.env.EMPRESA_RNC || '';

    const filas: any[] = await this.ds.query(
      `SELECT
         id, rnc, ncf, tipo_ncf, fecha,
         proveedor,
         COALESCE(subtotal, monto - COALESCE(itbis,0)) AS subtotal,
         COALESCE(itbis, 0) AS itbis,
         monto AS total,
         categoria,
         metodo_pago,
         foto_url,
         fotos_adicionales,
         descripcion
       FROM gastos
       WHERE fecha BETWEEN ? AND ?
         AND tipo = 'formal'
         AND ncf IS NOT NULL
         AND ncf != ''
       ORDER BY fecha, id`,
      [desde, hasta],
    );

    const registros = filas.map((g) => ({
      rnc:                  g.rnc ?? '',
      tipo_id:              this.tipoIdentificacion(g.rnc),
      tipo_bienes_servicios: this.codigoBienesServicios(g.categoria),
      ncf:                  (g.ncf ?? '').toUpperCase(),
      ncf_modificado:       '',
      fecha_comprobante:    this.fmtDateDgii(g.fecha),
      fecha_pago:           this.fmtDateDgii(g.fecha), // por defecto = fecha comprobante
      monto_servicios:      ['04','09','10'].includes(this.codigoBienesServicios(g.categoria)) ? '0.00' : this.fmtNum(g.subtotal),
      monto_bienes:         ['04','09','10'].includes(this.codigoBienesServicios(g.categoria)) ? this.fmtNum(g.subtotal) : '0.00',
      total_facturado:      this.fmtNum(g.total),
      itbis_facturado:      this.fmtNum(g.itbis),
      itbis_retenido:       '0.00',
      itbis_proporcionalidad: '0.00',
      itbis_costo:          '0.00',
      itbis_adelantar:      ['B01','B11','B15','E31','E44','E45'].includes(g.tipo_ncf) || (g.ncf ?? '').match(/^E(31|44|45)/) ? this.fmtNum(g.itbis) : '0.00',
      itbis_percibido:      '0.00',
      tipo_retencion_isr:   '',
      monto_retencion_renta:'0.00',
      isr_percibido:        '0.00',
      isc:                  '0.00',
      otros_impuestos:      '0.00',
      propina_legal:        '0.00',
      forma_pago:           this.codigoFormaPago(g.metodo_pago || 'efectivo'),
      // metadata extra (no va en DGII pero útil para Excel y banco de comprobantes)
      _id:                  g.id,
      _proveedor:           g.proveedor,
      _categoria:           g.categoria,
      _descripcion:         g.descripcion,
      _foto_url:            g.foto_url,
      _fotos_adicionales:   typeof g.fotos_adicionales === 'string'
        ? (() => { try { return JSON.parse(g.fotos_adicionales); } catch { return null; } })()
        : g.fotos_adicionales,
    }));

    if (formato === 'json') return { periodo, rango: { desde, hasta }, rnc, registros };

    // Formato DGII oficial: pipe-separated, primera línea es header
    const header = `606|${rnc}|${periodo}|${registros.length}`;
    const lineas = registros.map(r => [
      r.rnc, r.tipo_id, r.tipo_bienes_servicios, r.ncf, r.ncf_modificado,
      r.fecha_comprobante, r.fecha_pago, r.monto_servicios, r.monto_bienes,
      r.total_facturado, r.itbis_facturado, r.itbis_retenido,
      r.itbis_proporcionalidad, r.itbis_costo, r.itbis_adelantar, r.itbis_percibido,
      r.tipo_retencion_isr, r.monto_retencion_renta, r.isr_percibido,
      r.isc, r.otros_impuestos, r.propina_legal, r.forma_pago,
    ].join('|'));

    return { texto: [header, ...lineas].join('\n'), cantidad: registros.length };
  }

  // ─── 607 — VENTAS (facturas emitidas no anuladas, con NCF) ─────────────
  async generar607(periodo: string, formato: 'dgii' | 'json' = 'dgii') {
    const { desde, hasta } = this.rangoMes(periodo);
    const rnc = process.env.EMPRESA_RNC || '';

    const filas: any[] = await this.ds.query(
      `SELECT
         id, numero, ncf, tipo_ncf, cliente_rnc, cliente_nombre,
         subtotal, itbis, total, metodo_pago,
         DATE(fecha_emision) AS fecha
       FROM facturas
       WHERE DATE(fecha_emision) BETWEEN ? AND ?
         AND estado != 'anulada'
         AND tipo_ncf != 'PROFORMA'
         AND ncf IS NOT NULL
         AND ncf != ''
       ORDER BY fecha_emision, id`,
      [desde, hasta],
    );

    const registros = filas.map((f) => {
      // Tipo de ingreso: 01 = operaciones (default para venta normal)
      const tipoIngreso = '01';
      // Forma de venta — 607 desglosa por columna (efectivo, cheque, tarjeta, crédito...)
      const metodo = (f.metodo_pago ?? '').toLowerCase();
      const monto  = Number(f.total ?? 0);
      const efectivo      = metodo === 'efectivo'      ? monto : 0;
      const cheque_transf = (metodo.includes('cheque') || metodo.includes('transferencia') || metodo.includes('deposito') || metodo.includes('depósito')) ? monto : 0;
      const tarjeta       = metodo.includes('tarjeta') ? monto : 0;
      const venta_credito = (metodo.includes('credito') || metodo.includes('crédito')) ? monto : 0;

      return {
        rnc:                  f.cliente_rnc ?? '',
        tipo_id:              this.tipoIdentificacion(f.cliente_rnc),
        ncf:                  (f.ncf ?? '').toUpperCase(),
        ncf_modificado:       '',
        tipo_ingreso:         tipoIngreso,
        fecha_comprobante:    this.fmtDateDgii(f.fecha),
        fecha_retencion:      '',
        monto_facturado:      this.fmtNum(f.subtotal),
        itbis_facturado:      this.fmtNum(f.itbis),
        itbis_retenido_terc:  '0.00',
        itbis_percibido:      '0.00',
        retencion_renta_terc: '0.00',
        isr_percibido:        '0.00',
        isc:                  '0.00',
        otros_impuestos:      '0.00',
        propina_legal:        '0.00',
        efectivo:             this.fmtNum(efectivo),
        cheque_transferencia: this.fmtNum(cheque_transf),
        tarjeta:              this.fmtNum(tarjeta),
        venta_credito:        this.fmtNum(venta_credito),
        bonos:                '0.00',
        permuta:              '0.00',
        otras_formas:         '0.00',
        _cliente:             f.cliente_nombre,
        _numero:              f.numero,
      };
    });

    if (formato === 'json') return { periodo, rango: { desde, hasta }, rnc, registros };

    const header = `607|${rnc}|${periodo}|${registros.length}`;
    const lineas = registros.map(r => [
      r.rnc, r.tipo_id, r.ncf, r.ncf_modificado, r.tipo_ingreso,
      r.fecha_comprobante, r.fecha_retencion, r.monto_facturado, r.itbis_facturado,
      r.itbis_retenido_terc, r.itbis_percibido, r.retencion_renta_terc, r.isr_percibido,
      r.isc, r.otros_impuestos, r.propina_legal,
      r.efectivo, r.cheque_transferencia, r.tarjeta, r.venta_credito,
      r.bonos, r.permuta, r.otras_formas,
    ].join('|'));

    return { texto: [header, ...lineas].join('\n'), cantidad: registros.length };
  }

  // ─── 608 — NCF ANULADOS ─────────────────────────────────────────────────
  async generar608(periodo: string, formato: 'dgii' | 'json' = 'dgii') {
    const { desde, hasta } = this.rangoMes(periodo);
    const rnc = process.env.EMPRESA_RNC || '';

    const filas: any[] = await this.ds.query(
      `SELECT ncf, DATE(actualizado_en) AS fecha_anulacion
       FROM facturas
       WHERE estado = 'anulada'
         AND DATE(actualizado_en) BETWEEN ? AND ?
         AND ncf IS NOT NULL AND ncf != ''
       ORDER BY actualizado_en, id`,
      [desde, hasta],
    );

    const registros = filas.map((f) => ({
      ncf:               (f.ncf ?? '').toUpperCase(),
      fecha_comprobante: this.fmtDateDgii(f.fecha_anulacion),
      tipo_anulacion:    '02', // 02 = errores de impresión (default más común)
    }));

    if (formato === 'json') return { periodo, rango: { desde, hasta }, rnc, registros };

    const header = `608|${rnc}|${periodo}|${registros.length}`;
    const lineas = registros.map(r => [r.ncf, r.fecha_comprobante, r.tipo_anulacion].join('|'));

    return { texto: [header, ...lineas].join('\n'), cantidad: registros.length };
  }

  // ─── COBROS del periodo (SOLO de facturas formales con NCF) ────────────
  // Excluye cobros de proformas y anticipos sin factura — esos son
  // contabilidad interna, no entran en el reporte del contador.
  async listarCobros(periodo: string) {
    const { desde, hasta } = this.rangoMes(periodo);
    const rows: any[] = await this.ds.query(
      `SELECT
         r.numero, r.tipo, r.fecha, r.monto, r.metodo, r.referencia,
         r.cliente_nombre,
         f.numero AS factura_numero, f.ncf AS factura_ncf, f.tipo_ncf
       FROM recibos_ingreso r
       INNER JOIN facturas f ON f.id = r.factura_id
       WHERE r.fecha BETWEEN ? AND ?
         AND f.tipo_ncf != 'PROFORMA'
         AND f.ncf IS NOT NULL
         AND f.ncf != ''
         AND f.estado != 'anulada'
       ORDER BY r.fecha, r.id`,
      [desde, hasta],
    );
    return { periodo, rango: { desde, hasta }, cantidad: rows.length, registros: rows };
  }

  // ─── EGRESOS del periodo ────────────────────────────────────────────────
  async listarEgresos(periodo: string) {
    const { desde, hasta } = this.rangoMes(periodo);
    const rows: any[] = await this.ds.query(
      `SELECT id, fecha, monto, destinatario, categoria, comentario, registrado_por
       FROM egresos_caja
       WHERE fecha BETWEEN ? AND ?
       ORDER BY fecha, id`,
      [desde, hasta],
    );
    return { periodo, rango: { desde, hasta }, cantidad: rows.length, registros: rows };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXCEL: reporte mensual completo (.xlsx con múltiples hojas)
  // ─────────────────────────────────────────────────────────────────────────
  async generarExcelMensual(periodo: string): Promise<Buffer> {
    const { desde, hasta } = this.rangoMes(periodo);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ERP E-Tex 360';
    wb.created = new Date();

    // Cargar datos
    const [r606, r607, r608, dash, cobros, egresos] = await Promise.all([
      this.generar606(periodo, 'json') as Promise<any>,
      this.generar607(periodo, 'json') as Promise<any>,
      this.generar608(periodo, 'json') as Promise<any>,
      this.dashboard(periodo),
      this.listarCobros(periodo),
      this.listarEgresos(periodo),
    ]);

    // ── HOJA 0: Resumen ──────────────────────────────────────────────────
    const wsResumen = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: 'FF1E3A8A' } } });
    this.estiloHoja(wsResumen);
    wsResumen.columns = [
      { header: 'Concepto', key: 'concepto', width: 35 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Monto',    key: 'monto',    width: 20, style: { numFmt: '"RD$" #,##0.00' } },
    ];
    this.estiloHeader(wsResumen, 3);
    wsResumen.addRows([
      { concepto: `RESUMEN MENSUAL — ${this.periodoLabel(periodo)}`, cantidad: '', monto: '' },
      { concepto: '', cantidad: '', monto: '' },
      { concepto: 'VENTAS (facturas con NCF)',     cantidad: dash.ventas.cantidad,          monto: dash.ventas.total },
      { concepto: '  Subtotal de ventas',           cantidad: '',                            monto: dash.ventas.subtotal },
      { concepto: '  ITBIS cobrado',                cantidad: '',                            monto: dash.itbis.cobrado },
      { concepto: '', cantidad: '', monto: '' },
      { concepto: 'COMPRAS DEL MES (con NCF)',     cantidad: dash.compras_ncf.cantidad,     monto: dash.compras_ncf.total },
      { concepto: '  Subtotal de compras',          cantidad: '',                            monto: dash.compras_ncf.subtotal },
      { concepto: '  ITBIS deducible (B01/B11/B15)', cantidad: '',                          monto: dash.itbis.pagado_deducible },
      { concepto: '', cantidad: '', monto: '' },
      { concepto: 'ITBIS A DEPOSITAR (cobrado − deducible)', cantidad: '',                  monto: dash.itbis.a_depositar },
      { concepto: '', cantidad: '', monto: '' },
      { concepto: 'Cobros recibidos',               cantidad: dash.cobros.cantidad,          monto: dash.cobros.total },
      { concepto: 'PAGOS REALIZADOS (proveedores + caja chica)', cantidad: dash.pagos_proveedores.cantidad + dash.egresos.cantidad, monto: dash.pagos_proveedores.total + dash.egresos.total },
      { concepto: 'NCF anulados',                   cantidad: dash.anulados.cantidad,        monto: dash.anulados.total },
    ]);
    // Estilo destacado para fila ITBIS a depositar
    const filaItbis = wsResumen.getRow(13);
    filaItbis.font = { bold: true, color: { argb: 'FFB91C1C' }, size: 12 };
    filaItbis.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    // Título principal en negrita grande
    const filaTitulo = wsResumen.getRow(2);
    filaTitulo.font = { bold: true, size: 14, color: { argb: 'FF1E3A8A' } };

    // ── HOJA 1: 606 Compras ──────────────────────────────────────────────
    const ws606 = wb.addWorksheet('606 Compras', { properties: { tabColor: { argb: 'FF3B82F6' } } });
    ws606.columns = [
      { header: 'Proveedor',          key: 'proveedor',       width: 32 },
      { header: 'RNC/Cédula',         key: 'rnc',             width: 13 },
      { header: 'Tipo ID',            key: 'tipo_id',         width: 8 },
      { header: 'Cód. Bienes/Serv.',  key: 'tipo_bs',         width: 10 },
      { header: 'NCF',                key: 'ncf',             width: 18 },
      { header: 'NCF Modificado',     key: 'ncf_mod',         width: 16 },
      { header: 'Fecha Comprob.',     key: 'fecha_comp',      width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Fecha Pago',         key: 'fecha_pago',      width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Monto Servicios',    key: 'monto_serv',      width: 16, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'Monto Bienes',       key: 'monto_bienes',    width: 16, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'Total Facturado',    key: 'total',           width: 16, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'ITBIS Facturado',    key: 'itbis',           width: 15, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'ITBIS Retenido',     key: 'itbis_ret',       width: 15, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'ITBIS Adelantar',    key: 'itbis_adel',      width: 15, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'Forma Pago',         key: 'forma_pago',      width: 10 },
      { header: 'Categoría',          key: 'categoria',       width: 18 },
      { header: 'Descripción',        key: 'descripcion',     width: 30 },
      { header: 'Ver factura',        key: 'foto',            width: 14 },
    ];
    this.estiloHeader(ws606, ws606.columns.length);
    r606.registros.forEach((r: any) => {
      const row = ws606.addRow({
        rnc:          r.rnc,
        tipo_id:      r.tipo_id,
        tipo_bs:      r.tipo_bienes_servicios,
        ncf:          r.ncf,
        ncf_mod:      r.ncf_modificado || '',
        fecha_comp:   this.parseDateDgii(r.fecha_comprobante),
        fecha_pago:   this.parseDateDgii(r.fecha_pago),
        monto_serv:   Number(r.monto_servicios),
        monto_bienes: Number(r.monto_bienes),
        total:        Number(r.total_facturado),
        itbis:        Number(r.itbis_facturado),
        itbis_ret:    Number(r.itbis_retenido),
        itbis_adel:   Number(r.itbis_adelantar),
        forma_pago:   r.forma_pago,
        proveedor:    r._proveedor,
        categoria:    r._categoria,
        descripcion:  r._descripcion,
        foto:         r._foto_url ? { text: '📷 Ver', hyperlink: r._foto_url } : '',
      });
      if (r._foto_url) {
        row.getCell('foto').font = { color: { argb: 'FF1E3A8A' }, underline: true };
      }
    });
    // Fila de totales
    if (r606.registros.length > 0) {
      const totalRow = ws606.addRow({
        rnc: 'TOTALES', tipo_id: '', tipo_bs: '', ncf: '', ncf_mod: '',
        fecha_comp: '', fecha_pago: '',
        monto_serv:   { formula: `SUM(I2:I${r606.registros.length + 1})` },
        monto_bienes: { formula: `SUM(J2:J${r606.registros.length + 1})` },
        total:        { formula: `SUM(K2:K${r606.registros.length + 1})` },
        itbis:        { formula: `SUM(L2:L${r606.registros.length + 1})` },
        itbis_ret:    { formula: `SUM(M2:M${r606.registros.length + 1})` },
        itbis_adel:   { formula: `SUM(N2:N${r606.registros.length + 1})` },
      });
      totalRow.font = { bold: true };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    }
    ws606.autoFilter = { from: 'A1', to: { row: 1, column: ws606.columns.length } };
    ws606.views = [{ state: 'frozen', ySplit: 1 }];

    // ── HOJA 2: 607 Ventas ───────────────────────────────────────────────
    const ws607 = wb.addWorksheet('607 Ventas', { properties: { tabColor: { argb: 'FF10B981' } } });
    ws607.columns = [
      { header: 'No. Factura',        key: 'numero',       width: 16 },
      { header: 'Cliente',            key: 'cliente',      width: 32 },
      { header: 'RNC/Cédula',         key: 'rnc',          width: 13 },
      { header: 'Tipo ID',            key: 'tipo_id',      width: 8 },
      { header: 'NCF',                key: 'ncf',          width: 18 },
      { header: 'Tipo Ingreso',       key: 'tipo_ing',     width: 11 },
      { header: 'Fecha Comprob.',     key: 'fecha_comp',   width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Monto Facturado',    key: 'monto',        width: 16, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'ITBIS Facturado',    key: 'itbis',        width: 15, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'Efectivo',           key: 'efectivo',     width: 14, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'Cheque/Transfer.',   key: 'cheque',       width: 16, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'Tarjeta',            key: 'tarjeta',      width: 14, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'Venta Crédito',      key: 'credito',      width: 14, style: { numFmt: '"RD$" #,##0.00' } },
    ];
    this.estiloHeader(ws607, ws607.columns.length);
    r607.registros.forEach((r: any) => {
      ws607.addRow({
        rnc:        r.rnc,
        tipo_id:    r.tipo_id,
        ncf:        r.ncf,
        tipo_ing:   r.tipo_ingreso,
        fecha_comp: this.parseDateDgii(r.fecha_comprobante),
        monto:      Number(r.monto_facturado),
        itbis:      Number(r.itbis_facturado),
        efectivo:   Number(r.efectivo),
        cheque:     Number(r.cheque_transferencia),
        tarjeta:    Number(r.tarjeta),
        credito:    Number(r.venta_credito),
        cliente:    r._cliente,
        numero:     r._numero,
      });
    });
    if (r607.registros.length > 0) {
      const totalRow = ws607.addRow({
        rnc: 'TOTALES', tipo_id: '', ncf: '', tipo_ing: '', fecha_comp: '',
        monto:    { formula: `SUM(H2:H${r607.registros.length + 1})` },
        itbis:    { formula: `SUM(I2:I${r607.registros.length + 1})` },
        efectivo: { formula: `SUM(J2:J${r607.registros.length + 1})` },
        cheque:   { formula: `SUM(K2:K${r607.registros.length + 1})` },
        tarjeta:  { formula: `SUM(L2:L${r607.registros.length + 1})` },
        credito:  { formula: `SUM(M2:M${r607.registros.length + 1})` },
      });
      totalRow.font = { bold: true };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    }
    ws607.autoFilter = { from: 'A1', to: { row: 1, column: ws607.columns.length } };
    ws607.views = [{ state: 'frozen', ySplit: 1 }];

    // ── HOJA 3: 608 Anulados ────────────────────────────────────────────
    const ws608 = wb.addWorksheet('608 Anulados', { properties: { tabColor: { argb: 'FF6B7280' } } });
    ws608.columns = [
      { header: 'NCF',                key: 'ncf',           width: 18 },
      { header: 'Fecha Anulación',    key: 'fecha',         width: 16, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Tipo Anulación',     key: 'tipo',          width: 14 },
    ];
    this.estiloHeader(ws608, 3);
    r608.registros.forEach((r: any) => {
      ws608.addRow({
        ncf:   r.ncf,
        fecha: this.parseDateDgii(r.fecha_comprobante),
        tipo:  r.tipo_anulacion,
      });
    });
    ws608.autoFilter = { from: 'A1', to: { row: 1, column: 3 } };
    ws608.views = [{ state: 'frozen', ySplit: 1 }];

    // ── HOJA 4: Cobros ──────────────────────────────────────────────────
    const wsCobros = wb.addWorksheet('Cobros', { properties: { tabColor: { argb: 'FF10B981' } } });
    wsCobros.columns = [
      { header: 'Fecha',          key: 'fecha',          width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: '# Recibo',       key: 'numero',         width: 14 },
      { header: 'Tipo',           key: 'tipo',           width: 12 },
      { header: 'Cliente',        key: 'cliente',        width: 30 },
      { header: 'Factura',        key: 'factura_num',    width: 14 },
      { header: 'NCF Factura',    key: 'factura_ncf',    width: 16 },
      { header: 'Método',         key: 'metodo',         width: 14 },
      { header: 'Monto',          key: 'monto',          width: 16, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'Referencia',     key: 'referencia',     width: 18 },
    ];
    this.estiloHeader(wsCobros, wsCobros.columns.length);
    cobros.registros.forEach((c: any) => {
      wsCobros.addRow({
        fecha:        c.fecha ? new Date(c.fecha) : null,
        numero:       c.numero,
        tipo:         c.tipo,
        cliente:      c.cliente_nombre,
        factura_num:  c.factura_numero,
        factura_ncf:  c.factura_ncf,
        metodo:       c.metodo,
        monto:        Number(c.monto),
        referencia:   c.referencia,
      });
    });
    if (cobros.registros.length > 0) {
      const totalRow = wsCobros.addRow({
        fecha: '', numero: '', tipo: '', cliente: 'TOTAL',
        factura_num: '', factura_ncf: '', metodo: '',
        monto: { formula: `SUM(H2:H${cobros.registros.length + 1})` },
      });
      totalRow.font = { bold: true };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    }
    wsCobros.autoFilter = { from: 'A1', to: { row: 1, column: wsCobros.columns.length } };
    wsCobros.views = [{ state: 'frozen', ySplit: 1 }];

    // ── HOJA 5: Egresos ─────────────────────────────────────────────────
    const wsEgresos = wb.addWorksheet('Egresos', { properties: { tabColor: { argb: 'FFEF4444' } } });
    wsEgresos.columns = [
      { header: 'Fecha',          key: 'fecha',          width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Destinatario',   key: 'destinatario',   width: 30 },
      { header: 'Categoría',      key: 'categoria',      width: 16 },
      { header: 'Monto',          key: 'monto',          width: 16, style: { numFmt: '"RD$" #,##0.00' } },
      { header: 'Comentario',     key: 'comentario',     width: 40 },
      { header: 'Registrado por', key: 'registrado_por', width: 18 },
    ];
    this.estiloHeader(wsEgresos, wsEgresos.columns.length);
    egresos.registros.forEach((e: any) => {
      wsEgresos.addRow({
        fecha:         e.fecha ? new Date(e.fecha) : null,
        destinatario:  e.destinatario,
        categoria:     e.categoria,
        monto:         Number(e.monto),
        comentario:    e.comentario,
        registrado_por: e.registrado_por,
      });
    });
    if (egresos.registros.length > 0) {
      const totalRow = wsEgresos.addRow({
        fecha: '', destinatario: 'TOTAL', categoria: '',
        monto: { formula: `SUM(D2:D${egresos.registros.length + 1})` },
      });
      totalRow.font = { bold: true };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    }
    wsEgresos.autoFilter = { from: 'A1', to: { row: 1, column: wsEgresos.columns.length } };
    wsEgresos.views = [{ state: 'frozen', ySplit: 1 }];

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ─── Helpers Excel ──────────────────────────────────────────────────────
  private estiloHoja(ws: ExcelJS.Worksheet) {
    ws.properties.defaultRowHeight = 18;
  }

  private estiloHeader(ws: ExcelJS.Worksheet, cantidadColumnas: number) {
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    header.alignment = { horizontal: 'center', vertical: 'middle' };
    header.height = 22;
    for (let i = 1; i <= cantidadColumnas; i++) {
      header.getCell(i).border = {
        top:    { style: 'thin', color: { argb: 'FFFFFFFF' } },
        bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
        left:   { style: 'thin', color: { argb: 'FFFFFFFF' } },
        right:  { style: 'thin', color: { argb: 'FFFFFFFF' } },
      };
    }
  }

  private parseDateDgii(s: string | null | undefined): Date | string {
    if (!s || s.length !== 8) return '';
    const año = Number(s.slice(0, 4));
    const mes = Number(s.slice(4, 6)) - 1;
    const dia = Number(s.slice(6, 8));
    const d = new Date(año, mes, dia);
    return isNaN(d.getTime()) ? '' : d;
  }

  private periodoLabel(p: string): string {
    if (!/^\d{6}$/.test(p)) return p;
    const año = p.slice(0, 4);
    const mes = Number(p.slice(4, 6));
    const meses = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${meses[mes]} ${año}`;
  }
}
