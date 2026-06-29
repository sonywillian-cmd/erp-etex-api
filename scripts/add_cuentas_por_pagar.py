"""Agrega:
- Service: crearCuentaPorPagar (uso interno desde web)
- Service: crearCuentaPorPagarPorBot (parsea texto + valida usuario admin)
- Controller: POST /compromisos/cuenta-por-pagar (web, JWT)
- Controller: POST /compromisos/bot/factura (bot, x-bot-secret)
"""
import sys

SVC = '/home/u372536694/apps/api/dist/compromisos/compromisos.service.js'
CTRL = '/home/u372536694/apps/api/dist/compromisos/compromisos.controller.js'

# ─── 1) SERVICE: agregar metodos ──────────────────────────────────────────────
s = open(SVC).read()

if 'async crearCuentaPorPagar' not in s:
    metodos = """
  // ─── Cuentas por pagar (compromisos unicos a credito) ──────────────────────

  /**
   * Crea un compromiso con frecuencia='unica' que aparece en el calendario.
   * Detecta colision con compromisos recurrentes existentes (mismo alias).
   */
  async crearCuentaPorPagar(dto) {
    if (!dto.nombre) throw new common_1.BadRequestException('Concepto requerido');
    if (!dto.monto || Number(dto.monto) <= 0) throw new common_1.BadRequestException('Monto invalido');
    if (!dto.fecha_vencimiento) throw new common_1.BadRequestException('Fecha de vencimiento requerida');

    // Detectar colision: buscar recurrente activo con alias o nombre similar
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
        mensaje: 'Ya existe un compromiso recurrente parecido. Confirma si es el pago del mes o una factura nueva.',
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
      fecha_inicio: dto.fecha_vencimiento, // para frecuencia=unica, inicio=vencimiento
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

  async _detectarColisionRecurrente(concepto) {
    const candidatos = await this.ds.query(
      "SELECT id, nombre, alias, frecuencia, monto_estimado " +
      "FROM compromisos_recurrentes WHERE activo = 1 AND frecuencia != 'unica'"
    );
    const conc = String(concepto).toUpperCase();
    const palabrasConc = conc.split(/\\s+/).filter(p => p.length >= 3);

    for (const c of candidatos) {
      const aliasArr = c.alias ? String(c.alias).toUpperCase().split(',').map(a => a.trim()).filter(Boolean) : [];
      const nombreUp = String(c.nombre).toUpperCase();
      for (const p of palabrasConc) {
        if (aliasArr.includes(p)) return c;
        if (nombreUp.includes(p) && p.length >= 4) return c;
      }
    }
    return null;
  }

  /**
   * Llamado desde el bot. Parsea texto tipo:
   *   "factura claro 3500 vence 15 junio"
   *   "deber tinta 850 vence 30/06"
   *   "credito flete 2400 vence 2026-06-20"
   *   "pendiente proveedor cobalt 12500 vence manana"
   */
  async crearCuentaPorPagarPorBot(texto, chatId, forzarNuevo) {
    if (!texto) throw new common_1.BadRequestException('Texto vacio');
    if (!chatId) throw new common_1.BadRequestException('chat_id requerido');

    // Validar usuario admin
    const [vinc] = await this.ds.query(
      "SELECT v.usuario_id, u.nombre AS usuario_nombre, u.rol " +
      "FROM telegram_usuarios v JOIN usuarios u ON u.id = v.usuario_id " +
      "WHERE v.chat_id = ? LIMIT 1",
      [String(chatId)]
    );
    if (!vinc) throw new common_1.UnauthorizedException('Chat no vinculado al ERP');
    if (vinc.rol !== 'admin') {
      throw new common_1.ForbiddenException('Solo el admin puede registrar cuentas por pagar');
    }

    const t = String(texto).trim();
    const tUp = t.toUpperCase();

    // Extraer monto
    const matchMonto = tUp.match(/(\\d{1,3}(?:[\\.,]\\d{3})+(?:[\\.,]\\d{1,2})?|\\d+(?:[\\.,]\\d{1,2})?)/);
    if (!matchMonto) throw new common_1.BadRequestException('No detecte el monto');
    let montoStr = matchMonto[1];
    if (montoStr.includes('.') && montoStr.includes(',')) {
      const lastDot = montoStr.lastIndexOf('.');
      const lastCom = montoStr.lastIndexOf(',');
      if (lastCom > lastDot) montoStr = montoStr.replace(/\\./g, '').replace(',', '.');
      else montoStr = montoStr.replace(/,/g, '');
    } else if (montoStr.includes(',')) {
      const partes = montoStr.split(',');
      if (partes[partes.length - 1].length <= 2 && partes.length === 2) montoStr = montoStr.replace(',', '.');
      else montoStr = montoStr.replace(/,/g, '');
    } else if (montoStr.includes('.')) {
      const partes = montoStr.split('.');
      if (partes.length > 2 || partes[partes.length - 1].length === 3) montoStr = montoStr.replace(/\\./g, '');
    }
    const monto = Number(montoStr);
    if (!monto || monto <= 0) throw new common_1.BadRequestException('Monto invalido');

    // Extraer fecha de vencimiento
    const fechaVenc = this._parsearFecha(tUp);
    if (!fechaVenc) {
      throw new common_1.BadRequestException(
        'No detecte la fecha de vencimiento. Usa "vence DD mes" o "vence DD/MM" o "vence YYYY-MM-DD"'
      );
    }

    // Extraer concepto: quitar verbo, metodo, monto, fecha
    const verbos = /\\b(FACTURA|DEBER|CREDITO|CR\\u00c9DITO|PENDIENTE|POR\\s+PAGAR|CUENTA|VENCE|EL|LA|LOS|LAS|DE|DEL|A|EN)\\b/g;
    const meses = /\\b(ENE|ENERO|FEB|FEBRERO|MAR|MARZO|ABR|ABRIL|MAY|MAYO|JUN|JUNIO|JUL|JULIO|AGO|AGOSTO|SEP|SEPTIEMBRE|OCT|OCTUBRE|NOV|NOVIEMBRE|DIC|DICIEMBRE|MANANA|MA\\u00d1ANA|HOY|LUNES|MARTES|MIERCOLES|MI\\u00c9RCOLES|JUEVES|VIERNES|SABADO|S\\u00c1BADO|DOMINGO|DIAS|D\\u00cdAS)\\b/g;
    let concepto = tUp
      .split(matchMonto[0]).join(' ')
      .replace(verbos, ' ')
      .replace(meses, ' ')
      .replace(/\\b\\d{1,2}([\\/\\-]\\d{1,2}([\\/\\-]\\d{2,4})?)?\\b/g, ' ')
      .replace(/[^A-Z\\u00d1\\u00c1\\u00c9\\u00cd\\u00d3\\u00da\\s]/g, ' ')
      .replace(/\\s+/g, ' ')
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

  /**
   * Parsea fechas en espanol:
   *   "15 jun", "15 de junio", "15 junio 2026"
   *   "15/06", "15/06/2026", "15-06-2026"
   *   "2026-06-15"
   *   "manana", "hoy"
   *   "30 dias" (= hoy + 30)
   */
  _parsearFecha(tUp) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ano = hoy.getFullYear();
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    // Relativos
    if (/\\bHOY\\b/.test(tUp)) return fmt(hoy);
    if (/\\b(MANANA|MA\\u00d1ANA)\\b/.test(tUp)) {
      const m = new Date(hoy);
      m.setDate(m.getDate() + 1);
      return fmt(m);
    }
    const matchDias = tUp.match(/(\\d{1,3})\\s+D[I\\u00cd]AS/);
    if (matchDias) {
      const f = new Date(hoy);
      f.setDate(f.getDate() + Number(matchDias[1]));
      return fmt(f);
    }

    // ISO: YYYY-MM-DD
    const matchIso = tUp.match(/(20\\d{2})-(\\d{1,2})-(\\d{1,2})/);
    if (matchIso) {
      return matchIso[1] + '-' + matchIso[2].padStart(2, '0') + '-' + matchIso[3].padStart(2, '0');
    }

    // DD/MM/YYYY o DD-MM-YYYY
    const matchSlash = tUp.match(/(\\d{1,2})[\\/\\-](\\d{1,2})(?:[\\/\\-](\\d{2,4}))?/);
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

    // "15 jun" / "15 junio" / "15 de junio"
    const MESES = {
      ENE: 1, ENERO: 1, FEB: 2, FEBRERO: 2, MAR: 3, MARZO: 3, ABR: 4, ABRIL: 4,
      MAY: 5, MAYO: 5, JUN: 6, JUNIO: 6, JUL: 7, JULIO: 7, AGO: 8, AGOSTO: 8,
      SEP: 9, SEPTIEMBRE: 9, OCT: 10, OCTUBRE: 10, NOV: 11, NOVIEMBRE: 11, DIC: 12, DICIEMBRE: 12,
    };
    const re = new RegExp('(\\\\d{1,2})\\\\s+(?:DE\\\\s+)?(' + Object.keys(MESES).join('|') + ')(?:\\\\s+(\\\\d{2,4}))?');
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
"""
    cierre = "};\n\nCompromisosService = __decorate"
    if cierre in s:
        s = s.replace(cierre, metodos + cierre, 1)
        open(SVC, 'w').write(s)
        print('Service: crearCuentaPorPagar + bot + parser de fechas agregados.')
    else:
        print('ERROR: cierre de clase no encontrado'); sys.exit(1)
