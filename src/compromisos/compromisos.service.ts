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

@Injectable()
export class CompromisosService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async listar(): Promise<any[]> {
    return this.ds.query(
      'SELECT * FROM compromisos_recurrentes ORDER BY activo DESC, nombre ASC',
    );
  }

  async obtener(id: number): Promise<any> {
    const [c] = await this.ds.query(
      'SELECT * FROM compromisos_recurrentes WHERE id = ?',
      [id],
    );
    if (!c) throw new NotFoundException(`Compromiso #${id} no encontrado`);
    return c;
  }

  async crear(dto: any): Promise<any> {
    if (!dto.nombre) throw new BadRequestException('Nombre es requerido');
    if (!dto.frecuencia) throw new BadRequestException('Frecuencia es requerida');
    const r = await this.ds.query(
      'INSERT INTO compromisos_recurrentes ' +
        '(nombre, alias, categoria, clasificacion_contable, monto_estimado, frecuencia, ' +
        ' dia_vencimiento, proveedor, descripcion, metodo_pago_default, cuenta_banco_id, ' +
        ' recordar_dias_antes, activo, fecha_inicio, fecha_fin, creado_por) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
      ],
    );
    const id = r.insertId;
    await this.regenerarOcurrencias(id);
    return this.obtener(id);
  }

  async actualizar(id: number, dto: any): Promise<any> {
    await this.obtener(id);
    const campos = [
      'nombre', 'alias', 'categoria', 'clasificacion_contable', 'monto_estimado',
      'frecuencia', 'dia_vencimiento', 'proveedor', 'descripcion', 'metodo_pago_default',
      'cuenta_banco_id', 'recordar_dias_antes', 'activo', 'fecha_inicio', 'fecha_fin',
    ];
    const camposTexto = new Set(['nombre', 'alias', 'categoria', 'proveedor', 'descripcion']);
    const sets: string[] = [];
    const params: any[] = [];
    for (const k of campos) {
      if (dto[k] !== undefined) {
        sets.push('`' + k + '` = ?');
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
      await this.ds.query(
        `UPDATE compromisos_recurrentes SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    await this.regenerarOcurrencias(id);
    return this.obtener(id);
  }

  async eliminar(id: number): Promise<{ ok: boolean }> {
    await this.obtener(id);
    await this.ds.query(
      'UPDATE compromisos_recurrentes SET activo = 0 WHERE id = ?',
      [id],
    );
    await this.ds.query(
      "UPDATE compromisos_ocurrencias SET estado = 'cancelado' " +
        "WHERE compromiso_id = ? AND estado = 'pendiente' AND fecha_vencimiento >= CURDATE()",
      [id],
    );
    return { ok: true };
  }

  async regenerarOcurrencias(compromisoId: number): Promise<void> {
    const c = await this.obtener(compromisoId);
    if (!c.activo) return;
    await this.ds.query(
      'DELETE FROM compromisos_ocurrencias ' +
        "WHERE compromiso_id = ? AND estado = 'pendiente' AND fecha_vencimiento >= CURDATE()",
      [compromisoId],
    );
    const fechas = this.generarFechas(c);
    if (!fechas.length) return;
    const values = fechas.map(() => '(?,?,?)').join(',');
    const params: any[] = [];
    for (const f of fechas) {
      params.push(compromisoId, f, Number(c.monto_estimado) || 0);
    }
    await this.ds.query(
      'INSERT IGNORE INTO compromisos_ocurrencias (compromiso_id, fecha_vencimiento, monto_estimado) VALUES ' +
        values,
      params,
    );
  }

  generarFechas(c: any): string[] {
    const fechas: string[] = [];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const toLocalDate = (v: any): Date | null => {
      if (!v) return null;
      if (v instanceof Date) {
        return new Date(v.getFullYear(), v.getMonth(), v.getDate());
      }
      const str = String(v).slice(0, 10);
      const partes = str.split('-');
      if (partes.length === 3) {
        return new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
      }
      return new Date(str + 'T00:00:00');
    };

    const inicio = toLocalDate(c.fecha_inicio) || hoy;
    const limite = toLocalDate(c.fecha_fin)
      || new Date(hoy.getFullYear() + 1, hoy.getMonth(), hoy.getDate());

    const desde = inicio < hoy ? hoy : inicio;
    const fmt = (d: Date): string =>
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dia: number | null = c.dia_vencimiento != null ? Number(c.dia_vencimiento) : null;

    if (c.frecuencia === 'mensual') {
      const cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
        const d = Math.min(dia || 1, ultDia);
        const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
        if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        cur.setMonth(cur.getMonth() + 1);
      }
    } else if (c.frecuencia === 'quincenal') {
      const cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      const dias = dia ? [dia, dia + 15 > 28 ? 15 : dia + 15] : [1, 15];
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
        for (const dd of dias) {
          const d = Math.min(dd, ultDia);
          const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
          if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        }
        cur.setMonth(cur.getMonth() + 1);
      }
    } else if (c.frecuencia === 'semanal') {
      const dow = dia != null ? dia : 5;
      const cur = new Date(desde);
      while (cur.getDay() !== dow) cur.setDate(cur.getDate() + 1);
      while (cur <= limite) {
        fechas.push(fmt(cur));
        cur.setDate(cur.getDate() + 7);
      }
    } else if (c.frecuencia === 'bimensual') {
      const cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
        const d = Math.min(dia || 1, ultDia);
        const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
        if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        cur.setMonth(cur.getMonth() + 2);
      }
    } else if (c.frecuencia === 'trimestral') {
      const cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
        const d = Math.min(dia || 1, ultDia);
        const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
        if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        cur.setMonth(cur.getMonth() + 3);
      }
    } else if (c.frecuencia === 'anual') {
      const cur = new Date(inicio);
      while (cur <= limite) {
        if (cur >= desde) fechas.push(fmt(cur));
        cur.setFullYear(cur.getFullYear() + 1);
      }
    } else if (c.frecuencia === 'unica') {
      if (inicio >= desde && inicio <= limite) fechas.push(fmt(inicio));
    }
    return fechas;
  }

  async calendario(desde?: string, hasta?: string): Promise<any[]> {
    if (!desde || !hasta) {
      const hoy = new Date();
      const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 0);
      desde = ini.toISOString().slice(0, 10);
      hasta = fin.toISOString().slice(0, 10);
    }
    return this.ds.query(
      'SELECT o.id, o.compromiso_id, o.fecha_vencimiento, o.monto_estimado, o.monto_pagado, ' +
        '  o.estado, o.fecha_pago, o.metodo_pago, o.gasto_id, o.egreso_id, o.notas, o.pagado_por, ' +
        '  c.nombre, c.categoria, c.clasificacion_contable, c.proveedor, c.recordar_dias_antes, c.frecuencia ' +
        'FROM compromisos_ocurrencias o ' +
        'JOIN compromisos_recurrentes c ON c.id = o.compromiso_id ' +
        'WHERE o.fecha_vencimiento BETWEEN ? AND ? ' +
        'ORDER BY o.fecha_vencimiento ASC, c.nombre ASC',
      [desde, hasta],
    );
  }

  async alertas(): Promise<{ vencidas: any[]; proximas: any[] }> {
    const vencidas = await this.ds.query(
      'SELECT o.*, c.nombre, c.categoria, c.proveedor, c.recordar_dias_antes, c.frecuencia ' +
        'FROM compromisos_ocurrencias o ' +
        'JOIN compromisos_recurrentes c ON c.id = o.compromiso_id ' +
        "WHERE o.estado = 'pendiente' AND o.fecha_vencimiento < CURDATE() AND c.activo = 1 " +
        'ORDER BY o.fecha_vencimiento ASC',
    );
    const proximas = await this.ds.query(
      'SELECT o.*, c.nombre, c.categoria, c.proveedor, c.recordar_dias_antes, c.frecuencia ' +
        'FROM compromisos_ocurrencias o ' +
        'JOIN compromisos_recurrentes c ON c.id = o.compromiso_id ' +
        "WHERE o.estado = 'pendiente' AND o.fecha_vencimiento >= CURDATE() " +
        '  AND o.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL c.recordar_dias_antes DAY) ' +
        '  AND c.activo = 1 ' +
        'ORDER BY o.fecha_vencimiento ASC',
    );
    return { vencidas, proximas };
  }

  async marcarPagada(ocurrenciaId: number, dto: any): Promise<any> {
    const [oc] = await this.ds.query(
      'SELECT o.*, c.nombre, c.categoria, c.clasificacion_contable, c.proveedor ' +
        'FROM compromisos_ocurrencias o ' +
        'JOIN compromisos_recurrentes c ON c.id = o.compromiso_id ' +
        'WHERE o.id = ?',
      [ocurrenciaId],
    );
    if (!oc) throw new NotFoundException(`Ocurrencia #${ocurrenciaId} no encontrada`);
    if (oc.estado === 'pagado') throw new BadRequestException('Este compromiso ya fue pagado');

    const monto = Number(dto.monto_pagado);
    if (!monto || monto <= 0) throw new BadRequestException('Monto pagado debe ser mayor a 0');

    const fechaPago = dto.fecha_pago || new Date().toISOString().slice(0, 10);
    const metodo = dto.metodo_pago || 'efectivo';
    const usuarioId = dto.usuario_id || null;
    const usuarioNombre = dto.usuario_nombre || 'Sistema';

    let gastoId: number | null = null;
    const egresoId: number | null = null;

    const r = await this.ds.query(
      'INSERT INTO gastos ' +
        '(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, ' +
        ' metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) ' +
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
      ],
    );
    gastoId = r.insertId;

    await this.ds.query(
      'UPDATE compromisos_ocurrencias ' +
        "SET estado='pagado', monto_pagado=?, fecha_pago=?, metodo_pago=?, referencia=?, " +
        '    gasto_id=?, egreso_id=?, notas=?, pagado_por=? ' +
        'WHERE id = ?',
      [monto, fechaPago, metodo, dto.referencia || null, gastoId, egresoId, dto.notas || null, usuarioNombre, ocurrenciaId],
    );

    return { ok: true, gasto_id: gastoId, egreso_id: egresoId, monto, estado: 'pagado' };
  }

  async deshacerPago(ocurrenciaId: number): Promise<{ ok: boolean }> {
    const [oc] = await this.ds.query(
      'SELECT * FROM compromisos_ocurrencias WHERE id = ?',
      [ocurrenciaId],
    );
    if (!oc) throw new NotFoundException(`Ocurrencia #${ocurrenciaId} no encontrada`);
    if (oc.estado !== 'pagado') throw new BadRequestException('No esta marcado como pagado');
    if (oc.gasto_id) await this.ds.query('DELETE FROM gastos WHERE id = ?', [oc.gasto_id]);
    if (oc.egreso_id) await this.ds.query('DELETE FROM egresos_caja WHERE id = ?', [oc.egreso_id]);
    await this.ds.query(
      'UPDATE compromisos_ocurrencias ' +
        "SET estado='pendiente', monto_pagado=NULL, fecha_pago=NULL, metodo_pago=NULL, " +
        '    gasto_id=NULL, egreso_id=NULL, pagado_por=NULL ' +
        'WHERE id = ?',
      [ocurrenciaId],
    );
    return { ok: true };
  }

  async cancelarOcurrencia(ocurrenciaId: number, motivo?: string): Promise<{ ok: boolean }> {
    await this.ds.query(
      'UPDATE compromisos_ocurrencias ' +
        "SET estado='cancelado', notas = CONCAT(IFNULL(notas,''), CHAR(10), 'Cancelada: ', ?) " +
        "WHERE id = ? AND estado = 'pendiente'",
      [motivo || 'sin motivo', ocurrenciaId],
    );
    return { ok: true };
  }

  async pagarPorBot(texto: string, chatId: string | number): Promise<any> {
    if (!texto) throw new BadRequestException('Texto vacio');
    if (!chatId) throw new BadRequestException('chat_id requerido');

    const [vinc] = await this.ds.query(
      'SELECT v.usuario_id, u.nombre AS usuario_nombre, u.rol ' +
        'FROM telegram_usuarios v JOIN usuarios u ON u.id = v.usuario_id ' +
        'WHERE v.chat_id = ? LIMIT 1',
      [String(chatId)],
    );
    if (!vinc) throw new UnauthorizedException('Chat no vinculado al ERP');
    if (vinc.rol !== 'admin') {
      throw new ForbiddenException('Solo el admin puede registrar pagos por el bot');
    }

    const t = String(texto).trim().toUpperCase();
    let metodoPago: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' = 'efectivo';
    if (/(TRANSFERENCIA|TRANSFER|TRF)/.test(t)) metodoPago = 'transferencia';
    else if (/(CHEQUE)/.test(t)) metodoPago = 'cheque';
    else if (/(TARJETA)/.test(t)) metodoPago = 'tarjeta';

    const matchMonto = t.match(/(\d{1,3}(?:[\.,]\d{3})+(?:[\.,]\d{1,2})?|\d+(?:[\.,]\d{1,2})?)/);
    if (!matchMonto) {
      throw new BadRequestException('No detecte el monto. Ejemplo: "pago luz 4567"');
    }
    let montoStr = matchMonto[1];
    if (montoStr.includes('.') && montoStr.includes(',')) {
      const lastDot = montoStr.lastIndexOf('.');
      const lastCom = montoStr.lastIndexOf(',');
      if (lastCom > lastDot) montoStr = montoStr.replace(/\./g, '').replace(',', '.');
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
      if (partes.length > 2 || partes[partes.length - 1].length === 3) {
        montoStr = montoStr.replace(/\./g, '');
      }
    }
    const monto = Number(montoStr);
    if (!monto || monto <= 0) throw new BadRequestException('Monto invalido: ' + montoStr);

    const textoSinAccion = t
      .replace(/\b(PAGO|PAGUE|PAGAR|EFECTIVO|TRANSFERENCIA|TRANSFER|TRF|CHEQUE|TARJETA|CASH|DE|LA|EL|LOS|LAS|CON|POR)\b/g, ' ')
      .split(matchMonto[0]).join(' ')
      .replace(/[^A-Z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const palabras = textoSinAccion.split(' ').filter((p: string) => p.length >= 3);

    const candidatos = await this.ds.query(
      'SELECT id, nombre, alias, proveedor, monto_estimado, categoria ' +
        "FROM compromisos_recurrentes WHERE activo = 1 AND alias IS NOT NULL AND alias != ''",
    );
    let mejor: any = null;
    let mejorScore = 0;
    for (const c of candidatos) {
      const aliasArr = String(c.alias).toUpperCase().split(',').map((a: string) => a.trim()).filter(Boolean);
      let score = 0;
      for (const p of palabras) {
        if (aliasArr.includes(p)) score += 3;
        else if (aliasArr.some((a: string) => a.length >= 3 && (a.includes(p) || p.includes(a)))) score += 1;
      }
      if (score > mejorScore) { mejorScore = score; mejor = c; }
    }
    if (!mejor || mejorScore === 0) {
      const lista = candidatos.map((c: any) => '  - ' + c.nombre + ' (alias: ' + (c.alias || '?') + ')').join('\n');
      throw new NotFoundException(
        'No identifique a que compromiso te refieres.\nCompromisos activos:\n' + (lista || '  (ninguno con alias)'),
      );
    }

    const [ocurr] = await this.ds.query(
      'SELECT id, fecha_vencimiento, monto_estimado FROM compromisos_ocurrencias ' +
        "WHERE compromiso_id = ? AND estado = 'pendiente' " +
        'ORDER BY fecha_vencimiento ASC LIMIT 1',
      [mejor.id],
    );
    if (!ocurr) {
      throw new NotFoundException(mejor.nombre + ' no tiene ocurrencias pendientes');
    }

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

  // ─── Cuentas por pagar (compromisos unicos a credito) ──────────────────────

  async crearCuentaPorPagar(dto: any): Promise<any> {
    if (!dto.nombre) throw new BadRequestException('Concepto requerido');
    if (!dto.monto || Number(dto.monto) <= 0) throw new BadRequestException('Monto invalido');
    if (!dto.fecha_vencimiento) throw new BadRequestException('Fecha de vencimiento requerida');

    const colision = await this._detectarColisionRecurrente(dto.nombre);
    if (colision && !dto.forzar_nuevo) {
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
        mensaje:
          'Ya existe un compromiso recurrente parecido. Confirma si es el pago del mes o una factura nueva.',
      };
    }

    const compromiso = await this.crear({
      nombre: dto.nombre,
      alias: dto.alias || null,
      categoria: dto.categoria || 'otros',
      clasificacion_contable: dto.clasificacion_contable || 'gasto',
      monto_estimado: Number(dto.monto),
      frecuencia: 'unica',
      dia_vencimiento: null,
      proveedor: dto.proveedor || null,
      descripcion: dto.descripcion || 'Cuenta por pagar registrada el ' + new Date().toISOString().slice(0, 10),
      metodo_pago_default: null,
      recordar_dias_antes: dto.recordar_dias_antes || 3,
      fecha_inicio: dto.fecha_vencimiento,
      fecha_fin: dto.fecha_vencimiento,
      activo: true,
      creado_por: dto.creado_por || null,
    });

    return {
      ok: true,
      colision: false,
      compromiso_id: compromiso.id,
      nombre: compromiso.nombre,
      monto: compromiso.monto_estimado,
      fecha_vencimiento: dto.fecha_vencimiento,
    };
  }

  async _detectarColisionRecurrente(concepto: string): Promise<any> {
    const candidatos = await this.ds.query(
      'SELECT id, nombre, alias, frecuencia, monto_estimado ' +
        "FROM compromisos_recurrentes WHERE activo = 1 AND frecuencia != 'unica'",
    );
    const conc = String(concepto).toUpperCase();
    const palabrasConc = conc.split(/\s+/).filter((p: string) => p.length >= 3);

    for (const c of candidatos) {
      const aliasArr = c.alias
        ? String(c.alias).toUpperCase().split(',').map((a: string) => a.trim()).filter(Boolean)
        : [];
      const nombreUp = String(c.nombre).toUpperCase();
      for (const p of palabrasConc) {
        if (aliasArr.includes(p)) return c;
        if (nombreUp.includes(p) && p.length >= 4) return c;
      }
    }
    return null;
  }

  async crearCuentaPorPagarPorBot(texto: string, chatId: string | number, forzarNuevo?: boolean): Promise<any> {
    if (!texto) throw new BadRequestException('Texto vacio');
    if (!chatId) throw new BadRequestException('chat_id requerido');

    const [vinc] = await this.ds.query(
      'SELECT v.usuario_id, u.nombre AS usuario_nombre, u.rol ' +
        'FROM telegram_usuarios v JOIN usuarios u ON u.id = v.usuario_id ' +
        'WHERE v.chat_id = ? LIMIT 1',
      [String(chatId)],
    );
    if (!vinc) throw new UnauthorizedException('Chat no vinculado al ERP');
    if (vinc.rol !== 'admin') {
      throw new ForbiddenException('Solo el admin puede registrar cuentas por pagar');
    }

    const t = String(texto).trim();
    const tUp = t.toUpperCase();

    const matchMonto = tUp.match(/(\d{1,3}(?:[\.,]\d{3})+(?:[\.,]\d{1,2})?|\d+(?:[\.,]\d{1,2})?)/);
    if (!matchMonto) throw new BadRequestException('No detecte el monto');
    let montoStr = matchMonto[1];
    if (montoStr.includes('.') && montoStr.includes(',')) {
      const lastDot = montoStr.lastIndexOf('.');
      const lastCom = montoStr.lastIndexOf(',');
      if (lastCom > lastDot) montoStr = montoStr.replace(/\./g, '').replace(',', '.');
      else montoStr = montoStr.replace(/,/g, '');
    } else if (montoStr.includes(',')) {
      const partes = montoStr.split(',');
      if (partes[partes.length - 1].length <= 2 && partes.length === 2) montoStr = montoStr.replace(',', '.');
      else montoStr = montoStr.replace(/,/g, '');
    } else if (montoStr.includes('.')) {
      const partes = montoStr.split('.');
      if (partes.length > 2 || partes[partes.length - 1].length === 3) montoStr = montoStr.replace(/\./g, '');
    }
    const monto = Number(montoStr);
    if (!monto || monto <= 0) throw new BadRequestException('Monto invalido');

    const fechaVenc = this._parsearFecha(tUp);
    if (!fechaVenc) {
      throw new BadRequestException(
        'No detecte la fecha de vencimiento. Usa "vence DD mes" o "vence DD/MM" o "vence YYYY-MM-DD"',
      );
    }

    const verbos = /\b(FACTURA|DEBER|CREDITO|CRÉDITO|PENDIENTE|POR\s+PAGAR|CUENTA|VENCE|EL|LA|LOS|LAS|DE|DEL|A|EN)\b/g;
    const meses = /\b(ENE|ENERO|FEB|FEBRERO|MAR|MARZO|ABR|ABRIL|MAY|MAYO|JUN|JUNIO|JUL|JULIO|AGO|AGOSTO|SEP|SEPTIEMBRE|OCT|OCTUBRE|NOV|NOVIEMBRE|DIC|DICIEMBRE|MANANA|MAÑANA|HOY|LUNES|MARTES|MIERCOLES|MIÉRCOLES|JUEVES|VIERNES|SABADO|SÁBADO|DOMINGO|DIAS|DÍAS)\b/g;
    let concepto = tUp
      .split(matchMonto[0]).join(' ')
      .replace(verbos, ' ')
      .replace(meses, ' ')
      .replace(/\b\d{1,2}([\/\-]\d{1,2}([\/\-]\d{2,4})?)?\b/g, ' ')
      .replace(/[^A-ZÑÁÉÍÓÚ\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (concepto.length < 2) concepto = 'FACTURA';

    return this.crearCuentaPorPagar({
      nombre: concepto,
      monto,
      fecha_vencimiento: fechaVenc,
      proveedor: null,
      creado_por: vinc.usuario_nombre,
      descripcion: 'Cuenta por pagar via bot. Texto original: "' + texto + '"',
      forzar_nuevo: !!forzarNuevo,
    });
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
}
