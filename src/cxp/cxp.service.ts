import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

function _upper(v: any): any {
  if (v == null) return v;
  if (typeof v !== 'string') return v;
  return v.toUpperCase();
}

/**
 * Deriva el tipo_ncf desde el NCF para que el gasto entre correctamente al 606
 * y al cálculo de ITBIS deducible. Soporta B-series y e-CF (E31, E32, etc).
 */
function tipoNcfDesde(ncf: string | null | undefined): string | null {
  if (!ncf) return null;
  const m = String(ncf).toUpperCase().match(/^(B\d{2}|E\d{2})/);
  return m ? m[1] : null;
}

// Reglas de categorizacion automatica por palabras clave del proveedor/descripcion
const REGLAS_CATEGORIA: Array<{ palabras: string[]; cat: string }> = [
  { palabras: ['EDEESTE', 'EDENORTE', 'EDESUR', 'LUZ', 'ELECTRICIDAD', 'ENERGIA'], cat: 'servicios' },
  { palabras: ['CLARO', 'ALTICE', 'VIVA', 'INTERNET', 'WIFI', 'TELEFONO', 'CELULAR'], cat: 'tecnologia' },
  { palabras: ['ALQUILER', 'RENTA', 'LOCAL'], cat: 'alquiler' },
  { palabras: ['NOMINA', 'SUELDO', 'EMPLEADO'], cat: 'nomina' },
  { palabras: ['MANTENIMIENTO'], cat: 'mantenimiento' },
  { palabras: ['IMPUESTO', 'DGII', 'ITBIS', 'ISR'], cat: 'impuestos' },
  { palabras: ['BANCO', 'PRESTAMO', 'CUOTA'], cat: 'prestamos' },
  { palabras: ['TINTA', 'PAPEL', 'TONER', 'PAPELERIA'], cat: 'mantenimiento' },
  { palabras: ['HILO', 'TELA', 'BORDADO', 'BORDAR', 'BOTON', 'COSER', 'HILAZA', 'FIBRA', 'TEJIDO', 'TEXTIL', 'PLANETA'], cat: 'materia_prima' },
  { palabras: ['MAQUINA', 'REPARACION', 'REPARAR'], cat: 'mantenimiento' },
  { palabras: ['FLETE', 'TRANSPORTE', 'COURIER', 'CARGA'], cat: 'servicios' },
];

function categorizar(proveedor: string | null | undefined, descripcion: string | null | undefined): string {
  const texto = ((proveedor || '') + ' ' + (descripcion || '')).toUpperCase();
  for (const r of REGLAS_CATEGORIA) {
    for (const p of r.palabras) {
      if (texto.includes(p)) return r.cat;
    }
  }
  return 'otros';
}

async function obtenerSiguienteNumero(ds: DataSource): Promise<string> {
  const ano = new Date().getFullYear();
  const [r] = await ds.query(
    "SELECT MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)) AS m " +
      'FROM cuentas_por_pagar WHERE numero LIKE ?',
    ['CXP-' + ano + '-%'],
  );
  const sig = (r && r.m ? Number(r.m) : 0) + 1;
  return 'CXP-' + ano + '-' + String(sig).padStart(4, '0');
}

@Injectable()
export class CxpService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async listar(filtros?: any): Promise<any[]> {
    filtros = filtros || {};
    const where: string[] = ['1=1'];
    const params: any[] = [];
    if (filtros.estado) {
      if (filtros.estado === 'vencidas') {
        where.push("estado IN ('pendiente','parcial') AND fecha_vencimiento < CURDATE()");
      } else if (filtros.estado === 'por_vencer') {
        where.push("estado IN ('pendiente','parcial') AND fecha_vencimiento >= CURDATE()");
      } else if (filtros.estado === 'pendientes') {
        where.push("estado IN ('pendiente','parcial')");
      } else {
        where.push('estado = ?');
        params.push(filtros.estado);
      }
    }
    if (filtros.proveedor_id) {
      where.push('proveedor_id = ?');
      params.push(Number(filtros.proveedor_id));
    }
    if (filtros.q) {
      where.push('(proveedor_nombre LIKE ? OR ncf LIKE ? OR descripcion LIKE ? OR numero LIKE ?)');
      const q = '%' + filtros.q + '%';
      params.push(q, q, q, q);
    }
    if (filtros.desde) {
      where.push('fecha_factura >= ?');
      params.push(filtros.desde);
    }
    if (filtros.hasta) {
      where.push('fecha_factura <= ?');
      params.push(filtros.hasta);
    }

