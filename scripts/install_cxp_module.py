"""Instala el modulo de Cuentas por Pagar (CxP):
- Service con CRUD + abonos + categorizacion automatica
- Controller con endpoints web (JWT) y bot (x-bot-secret)
- Registra el modulo en app.module.js
"""
import os

DIST = '/home/u372536694/apps/api/dist'
CXP_DIR = f'{DIST}/cxp'
os.makedirs(CXP_DIR, exist_ok=True)

# ────────────────────────── SERVICE ──────────────────────────
SERVICE = """'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CxpService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");

const __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
const __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
const __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); };
};

function _upper(v) {
  if (v == null) return v;
  if (typeof v !== 'string') return v;
  return v.toUpperCase();
}

// Reglas de categorizacion automatica por palabras clave del proveedor/descripcion
const REGLAS_CATEGORIA = [
  { palabras: ['EDEESTE', 'EDENORTE', 'EDESUR', 'LUZ', 'ELECTRICIDAD', 'ENERGIA'], cat: 'servicios' },
  { palabras: ['CLARO', 'ALTICE', 'VIVA', 'INTERNET', 'WIFI', 'TELEFONO', 'CELULAR'], cat: 'tecnologia' },
  { palabras: ['ALQUILER', 'RENTA', 'LOCAL'], cat: 'alquiler' },
  { palabras: ['NOMINA', 'SUELDO', 'EMPLEADO'], cat: 'nomina' },
  { palabras: ['MANTENIMIENTO', 'REPARACION', 'REPARAR'], cat: 'mantenimiento' },
  { palabras: ['IMPUESTO', 'DGII', 'ITBIS', 'ISR'], cat: 'impuestos' },
  { palabras: ['BANCO', 'PRESTAMO', 'CUOTA'], cat: 'prestamos' },
  { palabras: ['TINTA', 'PAPEL', 'TONER', 'PAPELERIA'], cat: 'mantenimiento' },
  { palabras: ['HILO', 'TELA', 'BORDADO', 'MAQUINA', 'BORDAR', 'BOTON', 'COSER'], cat: 'mantenimiento' },
  { palabras: ['FLETE', 'TRANSPORTE', 'COURIER', 'CARGA'], cat: 'servicios' },
];

function categorizar(proveedor, descripcion) {
  const texto = ((proveedor || '') + ' ' + (descripcion || '')).toUpperCase();
  for (const r of REGLAS_CATEGORIA) {
    for (const p of r.palabras) {
      if (texto.includes(p)) return r.cat;
    }
  }
  return 'otros';
}

async function obtenerSiguienteNumero(ds) {
  const ano = new Date().getFullYear();
  const [r] = await ds.query(
    "SELECT MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)) AS m " +
    "FROM cuentas_por_pagar WHERE numero LIKE ?",
    ['CXP-' + ano + '-%']
  );
  const sig = (r && r.m ? Number(r.m) : 0) + 1;
  return 'CXP-' + ano + '-' + String(sig).padStart(4, '0');
}

let CxpService = class CxpService {
  constructor(ds) { this.ds = ds; }

  async listar(filtros) {
    filtros = filtros || {};
    const where = ['1=1'];
    const params = [];
    if (filtros.estado) {
      if (filtros.estado === 'vencidas') {
        where.push("estado IN ('pendiente','parcial') AND fecha_vencimiento < CURDATE()");
      } else if (filtros.estado === 'por_vencer') {
        where.push("estado IN ('pendiente','parcial') AND fecha_vencimiento >= CURDATE()");
      } else if (filtros.estado === 'pendientes') {
        where.push("estado IN ('pendiente','parcial')");
      } else {
        where.push("estado = ?");
        params.push(filtros.estado);
      }
    }
    if (filtros.proveedor_id) {
      where.push("proveedor_id = ?");
      params.push(Number(filtros.proveedor_id));
    }
    if (filtros.q) {
      where.push("(proveedor_nombre LIKE ? OR ncf LIKE ? OR descripcion LIKE ? OR numero LIKE ?)");
      const q = '%' + filtros.q + '%';
      params.push(q, q, q, q);
    }
    if (filtros.desde) { where.push("fecha_factura >= ?"); params.push(filtros.desde); }
    if (filtros.hasta) { where.push("fecha_factura <= ?"); params.push(filtros.hasta); }

    return this.ds.query(
      "SELECT *, (CASE WHEN fecha_vencimiento < CURDATE() AND estado IN ('pendiente','parcial') THEN 1 ELSE 0 END) AS vencida " +
      "FROM cuentas_por_pagar WHERE " + where.join(' AND ') + " ORDER BY fecha_vencimiento ASC, id DESC",
      params
    );
  }

  async obtener(id) {
    const [c] = await this.ds.query("SELECT * FROM cuentas_por_pagar WHERE id = ?", [id]);
    if (!c) throw new common_1.NotFoundException('CxP #' + id + ' no encontrada');
    const abonos = await this.ds.query("SELECT * FROM cuentas_por_pagar_abonos WHERE cxp_id = ? ORDER BY fecha ASC", [id]);
    return Object.assign({}, c, { abonos });
  }

  /**
   * Crear factura. Si es al contado, marca pagada y crea gasto. Si es a credito, deja pendiente.
   * dto = { proveedor_nombre, proveedor_id?, proveedor_rnc?, ncf?, fecha_factura, fecha_vencimiento?,
   *         monto_total, descripcion?, categoria?, clasificacion_contable?, orden_compra_id?,
   *         al_contado?, metodo_pago?, foto_url?, notas?, origen?, registrado_por_id?, registrado_por_nombre? }
   */
  async crear(dto) {
    if (!dto.proveedor_nombre && !dto.proveedor_id) {
      throw new common_1.BadRequestException('Proveedor requerido');
    }
    if (!dto.monto_total || Number(dto.monto_total) <= 0) {
      throw new common_1.BadRequestException('Monto invalido');
    }
    if (!dto.fecha_factura) dto.fecha_factura = new Date().toISOString().slice(0, 10);

    // Resolver proveedor
    let provNombre = dto.proveedor_nombre;
    let provRnc = dto.proveedor_rnc || null;
    if (dto.proveedor_id) {
      const [p] = await this.ds.query("SELECT nombre, rnc FROM proveedores WHERE id = ?", [dto.proveedor_id]);
      if (p) { provNombre = p.nombre; provRnc = provRnc || p.rnc; }
    }
    provNombre = _upper(provNombre);

    const monto = Number(dto.monto_total);
    const alContado = !!dto.al_contado;
    const fechaVenc = alContado ? null : (dto.fecha_vencimiento || null);
    const categoria = dto.categoria || categorizar(provNombre, dto.descripcion);
    const numero = await obtenerSiguienteNumero(this.ds);

    const r = await this.ds.query(
      "INSERT INTO cuentas_por_pagar " +
      "(numero, proveedor_id, proveedor_nombre, proveedor_rnc, ncf, fecha_factura, fecha_vencimiento, " +
      " dias_credito, descripcion, monto_total, monto_pagado, estado, categoria, clasificacion_contable, " +
      " orden_compra_id, foto_url, notas, registrado_por_id, registrado_por_nombre, origen) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
      ]
    );
    const cxpId = r.insertId;

    // Si al contado, crear gasto directo + abono
    if (alContado) {
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
      });
    }

    return this.obtener(cxpId);
  }

  async actualizar(id, dto) {
    const cxp = await this.obtener(id);
    if (cxp.estado === 'pagada' && cxp.monto_pagado >= cxp.monto_total) {
      throw new common_1.BadRequestException('Factura ya pagada, no se puede editar');
    }
    const editables = ['proveedor_nombre','proveedor_rnc','ncf','fecha_factura','fecha_vencimiento',
      'dias_credito','descripcion','monto_total','categoria','clasificacion_contable','notas','foto_url'];
    const camposTexto = new Set(['proveedor_nombre','ncf','descripcion','notas']);
    const sets = [];
    const params = [];
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
      await this.ds.query("UPDATE cuentas_por_pagar SET " + sets.join(', ') + " WHERE id = ?", params);
    }
    return this.obtener(id);
  }

  async eliminar(id) {
    const cxp = await this.obtener(id);
    if (cxp.monto_pagado > 0) {
      throw new common_1.BadRequestException('No se puede eliminar: ya tiene abonos. Cancela en su lugar.');
    }
    await this.ds.query("DELETE FROM cuentas_por_pagar WHERE id = ?", [id]);
    return { ok: true };
  }

  async cancelar(id, motivo) {
    const cxp = await this.obtener(id);
    if (cxp.monto_pagado > 0) {
      throw new common_1.BadRequestException('No se puede cancelar: ya tiene abonos');
    }
    await this.ds.query(
      "UPDATE cuentas_por_pagar SET estado = 'cancelada', notas = CONCAT(IFNULL(notas,''), CHAR(10), 'Cancelada: ', ?) WHERE id = ?",
      [motivo || 'sin motivo', id]
    );
    return { ok: true };
  }

  async registrarAbono(cxpId, dto) {
    const cxp = await this.obtener(cxpId);
    if (cxp.estado === 'pagada') throw new common_1.BadRequestException('Factura ya pagada');
    if (cxp.estado === 'cancelada') throw new common_1.BadRequestException('Factura cancelada');

    const monto = Number(dto.monto);
    if (!monto || monto <= 0) throw new common_1.BadRequestException('Monto invalido');
    const saldoActual = Number(cxp.monto_total) - Number(cxp.monto_pagado);
    if (monto > saldoActual + 0.01) {
      throw new common_1.BadRequestException(
        'El abono (' + monto.toFixed(2) + ') excede el saldo (' + saldoActual.toFixed(2) + ')'
      );
    }

    const res = await this._crearGastoYAbono(cxpId, {
      monto,
      fecha: dto.fecha || new Date().toISOString().slice(0, 10),
      metodo_pago: dto.metodo_pago || 'transferencia',
      clasificacion_contable: cxp.clasificacion_contable,
      proveedor: cxp.proveedor_nombre,
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

  async _crearGastoYAbono(cxpId, dto) {
    // 1) Crear el gasto
    const rGasto = await this.ds.query(
      "INSERT INTO gastos " +
      "(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, " +
      " metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) " +
      "VALUES ('informal', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrado', ?)",
      [
        dto.clasificacion_contable,
        dto.fecha,
        dto.monto,
        dto.descripcion || 'Pago a proveedor',
        dto.categoria || 'otros',
        dto.proveedor || null,
        dto.metodo_pago,
        dto.registrado_por_id || 1,
        dto.registrado_por_nombre || 'Sistema',
        dto.notas || null,
      ]
    );
    const gastoId = rGasto.insertId;

    // 2) Crear el abono apuntando al gasto
    const rAbono = await this.ds.query(
      "INSERT INTO cuentas_por_pagar_abonos " +
      "(cxp_id, fecha, monto, metodo_pago, referencia, cuenta_banco_id, gasto_id, notas, " +
      " registrado_por_id, registrado_por_nombre) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        cxpId, dto.fecha, dto.monto, dto.metodo_pago, dto.referencia || null,
        dto.cuenta_banco_id || null, gastoId, dto.notas || null,
        dto.registrado_por_id || null, dto.registrado_por_nombre || 'Sistema'
      ]
    );

    // 3) Actualizar monto_pagado y estado de la CxP
    await this.ds.query(
      "UPDATE cuentas_por_pagar SET " +
      "  monto_pagado = monto_pagado + ?, " +
      "  estado = CASE " +
      "    WHEN monto_pagado + ? >= monto_total THEN 'pagada' " +
      "    ELSE 'parcial' " +
      "  END " +
      "WHERE id = ?",
      [dto.monto, dto.monto, cxpId]
    );

    return { gasto_id: gastoId, abono_id: rAbono.insertId };
  }

  /** Resumen para dashboards y reportes */
  async resumen() {
    const [r] = await this.ds.query(
      "SELECT " +
      "  COUNT(*) AS total, " +
      "  SUM(CASE WHEN estado IN ('pendiente','parcial') THEN 1 ELSE 0 END) AS pendientes, " +
      "  SUM(CASE WHEN estado IN ('pendiente','parcial') AND fecha_vencimiento < CURDATE() THEN 1 ELSE 0 END) AS vencidas, " +
      "  SUM(CASE WHEN estado IN ('pendiente','parcial') THEN monto_total - monto_pagado ELSE 0 END) AS saldo_total, " +
      "  SUM(CASE WHEN estado IN ('pendiente','parcial') AND fecha_vencimiento < CURDATE() THEN monto_total - monto_pagado ELSE 0 END) AS saldo_vencido " +
      "FROM cuentas_por_pagar"
    );
    return r || { total: 0, pendientes: 0, vencidas: 0, saldo_total: 0, saldo_vencido: 0 };
  }

  /** Aging report: agrupa por dias de vencimiento */
  async aging() {
    return this.ds.query(
      "SELECT " +
      "  CASE " +
      "    WHEN DATEDIFF(CURDATE(), fecha_vencimiento) <= 0 THEN 'por_vencer' " +
      "    WHEN DATEDIFF(CURDATE(), fecha_vencimiento) BETWEEN 1 AND 30 THEN 'vencida_30' " +
      "    WHEN DATEDIFF(CURDATE(), fecha_vencimiento) BETWEEN 31 AND 60 THEN 'vencida_60' " +
      "    WHEN DATEDIFF(CURDATE(), fecha_vencimiento) BETWEEN 61 AND 90 THEN 'vencida_90' " +
      "    ELSE 'vencida_90_mas' " +
      "  END AS rango, " +
      "  COUNT(*) AS cantidad, " +
      "  SUM(monto_total - monto_pagado) AS saldo " +
      "FROM cuentas_por_pagar " +
      "WHERE estado IN ('pendiente','parcial') AND fecha_vencimiento IS NOT NULL " +
      "GROUP BY rango"
    );
  }

  /** Lo que aparece en el calendario unificado (CxP pendientes con vencimiento) */
  async calendario(desde, hasta) {
    if (!desde || !hasta) {
      const hoy = new Date();
      const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 0);
      desde = ini.toISOString().slice(0, 10);
      hasta = fin.toISOString().slice(0, 10);
    }
    return this.ds.query(
      "SELECT id, numero, proveedor_nombre AS nombre, descripcion, monto_total AS monto_estimado, " +
      "  monto_pagado, (monto_total - monto_pagado) AS saldo, estado, fecha_vencimiento, " +
      "  ncf, categoria, clasificacion_contable, foto_url, 'cxp' AS tipo " +
      "FROM cuentas_por_pagar " +
      "WHERE estado IN ('pendiente','parcial') AND fecha_vencimiento BETWEEN ? AND ? " +
      "ORDER BY fecha_vencimiento ASC",
      [desde, hasta]
    );
  }

  /** Verifica colision con compromiso recurrente (mismo proveedor/alias) */
  async _detectarColision(proveedor) {
    const candidatos = await this.ds.query(
      "SELECT id, nombre, alias, frecuencia, monto_estimado FROM compromisos_recurrentes " +
      "WHERE activo = 1 AND frecuencia != 'unica'"
    );
    const conc = String(proveedor).toUpperCase();
    const palabras = conc.split(/\\s+/).filter(p => p.length >= 3);
    for (const c of candidatos) {
      const aliasArr = c.alias ? String(c.alias).toUpperCase().split(',').map(a => a.trim()).filter(Boolean) : [];
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
   * Si solo_consultar=true, devuelve datos parseados sin guardar (para que bot pregunte credito/contado).
   */
  async desdeBot(texto, chatId, modo /* 'consultar' | 'credito' | 'contado' */, forzarNuevo) {
    if (!texto) throw new common_1.BadRequestException('Texto vacio');
    if (!chatId) throw new common_1.BadRequestException('chat_id requerido');

    const [vinc] = await this.ds.query(
      "SELECT v.usuario_id, u.nombre AS usuario_nombre, u.rol " +
      "FROM telegram_usuarios v JOIN usuarios u ON u.id = v.usuario_id " +
      "WHERE v.chat_id = ? LIMIT 1",
      [String(chatId)]
    );
    if (!vinc) throw new common_1.UnauthorizedException('Chat no vinculado al ERP');
    if (vinc.rol !== 'admin') throw new common_1.ForbiddenException('Solo el admin puede registrar facturas');

    const t = String(texto).trim().toUpperCase();
    const monto = this._parsearMonto(t);
    if (!monto || monto <= 0) throw new common_1.BadRequestException('No detecte el monto');

    const fechaVenc = this._parsearFecha(t); // puede ser null si no especifica

    // Extraer concepto/proveedor: quitar verbos, fechas, monto
    const verbos = /\\b(FACTURA|DEBER|CREDITO|CR\\u00c9DITO|PENDIENTE|POR\\s+PAGAR|CUENTA|VENCE|EL|LA|LOS|LAS|DE|DEL|A|EN|CON|POR)\\b/g;
    const meses = /\\b(ENE|ENERO|FEB|FEBRERO|MAR|MARZO|ABR|ABRIL|MAY|MAYO|JUN|JUNIO|JUL|JULIO|AGO|AGOSTO|SEP|SEPTIEMBRE|OCT|OCTUBRE|NOV|NOVIEMBRE|DIC|DICIEMBRE|MANANA|MA\\u00d1ANA|HOY|LUNES|MARTES|MIERCOLES|MI\\u00c9RCOLES|JUEVES|VIERNES|SABADO|S\\u00c1BADO|DOMINGO|DIAS|D\\u00cdAS)\\b/g;
    const monto_match = t.match(/(\\d{1,3}(?:[\\.,]\\d{3})+(?:[\\.,]\\d{1,2})?|\\d+(?:[\\.,]\\d{1,2})?)/);
    let concepto = t
      .split(monto_match[0]).join(' ')
      .replace(verbos, ' ')
      .replace(meses, ' ')
      .replace(/\\b\\d{1,2}([\\/\\-]\\d{1,2}([\\/\\-]\\d{2,4})?)?\\b/g, ' ')
      .replace(/[^A-Z\\u00d1\\u00c1\\u00c9\\u00cd\\u00d3\\u00da\\s]/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    if (concepto.length < 2) concepto = 'FACTURA';

    // Modo consultar: devolver los datos parseados + colision (si hay)
    if (modo === 'consultar') {
      const colision = await this._detectarColision(concepto);
      return {
        ok: true,
        modo_consulta: true,
        proveedor_nombre: concepto,
        monto_total: monto,
        fecha_vencimiento: fechaVenc,
        categoria: categorizar(concepto, ''),
        colision: colision ? {
          id: colision.id,
          nombre: colision.nombre,
          alias: colision.alias,
          frecuencia: colision.frecuencia,
          monto_estimado: colision.monto_estimado,
        } : null,
      };
    }

    const alContado = modo === 'contado';
    if (!alContado && !fechaVenc) {
      throw new common_1.BadRequestException(
        'Para una factura a credito necesito la fecha de vencimiento. Ej: "factura X 850 vence 30 jun"'
      );
    }

    // Detectar colision (solo si no fue forzado)
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
          datos_parseados: { proveedor_nombre: concepto, monto_total: monto, fecha_vencimiento: fechaVenc, al_contado: alContado },
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

  _parsearMonto(t) {
    const m = t.match(/(\\d{1,3}(?:[\\.,]\\d{3})+(?:[\\.,]\\d{1,2})?|\\d+(?:[\\.,]\\d{1,2})?)/);
    if (!m) return null;
    let s = m[1];
    if (s.includes('.') && s.includes(',')) {
      const lastDot = s.lastIndexOf('.');
      const lastCom = s.lastIndexOf(',');
      if (lastCom > lastDot) s = s.replace(/\\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      const partes = s.split(',');
      if (partes[partes.length - 1].length <= 2 && partes.length === 2) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes('.')) {
      const partes = s.split('.');
      if (partes.length > 2 || partes[partes.length - 1].length === 3) s = s.replace(/\\./g, '');
    }
    return Number(s);
  }

  _parsearFecha(tUp) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const ano = hoy.getFullYear();
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (/\\bHOY\\b/.test(tUp)) return fmt(hoy);
    if (/\\b(MANANA|MA\\u00d1ANA)\\b/.test(tUp)) { const m = new Date(hoy); m.setDate(m.getDate() + 1); return fmt(m); }
    const matchDias = tUp.match(/(\\d{1,3})\\s+D[I\\u00cd]AS/);
    if (matchDias) { const f = new Date(hoy); f.setDate(f.getDate() + Number(matchDias[1])); return fmt(f); }
    const matchIso = tUp.match(/(20\\d{2})-(\\d{1,2})-(\\d{1,2})/);
    if (matchIso) return matchIso[1] + '-' + matchIso[2].padStart(2, '0') + '-' + matchIso[3].padStart(2, '0');
    const matchSlash = tUp.match(/(\\d{1,2})[\\/\\-](\\d{1,2})(?:[\\/\\-](\\d{2,4}))?/);
    if (matchSlash) {
      const d = Number(matchSlash[1]), m = Number(matchSlash[2]);
      let y = matchSlash[3] ? Number(matchSlash[3]) : ano; if (y < 100) y = 2000 + y;
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        const fecha = new Date(y, m - 1, d);
        if (!matchSlash[3] && fecha < hoy) fecha.setFullYear(y + 1);
        return fmt(fecha);
      }
    }
    const MESES = { ENE: 1, ENERO: 1, FEB: 2, FEBRERO: 2, MAR: 3, MARZO: 3, ABR: 4, ABRIL: 4, MAY: 5, MAYO: 5, JUN: 6, JUNIO: 6, JUL: 7, JULIO: 7, AGO: 8, AGOSTO: 8, SEP: 9, SEPTIEMBRE: 9, OCT: 10, OCTUBRE: 10, NOV: 11, NOVIEMBRE: 11, DIC: 12, DICIEMBRE: 12 };
    const re = new RegExp('(\\\\d{1,2})\\\\s+(?:DE\\\\s+)?(' + Object.keys(MESES).join('|') + ')(?:\\\\s+(\\\\d{2,4}))?');
    const matchEs = tUp.match(re);
    if (matchEs) {
      const d = Number(matchEs[1]), m = MESES[matchEs[2]];
      let y = matchEs[3] ? Number(matchEs[3]) : ano; if (y < 100) y = 2000 + y;
      const fecha = new Date(y, m - 1, d);
      if (!matchEs[3] && fecha < hoy) fecha.setFullYear(y + 1);
      return fmt(fecha);
    }
    return null;
  }
};

CxpService = __decorate([
  (0, common_1.Injectable)(),
  __param(0, (0, typeorm_1.InjectDataSource)()),
  __metadata("design:paramtypes", [typeorm_2.DataSource])
], CxpService);

exports.CxpService = CxpService;
"""