else:
    print('crearCuentaPorPagar ya existia.')


# ─── 2) CONTROLLER: agregar endpoints ──────────────────────────────────────────
c = open(CTRL).read()

if 'cuenta-por-pagar' not in c:
    # Agregar handlers en la clase
    handlers = """  crearCuentaPorPagar(body, user) {
    return this.svc.crearCuentaPorPagar({ ...body, creado_por: user && user.nombre });
  }
  async botFactura(secret, body) {
    validarBotSecret(secret);
    return this.svc.crearCuentaPorPagarPorBot(body && body.texto, body && body.chat_id, body && body.forzar_nuevo);
  }
"""
    c = c.replace(
        "  async botPagar(secret, body) {\n    validarBotSecret(secret);\n    return this.svc.pagarPorBot(body && body.texto, body && body.chat_id);\n  }\n};",
        "  async botPagar(secret, body) {\n    validarBotSecret(secret);\n    return this.svc.pagarPorBot(body && body.texto, body && body.chat_id);\n  }\n" + handlers + "};",
        1,
    )

    # Agregar decorators
    decors = """
// POST /compromisos/cuenta-por-pagar (web, JWT, admin+supervisor)
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Post)('cuenta-por-pagar'),
  __param(0, (0, common_1.Body)()),
  __param(1, (0, decorators_1.CurrentUser)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Object, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "crearCuentaPorPagar", null);

// POST /compromisos/bot/factura (bot, x-bot-secret)
__decorate([
  (0, common_1.Post)('bot/factura'),
  __param(0, (0, common_1.Headers)('x-bot-secret')),
  __param(1, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [String, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "botFactura", null);
"""
    c = c.replace(
        "exports.CompromisosController = CompromisosController = __decorate([",
        decors + "\nexports.CompromisosController = CompromisosController = __decorate([",
        1,
    )

    open(CTRL, 'w').write(c)
    print('Controller: endpoints cuenta-por-pagar y bot/factura agregados.')
else:
    print('Endpoints ya existian.')

print('\nOK: backend listo.')
