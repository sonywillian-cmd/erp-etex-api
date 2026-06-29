"""Agrega:
1. Soporte de campo `alias` en crear/actualizar del service
2. Metodo `pagarPorBot(texto, chatId)` que parsea el mensaje y dispara marcarPagada
3. Endpoint POST /compromisos/bot/pagar con x-bot-secret guard
"""
import sys

SVC  = '/home/u372536694/apps/api/dist/compromisos/compromisos.service.js'
CTRL = '/home/u372536694/apps/api/dist/compromisos/compromisos.controller.js'

# ─── 1) SERVICE: agregar alias en INSERT ─────────────────────────────────────
s = open(SVC).read()

# Agregar columna alias al INSERT
old_insert = """    const r = await this.ds.query(`
      INSERT INTO compromisos_recurrentes
        (nombre, categoria, clasificacion_contable, monto_estimado, frecuencia,
         dia_vencimiento, proveedor, descripcion, metodo_pago_default, cuenta_banco_id,
         recordar_dias_antes, activo, fecha_inicio, fecha_fin, creado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, ["""

new_insert = """    const r = await this.ds.query(`
      INSERT INTO compromisos_recurrentes
        (nombre, alias, categoria, clasificacion_contable, monto_estimado, frecuencia,
         dia_vencimiento, proveedor, descripcion, metodo_pago_default, cuenta_banco_id,
         recordar_dias_antes, activo, fecha_inicio, fecha_fin, creado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, ["""

if old_insert in s:
    s = s.replace(old_insert, new_insert, 1)
    # Agregar dto.alias justo despues de dto.nombre
    s = s.replace(
        "_upper(dto.nombre),\n      _upper(dto.categoria || 'otros'),",
        "_upper(dto.nombre),\n      _upper(dto.alias) || null,\n      _upper(dto.categoria || 'otros'),",
        1,
    )
    print('Service crear() ahora guarda alias.')
elif 'alias' in s and 'INSERT INTO compromisos_recurrentes' in s and 'alias,' in s:
    print('Service crear() ya tenia alias.')
else:
    print('WARN: bloque INSERT crear no encontrado')

# Agregar alias a campos editables y a camposTexto
if "'fecha_fin']" in s and "'alias'" not in s:
    s = s.replace(
        "const campos = ['nombre','categoria','clasificacion_contable','monto_estimado',",
        "const campos = ['nombre','alias','categoria','clasificacion_contable','monto_estimado',",
        1,
    )
    s = s.replace(
        "const camposTexto = new Set(['nombre','categoria','proveedor','descripcion']);",
        "const camposTexto = new Set(['nombre','alias','categoria','proveedor','descripcion']);",
        1,
    )
    print('Service actualizar() acepta alias.')