# ────────────────────────── CONTROLLER ──────────────────────────
CONTROLLER = """'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CxpController = void 0;
const common_1 = require("@nestjs/common");
const cxp_service_1 = require("./cxp.service");
const guards_1 = require("../common/guards");
const decorators_1 = require("../common/decorators");
const usuario_entity_1 = require("../auth/entities/usuario.entity");

const __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
const __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
const __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); };
};

function validarBotSecret(secret) {
  const expected = process.env.TELEGRAM_BOT_SHARED_SECRET;
  if (!expected || secret !== expected) throw new common_1.UnauthorizedException('Bot secret invalido');
}

let CxpController = class CxpController {
  constructor(svc) { this.svc = svc; }
  listar(estado, q, proveedor_id, desde, hasta) {
    return this.svc.listar({ estado, q, proveedor_id, desde, hasta });
  }
  resumen() { return this.svc.resumen(); }
  aging()   { return this.svc.aging(); }
  calendario(desde, hasta) { return this.svc.calendario(desde, hasta); }
  obtener(id) { return this.svc.obtener(id); }
  crear(body, user) {
    return this.svc.crear(Object.assign({}, body, { registrado_por_id: user && user.id, registrado_por_nombre: user && user.nombre }));
  }
  actualizar(id, body) { return this.svc.actualizar(id, body); }
  eliminar(id) { return this.svc.eliminar(id); }
  cancelar(id, body) { return this.svc.cancelar(id, body && body.motivo); }
  registrarAbono(id, body, user) {
    return this.svc.registrarAbono(id, Object.assign({}, body, { registrado_por_id: user && user.id, registrado_por_nombre: user && user.nombre }));
  }
  async botFactura(secret, body) {
    validarBotSecret(secret);
    return this.svc.desdeBot(body && body.texto, body && body.chat_id, body && body.modo, body && body.forzar_nuevo);
  }
};

// GET /cxp
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  (0, common_1.Get)(),
  __param(0, (0, common_1.Query)('estado')),
  __param(1, (0, common_1.Query)('q')),
  __param(2, (0, common_1.Query)('proveedor_id')),
  __param(3, (0, common_1.Query)('desde')),
  __param(4, (0, common_1.Query)('hasta')),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [String, String, String, String, String]),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "listar", null);

__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  (0, common_1.Get)('resumen'),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", []),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "resumen", null);

__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  (0, common_1.Get)('aging'),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", []),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "aging", null);

__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  (0, common_1.Get)('calendario'),
  __param(0, (0, common_1.Query)('desde')),
  __param(1, (0, common_1.Query)('hasta')),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [String, String]),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "calendario", null);

__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  (0, common_1.Get)(':id(\\\\d+)'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number]),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "obtener", null);

__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Post)(),
  __param(0, (0, common_1.Body)()),
  __param(1, (0, decorators_1.CurrentUser)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Object, Object]),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "crear", null);

__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Put)(':id(\\\\d+)'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __param(1, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number, Object]),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "actualizar", null);

__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN),
  (0, common_1.Delete)(':id(\\\\d+)'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number]),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "eliminar", null);

__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Post)(':id(\\\\d+)/cancelar'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __param(1, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number, Object]),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "cancelar", null);

__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Post)(':id(\\\\d+)/abono'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __param(1, (0, common_1.Body)()),
  __param(2, (0, decorators_1.CurrentUser)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number, Object, Object]),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "registrarAbono", null);

__decorate([
  (0, common_1.Post)('bot/factura'),
  __param(0, (0, common_1.Headers)('x-bot-secret')),
  __param(1, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [String, Object]),
  __metadata("design:returntype", void 0)
], CxpController.prototype, "botFactura", null);

exports.CxpController = CxpController = __decorate([
  (0, common_1.Controller)('cxp'),
  __metadata("design:paramtypes", [cxp_service_1.CxpService])
], CxpController);
"""