    return this.ds.query(
      "SELECT *, (CASE WHEN fecha_vencimiento < CURDATE() AND estado IN ('pendiente','parcial') THEN 1 ELSE 0 END) AS vencida " +
        'FROM cuentas_por_pagar WHERE ' +
        where.join(' AND ') +
        ' ORDER BY fecha_vencimiento ASC, id DESC',
      params,
    );
  }

  async obtener(id: number): Promise<any> {
    const [c] = await this.ds.query('SELECT * FROM cuentas_por_pagar WHERE id = ?', [id]);
    if (!c) throw new NotFoundException('CxP #' + id + ' no encontrada');
    const abonos = await this.ds.query(
      'SELECT * FROM cuentas_por_pagar_abonos WHERE cxp_id = ? ORDER BY fecha ASC',
      [id],
    );
    return { ...c, abonos };
  }

  /**
   * Crear factura. Si es al contado, marca pagada y crea gasto. Si es a credito, deja pendiente.
   * Modelo hibrido: a credito CON NCF tambien crea gasto formal pendiente_pago.
   */
  async crear(dto: any): Promise<any> {
    if (!dto.proveedor_nombre && !dto.proveedor_id) {
      throw new BadRequestException('Proveedor requerido');
    }
    if (!dto.monto_total || Number(dto.monto_total) <= 0) {
      throw new BadRequestException('Monto invalido');
    }
    if (!dto.fecha_factura) dto.fecha_factura = new Date().toISOString().slice(0, 10);

    // Resolver proveedor
    let provNombre = dto.proveedor_nombre;
    let provRnc = dto.proveedor_rnc || null;
    if (dto.proveedor_id) {
      const [p] = await this.ds.query(
        'SELECT nombre, rnc FROM proveedores WHERE id = ?',
        [dto.proveedor_id],
      );
      if (p) {
        provNombre = p.nombre;
        provRnc = provRnc || p.rnc;
      }
    }
    provNombre = _upper(provNombre);

    const monto = Number(dto.monto_total);
    const alContado = !!dto.al_contado;
    const fechaVenc = alContado ? null : dto.fecha_vencimiento || null;
    const categoria = dto.categoria || categorizar(provNombre, dto.descripcion);
    const numero = await obtenerSiguienteNumero(this.ds);

    const r = await this.ds.query(
      'INSERT INTO cuentas_por_pagar ' +
        '(numero, proveedor_id, proveedor_nombre, proveedor_rnc, ncf, fecha_factura, fecha_vencimiento, ' +
        ' dias_credito, descripcion, monto_total, monto_pagado, estado, categoria, clasificacion_contable, ' +
        ' orden_compra_id, foto_url, notas, registrado_por_id, registrado_por_nombre, origen) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        numero,
        dto.proveedor_id || null,
        provNombre,
        provRnc,
        _upper(dto.ncf) || null,
        dto.fecha_factura,
        fechaVenc,
        dto.dias_credito || null,
        _upper(dto.descripcion) || null,
        monto,
        alContado ? monto : 0,
        alContado ? 'pagada' : 'pendiente',
        categoria,
        dto.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
        dto.orden_compra_id || null,
        dto.foto_url || null,
        _upper(dto.notas) || null,
        dto.registrado_por_id || null,
        dto.registrado_por_nombre || null,
        dto.origen || 'manual',
      ],
    );
    const cxpId = r.insertId;

    // ─── Opcion C: Hibrido inteligente ─────────────────────────────────────
    if (alContado) {
      // Al contado: crea gasto directo + abono
      await this._crearGastoYAbono(cxpId, {
        monto,
        fecha: dto.fecha_factura,
        metodo_pago: dto.metodo_pago || 'efectivo',
        clasificacion_contable: dto.clasificacion_contable || 'gasto',
        proveedor: provNombre,
        descripcion: dto.descripcion,
        categoria,
        registrado_por_id: dto.registrado_por_id,
        registrado_por_nombre: dto.registrado_por_nombre,
        ncf: dto.ncf || null,
        rnc: provRnc || null,
      });
    } else if (dto.ncf) {
      // A credito CON NCF: contabilizar gasto formal pendiente_pago + dejar CxP pendiente
      const rGasto = await this.ds.query(
        'INSERT INTO gastos ' +
          '(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, rnc, ncf, tipo_ncf, ' +
          ' metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) ' +
          "VALUES ('formal', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pendiente_pago', ?)",
        [
          dto.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
          dto.fecha_factura,
          monto,
          _upper(dto.descripcion) || 'Factura ' + numero,
          categoria,
          provNombre,
          provRnc || null,
          _upper(dto.ncf),
          tipoNcfDesde(dto.ncf),
          dto.registrado_por_id || 1,
          dto.registrado_por_nombre || 'Sistema',
          'Crédito - pendiente de pago. CxP #' + cxpId,
        ],
      );
      await this.ds.query(
        'UPDATE cuentas_por_pagar SET gasto_formal_id = ? WHERE id = ?',
        [rGasto.insertId, cxpId],
      );
    }
    // Si a credito sin NCF: no se crea gasto, queda solo en CxP hasta primer abono

    return this.obtener(cxpId);
  }

  async actualizar(id: number, dto: any): Promise<any> {
    const cxp = await this.obtener(id);
    if (cxp.estado === 'pagada' && Number(cxp.monto_pagado) >= Number(cxp.monto_total)) {
      throw new BadRequestException('Factura ya pagada, no se puede editar');
    }
    const editables = [
      'proveedor_nombre', 'proveedor_rnc', 'ncf', 'fecha_factura', 'fecha_vencimiento',
      'dias_credito', 'descripcion', 'monto_total', 'categoria', 'clasificacion_contable',
      'notas', 'foto_url',
    ];
    const camposTexto = new Set(['proveedor_nombre', 'ncf', 'descripcion', 'notas']);
    const sets: string[] = [];
    const params: any[] = [];
    for (const k of editables) {
      if (dto[k] !== undefined) {
        sets.push('`' + k + '` = ?');
        let v = dto[k];
        if (camposTexto.has(k)) v = _upper(v);
        if (v === '') v = null;
        params.push(v);
      }
    }
    if (sets.length) {
      params.push(id);
      await this.ds.query(
        'UPDATE cuentas_por_pagar SET ' + sets.join(', ') + ' WHERE id = ?',
        params,
      );
    }
    return this.obtener(id);
  }

  async eliminar(id: number): Promise<{ ok: boolean }> {
    const cxp = await this.obtener(id);
    if (Number(cxp.monto_pagado) > 0) {
      throw new BadRequestException('No se puede eliminar: ya tiene abonos. Cancela en su lugar.');
    }
    await this.ds.query('DELETE FROM cuentas_por_pagar WHERE id = ?', [id]);
    return { ok: true };
  }

  async cancelar(id: number, motivo?: string): Promise<{ ok: boolean }> {
    const cxp = await this.obtener(id);
    if (Number(cxp.monto_pagado) > 0) {
      throw new BadRequestException('No se puede cancelar: ya tiene abonos');
    }
    await this.ds.query(
      "UPDATE cuentas_por_pagar SET estado = 'cancelada', notas = CONCAT(IFNULL(notas,''), CHAR(10), 'Cancelada: ', ?) WHERE id = ?",
      [motivo || 'sin motivo', id],
    );
    return { ok: true };
  }

  /**
   * Abono masivo: una sola transferencia bancaria que paga varias CxP a la vez.
   * Distribuye el monto entre las CxP en orden de id ascendente (más viejas primero),
   * saldando cada una completa hasta agotar el monto total.
   *
   * Body: { cxp_ids: number[], monto_total, fecha, metodo_pago, referencia?,
   *         cuenta_banco_id?, notas?, registrado_por_id?, registrado_por_nombre? }
   *
   * Crea un abono por cada CxP afectada (con la misma referencia bancaria),
   * y los gastos correspondientes (o reutiliza el gasto_formal_id si existía).
   */
  async pagoMasivo(dto: any): Promise<any> {
    if (!Array.isArray(dto.cxp_ids) || dto.cxp_ids.length === 0) {
      throw new BadRequestException('cxp_ids es requerido');
    }
    const montoTotal = Number(dto.monto_total);
    if (!montoTotal || montoTotal <= 0) throw new BadRequestException('Monto invalido');

    // Cargar todas las CxP y validar
    const cxps: any[] = [];
    for (const id of dto.cxp_ids) {
      const c = await this.obtener(Number(id));
      if (c.estado === 'pagada') {
        throw new BadRequestException(`CxP ${c.numero} ya está pagada`);
      }
      if (c.estado === 'cancelada') {
        throw new BadRequestException(`CxP ${c.numero} está cancelada`);
      }
      cxps.push(c);
    }

    // Ordenar por id (más viejas primero) para distribuir
    cxps.sort((a, b) => a.id - b.id);

    const sumaSaldos = cxps.reduce(
      (s, c) => s + (Number(c.monto_total) - Number(c.monto_pagado)),
      0,
    );
    if (montoTotal > sumaSaldos + 0.01) {
      throw new BadRequestException(
        `El monto (${montoTotal.toFixed(2)}) excede la suma de saldos (${sumaSaldos.toFixed(2)})`,
      );
    }

    const fecha       = dto.fecha || new Date().toISOString().slice(0, 10);
    const metodoPago  = dto.metodo_pago || 'transferencia';
    const aplicados: Array<{ cxp_id: number; cxp_numero: string; monto: number }> = [];

    // Distribuir: saldar cada CxP completa hasta agotar monto disponible
    let restante = montoTotal;
    for (const cxp of cxps) {
      if (restante <= 0.01) break;
      const saldoCxp = Number(cxp.monto_total) - Number(cxp.monto_pagado);
      const aAplicar = Math.min(saldoCxp, restante);
      if (aAplicar <= 0) continue;

      await this._crearGastoYAbono(cxp.id, {
        monto:                   aAplicar,
        fecha,
        metodo_pago:             metodoPago,
        clasificacion_contable:  cxp.clasificacion_contable,
        proveedor:               cxp.proveedor_nombre,
        proveedor_id:            cxp.proveedor_id || null,
        rnc:                     cxp.proveedor_rnc || null,
        ncf:                     cxp.ncf || null,
        descripcion: 'Abono masivo ' + cxp.numero + ' (' + cxp.proveedor_nombre + ')',
        categoria:               cxp.categoria,
        referencia:              dto.referencia || null,
        cuenta_banco_id:         dto.cuenta_banco_id || null,
        notas:                   dto.notas || `Pago masivo de ${cxps.length} facturas`,
        registrado_por_id:       dto.registrado_por_id,
        registrado_por_nombre:   dto.registrado_por_nombre,
      });
      aplicados.push({ cxp_id: cxp.id, cxp_numero: cxp.numero, monto: aAplicar });
      restante -= aAplicar;
    }

    return {
      ok: true,
      facturas_pagadas: aplicados.length,
      monto_aplicado:   montoTotal - restante,
      detalle:          aplicados,
    };
  }

  async registrarAbono(cxpId: number, dto: any): Promise<any> {
    const cxp = await this.obtener(cxpId);
    if (cxp.estado === 'pagada') throw new BadRequestException('Factura ya pagada');
    if (cxp.estado === 'cancelada') throw new BadRequestException('Factura cancelada');

    const monto = Number(dto.monto);
    if (!monto || monto <= 0) throw new BadRequestException('Monto invalido');
    const saldoActual = Number(cxp.monto_total) - Number(cxp.monto_pagado);
    if (monto > saldoActual + 0.01) {
      throw new BadRequestException(
        'El abono (' + monto.toFixed(2) + ') excede el saldo (' + saldoActual.toFixed(2) + ')',
      );
    }

    await this._crearGastoYAbono(cxpId, {
      monto,
      fecha: dto.fecha || new Date().toISOString().slice(0, 10),
      metodo_pago: dto.metodo_pago || 'transferencia',
      clasificacion_contable: cxp.clasificacion_contable,
      proveedor: cxp.proveedor_nombre,
      proveedor_id: cxp.proveedor_id || null,
      rnc: cxp.proveedor_rnc || null,
      ncf: cxp.ncf || null,
      descripcion: 'Abono ' + cxp.numero + ' (' + cxp.proveedor_nombre + ')',
      categoria: cxp.categoria,
      referencia: dto.referencia || null,
      cuenta_banco_id: dto.cuenta_banco_id || null,
      notas: dto.notas || null,
      registrado_por_id: dto.registrado_por_id,
      registrado_por_nombre: dto.registrado_por_nombre,
    });

    return this.obtener(cxpId);
  }

  async _crearGastoYAbono(
    cxpId: number,
    dto: any,
  ): Promise<{ gasto_id: number | null; abono_id: number }> {
    // Verificar si la CxP ya tiene un gasto formal asociado (modelo hibrido)
    const [cxpInfo] = await this.ds.query(
      'SELECT gasto_formal_id, monto_total, monto_pagado FROM cuentas_por_pagar WHERE id = ?',
      [cxpId],
    );

    let gastoId: number | null = null;

    if (cxpInfo && cxpInfo.gasto_formal_id) {
      // Ya hay gasto formal contabilizado. NO crear gasto duplicado.
      gastoId = cxpInfo.gasto_formal_id;
      const totalConAbono = Number(cxpInfo.monto_pagado) + Number(dto.monto);
      if (totalConAbono >= Number(cxpInfo.monto_total) - 0.01) {
        // Pago completo: cambiar estado a 'registrado'
        await this.ds.query(
          "UPDATE gastos SET estado = 'registrado', metodo_pago = ? WHERE id = ?",
          [dto.metodo_pago, gastoId],
        );
      }
    } else {
      // No hay gasto formal previo. Crear gasto nuevo por el monto del abono.
      const tipoGasto = dto.ncf || dto.rnc || dto.proveedor_id ? 'formal' : 'informal';
      const rGasto = await this.ds.query(
        'INSERT INTO gastos ' +
          '(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, rnc, ncf, tipo_ncf, ' +
          ' metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) ' +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrado', ?)",
        [
          tipoGasto,
          dto.clasificacion_contable,
          dto.fecha,
          dto.monto,
          dto.descripcion || 'Pago a proveedor',
          dto.categoria || 'otros',
          dto.proveedor || null,
          dto.rnc || null,
          dto.ncf || null,
          tipoNcfDesde(dto.ncf),
          dto.metodo_pago,
          dto.registrado_por_id || 1,
          dto.registrado_por_nombre || 'Sistema',
          dto.notas || null,
        ],
      );
      gastoId = rGasto.insertId;
    }

    // 2) Crear el abono apuntando al gasto
    const rAbono = await this.ds.query(
      'INSERT INTO cuentas_por_pagar_abonos ' +
        '(cxp_id, fecha, monto, metodo_pago, referencia, cuenta_banco_id, gasto_id, notas, ' +
        ' registrado_por_id, registrado_por_nombre) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        cxpId, dto.fecha, dto.monto, dto.metodo_pago, dto.referencia || null,
        dto.cuenta_banco_id || null, gastoId, dto.notas || null,
        dto.registrado_por_id || null, dto.registrado_por_nombre || 'Sistema',
      ],
    );

    // 3) Actualizar monto_pagado y estado de la CxP
    await this.ds.query(
      'UPDATE cuentas_por_pagar SET ' +
        "  estado = IF(monto_pagado + ? >= monto_total - 0.01, 'pagada', 'parcial'), " +
        '  monto_pagado = monto_pagado + ? ' +
        'WHERE id = ?',
      [dto.monto, dto.monto, cxpId],
    );

    return { gasto_id: gastoId, abono_id: rAbono.insertId };
  }

  /** Resumen para dashboards y reportes */
  async resumen(): Promise<any> {
    const [r] = await this.ds.query(
      'SELECT ' +
        '  COUNT(*) AS total, ' +
        "  SUM(CASE WHEN estado IN ('pendiente','parcial') THEN 1 ELSE 0 END) AS pendientes, " +
        "  SUM(CASE WHEN estado IN ('pendiente','parcial') AND fecha_vencimiento < CURDATE() THEN 1 ELSE 0 END) AS vencidas, " +
        "  SUM(CASE WHEN estado IN ('pendiente','parcial') THEN monto_total - monto_pagado ELSE 0 END) AS saldo_total, " +
        "  SUM(CASE WHEN estado IN ('pendiente','parcial') AND fecha_vencimiento < CURDATE() THEN monto_total - monto_pagado ELSE 0 END) AS saldo_vencido " +
        'FROM cuentas_por_pagar',
    );
    return r || { total: 0, pendientes: 0, vencidas: 0, saldo_total: 0, saldo_vencido: 0 };
  }

  /** Aging report */
  async aging(): Promise<any[]> {
    return this.ds.query(
      'SELECT ' +
        '  CASE ' +
        "    WHEN DATEDIFF(CURDATE(), fecha_vencimiento) <= 0 THEN 'por_vencer' " +
        "    WHEN DATEDIFF(CURDATE(), fecha_vencimiento) BETWEEN 1 AND 30 THEN 'vencida_30' " +
        "    WHEN DATEDIFF(CURDATE(), fecha_vencimiento) BETWEEN 31 AND 60 THEN 'vencida_60' " +
        "    WHEN DATEDIFF(CURDATE(), fecha_vencimiento) BETWEEN 61 AND 90 THEN 'vencida_90' " +
        "    ELSE 'vencida_90_mas' " +
        '  END AS rango, ' +
        '  COUNT(*) AS cantidad, ' +
        '  SUM(monto_total - monto_pagado) AS saldo ' +
        'FROM cuentas_por_pagar ' +
        "WHERE estado IN ('pendiente','parcial') AND fecha_vencimiento IS NOT NULL " +
        'GROUP BY rango',
    );
  }

  /** Para el calendario unificado (CxP pendientes con vencimiento) */
  async calendario(desde?: string, hasta?: string): Promise<any[]> {
    if (!desde || !hasta) {
      const hoy = new Date();
      const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 0);
      desde = ini.toISOString().slice(0, 10);
      hasta = fin.toISOString().slice(0, 10);
    }
    return this.ds.query(
      'SELECT id, numero, proveedor_nombre AS nombre, descripcion, monto_total AS monto_estimado, ' +
        '  monto_pagado, (monto_total - monto_pagado) AS saldo, estado, fecha_vencimiento, ' +
        "  ncf, categoria, clasificacion_contable, foto_url, 'cxp' AS tipo " +
        'FROM cuentas_por_pagar ' +
        "WHERE estado IN ('pendiente','parcial') AND fecha_vencimiento BETWEEN ? AND ? " +
        'ORDER BY fecha_vencimiento ASC',
      [desde, hasta],
    );
  }

  /** Detectar colision con compromiso recurrente activo */
  async _detectarColision(proveedor: string): Promise<any> {
    const candidatos = await this.ds.query(
      'SELECT id, nombre, alias, frecuencia, monto_estimado FROM compromisos_recurrentes ' +
        "WHERE activo = 1 AND frecuencia != 'unica'",
    );
    const conc = String(proveedor).toUpperCase();
    const palabras = conc.split(/\s+/).filter((p: string) => p.length >= 3);
    for (const c of candidatos) {
      const aliasArr = c.alias
        ? String(c.alias).toUpperCase().split(',').map((a: string) => a.trim()).filter(Boolean)
        : [];
      const nombreUp = String(c.nombre).toUpperCase();
      for (const p of palabras) {
        if (aliasArr.includes(p)) return c;
        if (nombreUp.includes(p) && p.length >= 4) return c;
      }
    }
    return null;
  }

  /**
   * Llamado desde el bot. Texto tipo: "factura claro 3500 vence 15 jun"
   * modo: 'consultar' | 'credito' | 'contado'
   */
  async desdeBot(texto: string, chatId: string | number, modo: string, forzarNuevo?: boolean): Promise<any> {
    if (!texto) throw new BadRequestException('Texto vacio');
    if (!chatId) throw new BadRequestException('chat_id requerido');

    const [vinc] = await this.ds.query(
      'SELECT v.usuario_id, u.nombre AS usuario_nombre, u.rol ' +
        'FROM telegram_usuarios v JOIN usuarios u ON u.id = v.usuario_id ' +
        'WHERE v.chat_id = ? LIMIT 1',
      [String(chatId)],
    );
    if (!vinc) throw new UnauthorizedException('Chat no vinculado al ERP');
    if (vinc.rol !== 'admin') throw new ForbiddenException('Solo el admin puede registrar facturas');

    // Normalizar acentos
    const t = String(texto)
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    const monto = this._parsearMonto(t);
    if (!monto || monto <= 0) throw new BadRequestException('No detecte el monto');

    const fechaVenc = this._parsearFecha(t);

    const verbos = /\b(FACTURA|DEBER|CREDITO|CRÉDITO|PENDIENTE|POR\s+PAGAR|CUENTA|VENCE|EL|LA|LOS|LAS|DE|DEL|A|EN|CON|POR|GASTO|GASTE|GASTÉ|GASTAR|COMPRE|COMPRÉ|COMPRAR|CONSUMI|CONSUMÍ)\b/g;
    const meses = /\b(ENE|ENERO|FEB|FEBRERO|MAR|MARZO|ABR|ABRIL|MAY|MAYO|JUN|JUNIO|JUL|JULIO|AGO|AGOSTO|SEP|SEPTIEMBRE|OCT|OCTUBRE|NOV|NOVIEMBRE|DIC|DICIEMBRE|MANANA|MAÑANA|HOY|LUNES|MARTES|MIERCOLES|MIÉRCOLES|JUEVES|VIERNES|SABADO|SÁBADO|DOMINGO|DIAS|DÍAS)\b/g;
    const montoMatch = t.match(/(\d{1,3}(?:[\.,]\d{3})+(?:[\.,]\d{1,2})?|\d+(?:[\.,]\d{1,2})?)/);
    let concepto = t
      .split(montoMatch![0]).join(' ')
      .replace(verbos, ' ')
      .replace(meses, ' ')
      .replace(/\b\d{1,2}([\/\-]\d{1,2}([\/\-]\d{2,4})?)?\b/g, ' ')
      .replace(/[^A-ZÑÁÉÍÓÚ\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (concepto.length < 2) concepto = 'FACTURA';

    if (modo === 'consultar') {
      const colision = await this._detectarColision(concepto);
      return {
        ok: true,
        modo_consulta: true,
        proveedor_nombre: concepto,
        monto_total: monto,
        fecha_vencimiento: fechaVenc,
        categoria: categorizar(concepto, ''),
        colision: colision
          ? {
              id: colision.id,
              nombre: colision.nombre,
              alias: colision.alias,
              frecuencia: colision.frecuencia,
              monto_estimado: colision.monto_estimado,
            }
          : null,
      };
    }

    const alContado = modo === 'contado';
    if (!alContado && !fechaVenc) {
      throw new BadRequestException(
        'Para una factura a credito necesito la fecha de vencimiento. Ej: "factura X 850 vence 30 jun"',
      );
    }

    if (!forzarNuevo) {
      const colision = await this._detectarColision(concepto);
      if (colision) {
        return {
          ok: false,
          colision: true,
          recurrente: {
            id: colision.id,
            nombre: colision.nombre,
            alias: colision.alias,
            frecuencia: colision.frecuencia,
            monto_estimado: colision.monto_estimado,
          },
          datos_parseados: {
            proveedor_nombre: concepto,
            monto_total: monto,
            fecha_vencimiento: fechaVenc,
            al_contado: alContado,
          },
        };
      }
    }

    return this.crear({
      proveedor_nombre: concepto,
      monto_total: monto,
      fecha_factura: new Date().toISOString().slice(0, 10),
      fecha_vencimiento: fechaVenc,
      al_contado: alContado,
      metodo_pago: alContado ? 'efectivo' : null,
      registrado_por_id: vinc.usuario_id,
      registrado_por_nombre: vinc.usuario_nombre,
      origen: 'bot',
      descripcion: 'Registrado via bot. Texto: "' + texto + '"',
    });
  }

  _parsearMonto(t: string): number | null {
    const m = t.match(/(\d{1,3}(?:[\.,]\d{3})+(?:[\.,]\d{1,2})?|\d+(?:[\.,]\d{1,2})?)/);
    if (!m) return null;
    let s = m[1];
    if (s.includes('.') && s.includes(',')) {
      const lastDot = s.lastIndexOf('.');
      const lastCom = s.lastIndexOf(',');
      if (lastCom > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      const partes = s.split(',');
      if (partes[partes.length - 1].length <= 2 && partes.length === 2) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes('.')) {
      const partes = s.split('.');
      if (partes.length > 2 || partes[partes.length - 1].length === 3) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  _parsearFecha(tUp: string): string | null {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ano = hoy.getFullYear();
    const fmt = (d: Date) =>
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (/\bHOY\b/.test(tUp)) return fmt(hoy);
    if (/\b(MANANA|MAÑANA)\b/.test(tUp)) {
      const m = new Date(hoy);
      m.setDate(m.getDate() + 1);
      return fmt(m);
    }
    const matchDias = tUp.match(/(\d{1,3})\s+D[IÍ]AS/);
    if (matchDias) {
      const f = new Date(hoy);
      f.setDate(f.getDate() + Number(matchDias[1]));
      return fmt(f);
    }
    const matchIso = tUp.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
    if (matchIso) {
      return matchIso[1] + '-' + matchIso[2].padStart(2, '0') + '-' + matchIso[3].padStart(2, '0');
    }
    const matchSlash = tUp.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (matchSlash) {
      const d = Number(matchSlash[1]);
      const m = Number(matchSlash[2]);
      let y = matchSlash[3] ? Number(matchSlash[3]) : ano;
      if (y < 100) y = 2000 + y;
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        const fecha = new Date(y, m - 1, d);
        if (!matchSlash[3] && fecha < hoy) fecha.setFullYear(y + 1);
        return fmt(fecha);
      }
    }
    const MESES: Record<string, number> = {
      ENE: 1, ENERO: 1, FEB: 2, FEBRERO: 2, MAR: 3, MARZO: 3, ABR: 4, ABRIL: 4,
      MAY: 5, MAYO: 5, JUN: 6, JUNIO: 6, JUL: 7, JULIO: 7, AGO: 8, AGOSTO: 8,
      SEP: 9, SEPTIEMBRE: 9, OCT: 10, OCTUBRE: 10, NOV: 11, NOVIEMBRE: 11, DIC: 12, DICIEMBRE: 12,
    };
    const re = new RegExp('(\\d{1,2})\\s+(?:DE\\s+)?(' + Object.keys(MESES).join('|') + ')(?:\\s+(\\d{2,4}))?');
    const matchEs = tUp.match(re);
    if (matchEs) {
      const d = Number(matchEs[1]);
      const m = MESES[matchEs[2]];
      let y = matchEs[3] ? Number(matchEs[3]) : ano;
      if (y < 100) y = 2000 + y;
      const fecha = new Date(y, m - 1, d);
      if (!matchEs[3] && fecha < hoy) fecha.setFullYear(y + 1);
      return fmt(fecha);
    }
    return null;
  }

  /** Bot foto OCR: recibe datos estructurados desde el OCR */
  async crearDesdeFotoBot(chatId: string | number, dto: any): Promise<any> {
    if (!chatId) throw new BadRequestException('chat_id requerido');
    const [vinc] = await this.ds.query(
      'SELECT v.usuario_id, u.nombre AS usuario_nombre, u.rol ' +
        'FROM telegram_usuarios v JOIN usuarios u ON u.id = v.usuario_id ' +
        'WHERE v.chat_id = ? LIMIT 1',
      [String(chatId)],
    );
    if (!vinc) throw new UnauthorizedException('Chat no vinculado');
    if (vinc.rol !== 'admin') throw new ForbiddenException('Solo admin');

    return this.crear({
      ...dto,
      registrado_por_id: vinc.usuario_id,
      registrado_por_nombre: vinc.usuario_nombre,
      origen: 'foto',
    });
  }
}