# ─── 2) SERVICE: agregar metodo pagarPorBot ──────────────────────────────────
if 'async pagarPorBot' not in s:
    metodo = """
  async pagarPorBot(texto, chatId) {
    if (!texto) throw new common_1.BadRequestException('Texto vacio');
    if (!chatId) throw new common_1.BadRequestException('chat_id requerido');

    // 1) Resolver usuario por chatId
    const [vinc] = await this.ds.query(`
      SELECT v.usuario_id, u.nombre AS usuario_nombre, u.rol
      FROM telegram_vinculaciones v
      JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.chat_id = ?
      LIMIT 1
    `, [String(chatId)]);
    if (!vinc) throw new common_1.UnauthorizedException('Chat no vinculado');
    if (vinc.rol !== 'admin') {
      throw new common_1.ForbiddenException('Solo el admin puede registrar pagos de compromisos por el bot');
    }

    // 2) Parsear texto: extraer metodo, monto y alias
    const t = String(texto).trim().toUpperCase();

    // Detectar metodo de pago
    let metodoPago = 'efectivo';
    if (/(TRANSFERENCIA|TRANSFER|TRF)/.test(t)) metodoPago = 'transferencia';
    else if (/(CHEQUE)/.test(t)) metodoPago = 'cheque';
    else if (/(TARJETA)/.test(t)) metodoPago = 'tarjeta';
    else if (/(EFECTIVO|CASH)/.test(t)) metodoPago = 'efectivo';

    // Extraer monto (acepta 4567, 4,567, 4567.50, 4.567,50)
    const matchMonto = t.match(/(\\d{1,3}(?:[\\.,]\\d{3})*(?:[\\.,]\\d{1,2})?|\\d+(?:[\\.,]\\d{1,2})?)/);
    if (!matchMonto) throw new common_1.BadRequestException('No detecte el monto. Ejemplo: "pago luz 4567"');
    let montoStr = matchMonto[1];
    // Normalizar: si tiene punto Y coma, asumir formato latino (1.234,56). Si solo coma, idem.
    if (montoStr.includes('.') && montoStr.includes(',')) {
      montoStr = montoStr.replace(/\\./g, '').replace(',', '.');
    } else if (montoStr.includes(',') && !montoStr.includes('.')) {
      const partes = montoStr.split(',');
      if (partes[partes.length - 1].length <= 2) montoStr = montoStr.replace(/,/g, '.');
      else montoStr = montoStr.replace(/,/g, '');
    } else {
      // Solo puntos: si hay mas de uno o el ultimo grupo es de 3 digitos, son separadores de miles
      const puntos = montoStr.match(/\\./g);
      if (puntos && puntos.length > 1) montoStr = montoStr.replace(/\\./g, '');
      else if (puntos) {
        const partes = montoStr.split('.');
        if (partes[1].length === 3) montoStr = montoStr.replace(/\\./g, '');
      }
    }
    const monto = Number(montoStr);
    if (!monto || monto <= 0) throw new common_1.BadRequestException(`Monto invalido: ${montoStr}`);

    // 3) Quitar palabras de accion y metodo del texto para buscar alias
    const textoSinAccion = t
      .replace(/\\b(PAGO|PAGUE|PAGU\\u00c9|PAGAR|EFECTIVO|TRANSFERENCIA|TRANSFER|TRF|CHEQUE|TARJETA|CASH)\\b/g, ' ')
      .replace(matchMonto[0], ' ')
      .replace(/[^A-Z\\u00d1\\u00c1\\u00c9\\u00cd\\u00d3\\u00da\\s]/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();

    const palabrasTexto = textoSinAccion.split(' ').filter(p => p.length >= 3);

    // 4) Buscar compromisos activos que tengan alias coincidentes
    const candidatos = await this.ds.query(`
      SELECT id, nombre, alias, proveedor, monto_estimado, categoria
      FROM compromisos_recurrentes
      WHERE activo = 1 AND alias IS NOT NULL AND alias != ''
    `);

    let mejor = null;
    let mejorScore = 0;
    for (const c of candidatos) {
      const aliasArr = String(c.alias).toUpperCase().split(',').map(a => a.trim()).filter(Boolean);
      let score = 0;
      for (const p of palabrasTexto) {
        if (aliasArr.includes(p)) score += 2;
        else if (aliasArr.some(a => a.includes(p) || p.includes(a))) score += 1;
      }
      if (score > mejorScore) { mejorScore = score; mejor = c; }
    }

    if (!mejor) {
      const lista = candidatos.map(c => `  - ${c.nombre} (alias: ${c.alias || 'sin alias'})`).join('\\n');
      throw new common_1.NotFoundException(
        `No identifique a que compromiso te refieres. Compromisos activos:\\n${lista || '  (ninguno con alias)'}`
      );
    }

    // 5) Buscar la proxima ocurrencia pendiente
    const [ocurr] = await this.ds.query(`
      SELECT id, fecha_vencimiento, monto_estimado, estado
      FROM compromisos_ocurrencias
      WHERE compromiso_id = ? AND estado = 'pendiente'
      ORDER BY fecha_vencimiento ASC
      LIMIT 1
    `, [mejor.id]);

    if (!ocurr) {
      throw new common_1.NotFoundException(`${mejor.nombre} no tiene ocurrencias pendientes`);
    }

    // 6) Marcar pagada
    const res = await this.marcarPagada(ocurr.id, {
      monto_pagado: monto,
      fecha_pago: new Date().toISOString().slice(0, 10),
      metodo_pago: metodoPago,
      notas: `Registrado via bot Telegram. Texto original: "${texto}"`,
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
    # Insertar antes del cierre de la clase
    cierre = "};\n\nCompromisosService = __decorate"
    if cierre in s:
        s = s.replace(cierre, metodo + cierre, 1)
        print('Metodo pagarPorBot agregado al service.')
    else:
        print('ERROR: cierre de clase no encontrado'); sys.exit(1)
else:
    print('pagarPorBot ya existia.')

open(SVC, 'w').write(s)

# ─── 3) CONTROLLER: agregar ruta POST /bot/pagar ─────────────────────────────
c = open(CTRL).read()

if "'bot/pagar'" not in c and 'bot/pagar' not in c:
    # Importar BotSecretGuard
    if 'BotSecretGuard' not in c:
        c = c.replace(
            "const guards_1 = require(\"../common/guards\");",
            "const guards_1 = require(\"../common/guards\");\nconst { BotSecretGuard } = require(\"../common/guards/bot-secret.guard\");"
        )
    # Agregar metodo en la clase
    metodo_handler = """  async pagarPorBot(body) {
    return this.svc.pagarPorBot(body && body.texto, body && body.chat_id);
  }