# ────────────────────────── MODULE ──────────────────────────
MODULE = """'use strict';
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CxpModule = void 0;
const common_1 = require("@nestjs/common");
const cxp_service_1 = require("./cxp.service");
const cxp_controller_1 = require("./cxp.controller");

let CxpModule = class CxpModule {};
exports.CxpModule = CxpModule;
exports.CxpModule = CxpModule = __decorate([
    (0, common_1.Module)({
        providers: [cxp_service_1.CxpService],
        controllers: [cxp_controller_1.CxpController],
        exports: [cxp_service_1.CxpService],
    })
], CxpModule);
"""

open(f'{CXP_DIR}/cxp.service.js',    'w').write(SERVICE)
open(f'{CXP_DIR}/cxp.controller.js', 'w').write(CONTROLLER)
open(f'{CXP_DIR}/cxp.module.js',     'w').write(MODULE)

# Registrar en app.module.js
APP_MOD = f'{DIST}/app.module.js'
a = open(APP_MOD).read()
if 'CxpModule' not in a:
    a = a.replace(
        'const compromisos_module_1 = require("./compromisos/compromisos.module");',
        'const compromisos_module_1 = require("./compromisos/compromisos.module");\nconst cxp_module_1 = require("./cxp/cxp.module");'
    )
    a = a.replace(
        'compromisos_module_1.CompromisosModule,',
        'compromisos_module_1.CompromisosModule,\n            cxp_module_1.CxpModule,'
    )
    open(APP_MOD, 'w').write(a)
    print('CxpModule registrado en app.module.js')
else:
    print('CxpModule ya estaba registrado.')

print('OK: modulo CxP instalado.')
