"""Reescribe compromisos.service.js limpio con: InjectDataSource, alias,
helper _upper, mayusculas en crear/actualizar, y pagarPorBot."""

SVC = '/home/u372536694/apps/api/dist/compromisos/compromisos.service.js'

contenido = """'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompromisosService = void 0;
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

let CompromisosService = class CompromisosService {
  constructor(ds) {
    this.ds = ds;
  }

  async listar() {
    return this.ds.query("SELECT * FROM compromisos_recurrentes ORDER BY activo DESC, nombre ASC");
  }

  async obtener(id) {
    const [c] = await this.ds.query("SELECT * FROM compromisos_recurrentes WHERE id = ?", [id]);
    if (!c) throw new common_1.NotFoundException("Compromiso #" + id + " no encontrado");
    return c;
  }

  async crear(dto) {
    if (!dto.nombre) throw new common_1.BadRequestException('Nombre es requerido');
    if (!dto.frecuencia) throw new common_1.BadRequestException('Frecuencia es requerida');
    const r = await this.ds.query(
      "INSERT INTO compromisos_recurrentes " +
      "(nombre, alias, categoria, clasificacion_contable, monto_estimado, frecuencia, " +
      " dia_vencimiento, proveedor, descripcion, metodo_pago_default, cuenta_banco_id, " +
      " recordar_dias_antes, activo, fecha_inicio, fecha_fin, creado_por) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        _upper(dto.nombre),
        _upper(dto.alias) || null,
        _upper(dto.categoria || 'otros'),
        dto.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
        Number(dto.monto_estimado) || 0,
        dto.frecuencia,
        dto.dia_vencimiento != null ? Number(dto.dia_vencimiento) : null,
        _upper(dto.proveedor) || null,
        _upper(dto.descripcion) || null,
        dto.metodo_pago_default || null,
        dto.cuenta_banco_id || null,
        Number(dto.recordar_dias_antes) || 5,
        dto.activo === false ? 0 : 1,
        dto.fecha_inicio || null,
        dto.fecha_fin || null,
        dto.creado_por || null,
      ]
    );
    const id = r.insertId;
    await this.regenerarOcurrencias(id);
    return this.obtener(id);
  }

  async actualizar(id, dto) {
    await this.obtener(id);
    const campos = ['nombre','alias','categoria','clasificacion_contable','monto_estimado',
      'frecuencia','dia_vencimiento','proveedor','descripcion','metodo_pago_default',
      'cuenta_banco_id','recordar_dias_antes','activo','fecha_inicio','fecha_fin'];
    const camposTexto = new Set(['nombre','alias','categoria','proveedor','descripcion']);
    const sets = [];
    const params = [];
    for (const k of campos) {
      if (dto[k] !== undefined) {
        sets.push("`" + k + "` = ?");
        let v = dto[k];
        if (k === 'activo') v = v === false || v === 0 ? 0 : 1;
        if (k === 'clasificacion_contable') v = v === 'costo' ? 'costo' : 'gasto';
        if (camposTexto.has(k)) v = _upper(v);
        if (v === '') v = null;
        params.push(v);
      }
    }
    if (sets.length) {
      params.push(id);
      await this.ds.query("UPDATE compromisos_recurrentes SET " + sets.join(', ') + " WHERE id = ?", params);
    }
    await this.regenerarOcurrencias(id);
    return this.obtener(id);
  }

  async eliminar(id) {
    await this.obtener(id);
    await this.ds.query("UPDATE compromisos_recurrentes SET activo = 0 WHERE id = ?", [id]);
    await this.ds.query(
      "UPDATE compromisos_ocurrencias SET estado = 'cancelado' " +
      "WHERE compromiso_id = ? AND estado = 'pendiente' AND fecha_vencimiento >= CURDATE()",
      [id]
    );
    return { ok: true };
  }

  async regenerarOcurrencias(compromisoId) {
    const c = await this.obtener(compromisoId);
    if (!c.activo) return;
    await this.ds.query(
      "DELETE FROM compromisos_ocurrencias " +
      "WHERE compromiso_id = ? AND estado = 'pendiente' AND fecha_vencimiento >= CURDATE()",
      [compromisoId]
    );
    const fechas = this.generarFechas(c);
    if (!fechas.length) return;
    const values = fechas.map(() => '(?,?,?)').join(',');
    const params = [];
    for (const f of fechas) {
      params.push(compromisoId, f, Number(c.monto_estimado) || 0);
    }
    await this.ds.query(
      "INSERT IGNORE INTO compromisos_ocurrencias (compromiso_id, fecha_vencimiento, monto_estimado) VALUES " + values,
      params
    );
  }

  generarFechas(c) {
    const fechas = [];
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    const inicio = c.fecha_inicio ? new Date(c.fecha_inicio + 'T00:00:00') : hoy;
    const limite = c.fecha_fin
      ? new Date(c.fecha_fin + 'T00:00:00')
      : new Date(hoy.getFullYear()+1, hoy.getMonth(), hoy.getDate());
    const desde = inicio < hoy ? hoy : inicio;
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const dia = c.dia_vencimiento != null ? Number(c.dia_vencimiento) : null;

    if (c.frecuencia === 'mensual') {
      let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
        const d = Math.min(dia || 1, ultDia);
        const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
        if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        cur.setMonth(cur.getMonth()+1);
      }
    } else if (c.frecuencia === 'quincenal') {
      let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      const dias = dia ? [dia, dia+15 > 28 ? 15 : dia+15] : [1, 15];
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
        for (const dd of dias) {
          const d = Math.min(dd, ultDia);
          const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
          if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        }
        cur.setMonth(cur.getMonth()+1);
      }
    } else if (c.frecuencia === 'semanal') {
      const dow = dia != null ? dia : 5;
      const cur = new Date(desde);
      while (cur.getDay() !== dow) cur.setDate(cur.getDate()+1);
      while (cur <= limite) {
        fechas.push(fmt(cur));
        cur.setDate(cur.getDate()+7);
      }
    } else if (c.frecuencia === 'bimensual') {
      let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
        const d = Math.min(dia || 1, ultDia);
        const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
        if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        cur.setMonth(cur.getMonth()+2);
      }
    } else if (c.frecuencia === 'trimestral') {
      let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
        const d = Math.min(dia || 1, ultDia);
        const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
        if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        cur.setMonth(cur.getMonth()+3);
      }
    } else if (c.frecuencia === 'anual') {
      const cur = new Date(inicio);
      while (cur <= limite) {
        if (cur >= desde) fechas.push(fmt(cur));
        cur.setFullYear(cur.getFullYear()+1);
      }
    } else if (c.frecuencia === 'unica') {
      if (inicio >= desde && inicio <= limite) fechas.push(fmt(inicio));
    }
    return fechas;
  }

  async calendario(desde, hasta) {
    if (!desde || !hasta) {
      const hoy = new Date();
      const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth()+2, 0);
      desde = ini.toISOString().slice(0,10);
      hasta = fin.toISOString().slice(0,10);
    }
    return this.ds.query(
      "SELECT o.id, o.compromiso_id, o.fecha_vencimiento, o.monto_estimado, o.monto_pagado, " +
      "  o.estado, o.fecha_pago, o.metodo_pago, o.gasto_id, o.egreso_id, o.notas, o.pagado_por, " +
      "  c.nombre, c.categoria, c.clasificacion_contable, c.proveedor, c.recordar_dias_antes " +
      "FROM compromisos_ocurrencias o " +
      "JOIN compromisos_recurrentes c ON c.id = o.compromiso_id " +
      "WHERE o.fecha_vencimiento BETWEEN ? AND ? " +
      "ORDER BY o.fecha_vencimiento ASC, c.nombre ASC",
      [desde, hasta]
    );
  }

  async alertas() {
    const vencidas = await this.ds.query(
      "SELECT o.*, c.nombre, c.categoria, c.proveedor, c.recordar_dias_antes " +
      "FROM compromisos_ocurrencias o " +
      "JOIN compromisos_recurrentes c ON c.id = o.compromiso_id " +
      "WHERE o.estado = 'pendiente' AND o.fecha_vencimiento < CURDATE() AND c.activo = 1 " +
      "ORDER BY o.fecha_vencimiento ASC"
    );
    const proximas = await this.ds.query(
      "SELECT o.*, c.nombre, c.categoria, c.proveedor, c.recordar_dias_antes " +
      "FROM compromisos_ocurrencias o " +
      "JOIN compromisos_recurrentes c ON c.id = o.compromiso_id " +
      "WHERE o.estado = 'pendiente' AND o.fecha_vencimiento >= CURDATE() " +
      "  AND o.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL c.recordar_dias_antes DAY) " +
      "  AND c.activo = 1 " +
      "ORDER BY o.fecha_vencimiento ASC"
    );
    return { vencidas, proximas };
  }

  async marcarPagada(ocurrenciaId, dto) {
    const [oc] = await this.ds.query(
      "SELECT o.*, c.nombre, c.categoria, c.clasificacion_contable, c.proveedor " +
      "FROM compromisos_ocurrencias o " +
      "JOIN compromisos_recurrentes c ON c.id = o.compromiso_id " +
      "WHERE o.id = ?",
      [ocurrenciaId]
    );
    if (!oc) throw new common_1.NotFoundException("Ocurrencia #" + ocurrenciaId + " no encontrada");
    if (oc.estado === 'pagado') throw new common_1.BadRequestException('Este compromiso ya fue pagado');

    const monto = Number(dto.monto_pagado);
    if (!monto || monto <= 0) throw new common_1.BadRequestException('Monto pagado debe ser mayor a 0');

    const fechaPago = dto.fecha_pago || new Date().toISOString().slice(0,10);
    const metodo = dto.metodo_pago || 'efectivo';
    const usuarioId = dto.usuario_id || null;
    const usuarioNombre = dto.usuario_nombre || 'Sistema';

    let gastoId = null;
    let egresoId = null;

    if (metodo === 'efectivo') {
      const r = await this.ds.query(
        "INSERT INTO egresos_caja " +
        "(fecha, monto, destinatario, categoria, comentario, registrado_por, sesion_caja_id, clasificacion_contable) " +
        "VALUES (?,?,?,?,?,?, " +
        "  (SELECT id FROM sesiones_caja WHERE estado='abierta' AND usuario_nombre = ? ORDER BY id DESC LIMIT 1), " +
        "  ?)",
        [
          fechaPago,
          monto,
          oc.proveedor || oc.nombre,
          oc.categoria || 'otros',
          'Pago de compromiso: ' + oc.nombre,
          usuarioNombre,
          usuarioNombre,
          oc.clasificacion_contable,
        ]
      );
      egresoId = r.insertId;
    } else {
      const r = await this.ds.query(
        "INSERT INTO gastos " +
        "(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, " +
        " metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) " +
        "VALUES ('informal', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrado', ?)",
        [
          oc.clasificacion_contable,
          fechaPago,
          monto,
          'Pago de compromiso: ' + oc.nombre,
          oc.categoria || 'Otros',
          oc.proveedor || null,
          metodo,
          usuarioId || 1,
          usuarioNombre,
          dto.notas || null,
        ]
      );
      gastoId = r.insertId;
    }

    await this.ds.query(
      "UPDATE compromisos_ocurrencias " +
      "SET estado='pagado', monto_pagado=?, fecha_pago=?, metodo_pago=?, referencia=?, " +
      "    gasto_id=?, egreso_id=?, notas=?, pagado_por=? " +
      "WHERE id = ?",
      [monto, fechaPago, metodo, dto.referencia || null, gastoId, egresoId, dto.notas || null, usuarioNombre, ocurrenciaId]
    );

    return { ok: true, gasto_id: gastoId, egreso_id: egresoId, monto, estado: 'pagado' };
  }

  async deshacerPago(ocurrenciaId) {
    const [oc] = await this.ds.query("SELECT * FROM compromisos_ocurrencias WHERE id = ?", [ocurrenciaId]);
    if (!oc) throw new common_1.NotFoundException("Ocurrencia #" + ocurrenciaId + " no encontrada");
    if (oc.estado !== 'pagado') throw new common_1.BadRequestException('No esta marcado como pagado');
    if (oc.gasto_id) await this.ds.query("DELETE FROM gastos WHERE id = ?", [oc.gasto_id]);
    if (oc.egreso_id) await this.ds.query("DELETE FROM egresos_caja WHERE id = ?", [oc.egreso_id]);
    await this.ds.query(
      "UPDATE compromisos_ocurrencias " +
      "SET estado='pendiente', monto_pagado=NULL, fecha_pago=NULL, metodo_pago=NULL, " +
      "    gasto_id=NULL, egreso_id=NULL, pagado_por=NULL " +
      "WHERE id = ?",
      [ocurrenciaId]
    );
    return { ok: true };
  }

  async cancelarOcurrencia(ocurrenciaId, motivo) {
    await this.ds.query(
      "UPDATE compromisos_ocurrencias " +
      "SET estado='cancelado', notas = CONCAT(IFNULL(notas,''), CHAR(10), 'Cancelada: ', ?) " +
      "WHERE id = ? AND estado = 'pendiente'",
      [motivo || 'sin motivo', ocurrenciaId]
    );
    return { ok: true };
  }

  async pagarPorBot(texto, chatId) {
    if (!texto) throw new common_1.BadRequestException('Texto vacio');
    if (!chatId) throw new common_1.BadRequestException('chat_id requerido');

    // 1) Resolver usuario por chatId
    const [vinc] = await this.ds.query(
      "SELECT v.usuario_id, u.nombre AS usuario_nombre, u.rol " +
      "FROM telegram_vinculaciones v " +
      "JOIN usuarios u ON u.id = v.usuario_id " +
      "WHERE v.chat_id = ? LIMIT 1",
      [String(chatId)]
    );
    if (!vinc) throw new common_1.UnauthorizedException('Chat no vinculado al ERP');
    if (vinc.rol !== 'admin') {
      throw new common_1.ForbiddenException('Solo el admin puede registrar pagos por el bot');
    }

    // 2) Parsear texto: metodo, monto y palabras
    const t = String(texto).trim().toUpperCase();

    let metodoPago = 'efectivo';
    if (/(TRANSFERENCIA|TRANSFER|TRF)/.test(t)) metodoPago = 'transferencia';
    else if (/(CHEQUE)/.test(t)) metodoPago = 'cheque';
    else if (/(TARJETA)/.test(t)) metodoPago = 'tarjeta';

    // Extraer monto: 4567, 4,567, 4567.50, 25,000.00, 25.000,50
    const matchMonto = t.match(/(\\d{1,3}(?:[\\.,]\\d{3})+(?:[\\.,]\\d{1,2})?|\\d+(?:[\\.,]\\d{1,2})?)/);
    if (!matchMonto) {
      throw new common_1.BadRequestException('No detecte el monto. Ejemplo: "pago luz 4567"');
    }
    let montoStr = matchMonto[1];
    if (montoStr.includes('.') && montoStr.includes(',')) {
      const lastDot = montoStr.lastIndexOf('.');
      const lastCom = montoStr.lastIndexOf(',');
      if (lastCom > lastDot) montoStr = montoStr.replace(/\\./g, '').replace(',', '.');
      else montoStr = montoStr.replace(/,/g, '');
    } else if (montoStr.includes(',')) {
      const partes = montoStr.split(',');
      if (partes[partes.length - 1].length <= 2 && partes.length === 2) {
        montoStr = montoStr.replace(',', '.');
      } else {
        montoStr = montoStr.replace(/,/g, '');
      }
    } else if (montoStr.includes('.')) {
      const partes = montoStr.split('.');
      const ultimo = partes[partes.length - 1];
      if (partes.length > 2 || ultimo.length === 3) {
        montoStr = montoStr.replace(/\\./g, '');
      }
    }
    const monto = Number(montoStr);
    if (!monto || monto <= 0) {
      throw new common_1.BadRequestException('Monto invalido: ' + montoStr);
    }

    // 3) Quitar accion, metodo y monto, dejar palabras candidatas
    const textoSinAccion = t
      .replace(/\\b(PAGO|PAGUE|PAGAR|EFECTIVO|TRANSFERENCIA|TRANSFER|TRF|CHEQUE|TARJETA|CASH|DE|LA|EL|LOS|LAS|CON|POR)\\b/g, ' ')
      .split(matchMonto[0]).join(' ')
      .replace(/[^A-Z\\s]/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const palabras = textoSinAccion.split(' ').filter(p => p.length >= 3);

    // 4) Encontrar mejor compromiso activo por coincidencia de alias
    const candidatos = await this.ds.query(
      "SELECT id, nombre, alias, proveedor, monto_estimado, categoria " +
      "FROM compromisos_recurrentes WHERE activo = 1 AND alias IS NOT NULL AND alias != ''"
    );
    let mejor = null;
    let mejorScore = 0;
    for (const c of candidatos) {
      const aliasArr = String(c.alias).toUpperCase().split(',').map(a => a.trim()).filter(Boolean);
      let score = 0;
      for (const p of palabras) {
        if (aliasArr.includes(p)) score += 3;
        else if (aliasArr.some(a => a.length >= 3 && (a.includes(p) || p.includes(a)))) score += 1;
      }
      if (score > mejorScore) { mejorScore = score; mejor = c; }
    }
    if (!mejor || mejorScore === 0) {
      const lista = candidatos.map(c => '  - ' + c.nombre + ' (alias: ' + (c.alias || '?') + ')').join('\\n');
      throw new common_1.NotFoundException(
        'No identifique a que compromiso te refieres.\\nCompromisos activos:\\n' + (lista || '  (ninguno con alias)')
      );
    }

    // 5) Buscar proxima ocurrencia pendiente
    const [ocurr] = await this.ds.query(
      "SELECT id, fecha_vencimiento, monto_estimado FROM compromisos_ocurrencias " +
      "WHERE compromiso_id = ? AND estado = 'pendiente' " +
      "ORDER BY fecha_vencimiento ASC LIMIT 1",
      [mejor.id]
    );
    if (!ocurr) {
      throw new common_1.NotFoundException(mejor.nombre + ' no tiene ocurrencias pendientes');
    }

    // 6) Marcar pagada (delega en el metodo existente)
    const res = await this.marcarPagada(ocurr.id, {
      monto_pagado: monto,
      fecha_pago: new Date().toISOString().slice(0, 10),
      metodo_pago: metodoPago,
      notas: 'Registrado via bot Telegram. Texto: "' + texto + '"',
      usuario_id: vinc.usuario_id,
      usuario_nombre: vinc.usuario_nombre,
    });

    return {
      ok: true,
      compromiso: mejor.nombre,
      proveedor: mejor.proveedor,
      monto_pagado: monto,
      metodo_pago: metodoPago,
      fecha_vencimiento: ocurr.fecha_vencimiento,
      diferencia: monto - Number(ocurr.monto_estimado),
      egreso_id: res.egreso_id,
      gasto_id: res.gasto_id,
    };
  }
};

CompromisosService = __decorate([
  (0, common_1.Injectable)(),
  __param(0, (0, typeorm_1.InjectDataSource)()),
  __metadata("design:paramtypes", [typeorm_2.DataSource])
], CompromisosService);

exports.CompromisosService = CompromisosService;
"""

open(SVC, 'w').write(contenido)
print('OK: compromisos.service.js reescrito limpio.')