"""
    c = c.replace(
        "  cancelarOcurrencia(id, body) { return this.svc.cancelarOcurrencia(id, body && body.motivo); }",
        "  cancelarOcurrencia(id, body) { return this.svc.cancelarOcurrencia(id, body && body.motivo); }\n" + metodo_handler,
        1,
    )
    # Agregar decorator (sin JwtAuthGuard, con BotSecretGuard)
    decor = """__decorate([(0, common_1.Post)('bot/pagar'),
  (0, common_1.UseGuards)(BotSecretGuard),
  __param(0, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "pagarPorBot", null);
"""
    # Insertar antes del cierre exports
    cierre_ctrl = "\nexports.CompromisosController = CompromisosController = __decorate(["
    if cierre_ctrl in c:
        c = c.replace(cierre_ctrl, "\n" + decor + cierre_ctrl, 1)
    else:
        print('ERROR: cierre del controller no encontrado'); sys.exit(1)

    # IMPORTANTE: el endpoint bot/pagar NO debe pasar por JwtAuthGuard (es del bot, no JWT)
    # El JwtAuthGuard esta a nivel de clase, hay que excluir este endpoint usando @Public()
    # o quitando JwtAuthGuard del controller y poniendolo en cada metodo. Mejor opcion:
    # crear un nuevo controller separado, pero por simplicidad usamos SkipAuth.
    # En su lugar: usamos @SetMetadata('skipJwt', true) y el guard lo respeta? No, no esta hecho asi.
    # Mejor: mover JwtAuthGuard a cada metodo y dejar bot/pagar solo con BotSecretGuard.

    # Eliminar @UseGuards(JwtAuthGuard) a nivel de clase
    c = c.replace(
        "exports.CompromisosController = CompromisosController = __decorate([\n  (0, common_1.Controller)('compromisos'),\n  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),",
        "exports.CompromisosController = CompromisosController = __decorate([\n  (0, common_1.Controller)('compromisos'),",
        1,
    )
    # Agregar JwtAuthGuard a cada metodo (excepto pagarPorBot)
    # Esto se hace agregando UseGuards al inicio de cada __decorate, donde no este ya
    import re
    def inject_jwt(match):
        bloque = match.group(0)
        if 'BotSecretGuard' in bloque: return bloque  # no tocar el del bot
        if 'guards_1.JwtAuthGuard' in bloque: return bloque
        # insertar JwtAuthGuard como primer guard
        if '(0, common_1.UseGuards)(guards_1.RolesGuard)' in bloque:
            return bloque.replace(
                '(0, common_1.UseGuards)(guards_1.RolesGuard)',
                '(0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard)'
            )
        # si no tenia UseGuards, agregar uno
        # patron: __decorate([(0, common_1.Get)... __metadata
        return bloque.replace(
            '__decorate([',
            '__decorate([(0, common_1.UseGuards)(guards_1.JwtAuthGuard),\n  ',
            1
        )

    # Solo procesar bloques __decorate([..., null);
    pattern = r'__decorate\(\[\(0, common_1\.(Get|Post|Put|Delete)\)[^]]+?\], CompromisosController\.prototype, "[^"]+", null\);'
    c = re.sub(pattern, inject_jwt, c, flags=re.DOTALL)

    open(CTRL, 'w').write(c)
    print('Controller: endpoint bot/pagar agregado, JwtAuthGuard movido a cada metodo.')
else:
    print('bot/pagar ya estaba en el controller.')

print('\nOK: backend listo.')
