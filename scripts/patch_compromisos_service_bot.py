"""Patcha compromisos.service.js para:
1. Soportar campo `alias` al crear/actualizar
2. Agregar metodo pagarPorBot(texto, chatId)
"""
import sys

SVC = '/home/u372536694/apps/api/dist/compromisos/compromisos.service.js'

s = open(SVC).read()

# ─── 1) Agregar alias en INSERT del crear() ──────────────────────────────────
old_insert_sql = """    const r = await this.ds.query(`
      INSERT INTO compromisos_recurrentes
        (nombre, categoria, clasificacion_contable, monto_estimado, frecuencia,
         dia_vencimiento, proveedor, descripcion, metodo_pago_default, cuenta_banco_id,
         recordar_dias_antes, activo, fecha_inicio, fecha_fin, creado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, ["""

new_insert_sql = """    const r = await this.ds.query(`
      INSERT INTO compromisos_recurrentes
        (nombre, alias, categoria, clasificacion_contable, monto_estimado, frecuencia,
         dia_vencimiento, proveedor, descripcion, metodo_pago_default, cuenta_banco_id,
         recordar_dias_antes, activo, fecha_inicio, fecha_fin, creado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, ["""

if old_insert_sql in s:
    s = s.replace(old_insert_sql, new_insert_sql, 1)
    # Insertar dto.alias justo despues de _upper(dto.nombre)
    old_param = "_upper(dto.nombre),\n      _upper(dto.categoria || 'otros'),"
    new_param = "_upper(dto.nombre),\n      _upper(dto.alias) || null,\n      _upper(dto.categoria || 'otros'),"
    if old_param in s:
        s = s.replace(old_param, new_param, 1)
        print('crear(): INSERT con alias actualizado.')
    else:
        print('ERROR: parametros del INSERT no encontrados'); sys.exit(1)
elif 'alias,' in s:
    print('INSERT crear() ya tenia alias.')
else:
    print('WARN: bloque INSERT no encontrado, saltando.')

# ─── 2) Agregar alias a actualizar() ──────────────────────────────────────────
old_campos = "const campos = ['nombre','categoria','clasificacion_contable','monto_estimado',"
new_campos = "const campos = ['nombre','alias','categoria','clasificacion_contable','monto_estimado',"
if old_campos in s:
    s = s.replace(old_campos, new_campos, 1)
    print('actualizar(): alias agregado a campos.')

old_texto = "const camposTexto = new Set(['nombre','categoria','proveedor','descripcion']);"
new_texto = "const camposTexto = new Set(['nombre','alias','categoria','proveedor','descripcion']);"
if old_texto in s:
    s = s.replace(old_texto, new_texto, 1)
    print('actualizar(): alias agregado a camposTexto.')

# ─── 3) Agregar pagarPorBot ───────────────────────────────────────────────────
if 'async pagarPorBot' not in s:
    metodo = """
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
      // Formato latino: 25.000,50 o internacional 25,000.50
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

    // 3) Quitar accion, metodo y monto del texto, dejar solo palabras candidatas
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

    // 6) Marcar pagada
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
"""
    cierre = "};\n\nCompromisosService = __decorate"
    if cierre in s:
        s = s.replace(cierre, metodo + cierre, 1)
        print('pagarPorBot agregado.')
    else:
        print('ERROR: cierre de clase no encontrado'); sys.exit(1)
else:
    print('pagarPorBot ya existia.')

open(SVC, 'w').write(s)
print('OK: service patcheado.')
