"""Patch asistente.controller.js + asistente.service.js para agregar:
   - GET /asistente/bot/reporte-mensual?mes=YYYY-MM  (auth con x-bot-secret)
   - GET /asistente/bot/admins-chat-ids  (devuelve chat_ids de admin/supervisor)

Idempotent.
"""
import sys

CTL = '/home/u372536694/apps/api/dist/asistente/asistente.controller.js'
SVC = '/home/u372536694/apps/api/dist/asistente/asistente.service.js'

# ----------------------------------------------------------------
# 1. Service: agregar metodo botReporteMensual y botAdminsChatIds
# ----------------------------------------------------------------
s = open(SVC).read()
if 'botReporteMensual' in s:
    print('Service already patched.')
else:
    marker = "};\nexports.AsistenteService"
    if marker not in s:
        print('ERROR: cannot find service class end'); sys.exit(1)
    new_methods = '''    async botReporteMensual(mes) {
        // Delega al MetricasService.reporteMensual via injection.
        // Pero como aqui no esta inyectado, vamos directo a la DB con el mismo SQL
        // simplificado: reutilizamos this.ds (DataSource) si esta disponible.
        if (!this.metricasSvc) {
            throw new common_1.BadRequestException('MetricasService no disponible');
        }
        return this.metricasSvc.reporteMensual(mes);
    }
    async botAdminsChatIds() {
        const rows = await this.ds.query(`
            SELECT t.chat_id, u.nombre, u.rol
            FROM telegram_usuarios t
            JOIN usuarios u ON u.id = t.usuario_id
            WHERE u.activo = 1 AND u.rol IN ('admin','supervisor')
        `);
        return rows.map(r => ({ chat_id: String(r.chat_id), nombre: r.nombre, rol: r.rol }));
    }
'''
    s = s.replace(marker, new_methods + marker, 1)
    open(SVC, 'w').write(s)
    print('Service patched.')

# ----------------------------------------------------------------
# 2. Controller: agregar rutas con auth bot-secret
# ----------------------------------------------------------------
c = open(CTL).read()
if 'botReporteMensual' in c:
    print('Controller already patched.')
else:
    # Find the botMetricas method to anchor after it
    anchor = '''    botMetricas(secret'''
    if anchor not in c:
        print('ERROR: cannot find botMetricas anchor'); sys.exit(1)

    # Find the END of botMetricas method
    # Pattern in compiled JS:
    #     botMetricas(secret, tipo, periodo) {
    #         this.validarBotSecret(secret);
    #         return this.svc.consultarMetricas(tipo, periodo);
    #     }
    idx = c.find(anchor)
    # Find the closing brace right after consultarMetricas
    end_marker = 'return this.svc.consultarMetricas(tipo, periodo);\n    }'
    end_idx = c.find(end_marker, idx)
    if end_idx == -1:
        print('ERROR: cannot find botMetricas end'); sys.exit(1)
    insertion_point = end_idx + len(end_marker)

    new_handlers = '''
    botReporteMensual(secret, mes) {
        this.validarBotSecret(secret);
        return this.svc.botReporteMensual(mes);
    }
    botAdminsChatIds(secret) {
        this.validarBotSecret(secret);
        return this.svc.botAdminsChatIds();
    }'''
    c = c[:insertion_point] + new_handlers + c[insertion_point:]

    # Add decorators block. Find the existing botMetricas decorator block:
    dec_anchor = '''__decorate([
    (0, common_1.Get)('bot/metricas'),'''
    if dec_anchor not in c:
        print('ERROR: cannot find botMetricas decorator'); sys.exit(1)

    # Find the closing of the botMetricas decorator (], AsistenteController.prototype, "botMetricas", null);)
    dec_end = '], AsistenteController.prototype, "botMetricas", null);'
    dec_end_idx = c.find(dec_end)
    if dec_end_idx == -1:
        print('ERROR: cannot find botMetricas decorator end'); sys.exit(1)
    insert_dec_at = dec_end_idx + len(dec_end)

    new_decorators = '''
__decorate([
    (0, common_1.Get)('bot/reporte-mensual'),
    __param(0, (0, common_1.Headers)('x-bot-secret')),
    __param(1, (0, common_1.Query)('mes')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AsistenteController.prototype, "botReporteMensual", null);
__decorate([
    (0, common_1.Get)('bot/admins-chat-ids'),
    __param(0, (0, common_1.Headers)('x-bot-secret')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AsistenteController.prototype, "botAdminsChatIds", null);'''
    c = c[:insert_dec_at] + new_decorators + c[insert_dec_at:]

    open(CTL, 'w').write(c)
    print('Controller patched.')

# ----------------------------------------------------------------
# 3. Service: inyectar MetricasService — agregamos al constructor
#    Como esto requiere modificar el modulo, vamos al modulo y dejamos
#    el servicio usando un require lazy si no esta inyectado.
# ----------------------------------------------------------------
# Patch alternativo: en lugar de inyectar MetricasService, usamos un
# require y construimos manualmente. Mas simple: agregamos un getter
# lazy que importa el service y lo construye con el datasource.
# En realidad: el AsistenteService ya tiene this.ds. Pasamos el query
# directamente sin pasar por MetricasService (duplicacion controlada).
s2 = open(SVC).read()
if '// LAZY METRICAS' not in s2 and 'metricasSvc' in s2:
    # Modificar botReporteMensual para que use this.ds directamente
    old = '''    async botReporteMensual(mes) {
        // Delega al MetricasService.reporteMensual via injection.
        // Pero como aqui no esta inyectado, vamos directo a la DB con el mismo SQL
        // simplificado: reutilizamos this.ds (DataSource) si esta disponible.
        if (!this.metricasSvc) {
            throw new common_1.BadRequestException('MetricasService no disponible');
        }
        return this.metricasSvc.reporteMensual(mes);
    }'''
    # Replace with inline implementation that uses this.ds
    new = '''    async botReporteMensual(mes) {
        // LAZY METRICAS: implementacion inline reutilizando this.ds
        const ahora = new Date();
        let yyyymm = mes;
        if (!yyyymm || !/^\\d{4}-\\d{2}$/.test(yyyymm)) {
            yyyymm = ahora.getFullYear() + '-' + String(ahora.getMonth() + 1).padStart(2, '0');
        }
        const [y, m] = yyyymm.split('-').map(Number);
        const desde = `${y}-${String(m).padStart(2,'0')}-01`;
        const ultimo = new Date(y, m, 0).getDate();
        const hasta = `${y}-${String(m).padStart(2,'0')}-${String(ultimo).padStart(2,'0')}`;
        const hastaInclusive = hasta + ' 23:59:59';

        const [vol] = await this.ds.query(`
            SELECT
              (SELECT COUNT(*) FROM cotizaciones WHERE creado_en BETWEEN ? AND ?) AS cotizaciones,
              (SELECT COUNT(*) FROM ordenes_produccion WHERE creado_en BETWEEN ? AND ?) AS ordenes,
              (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado != 'anulada') AS facturas_emitidas,
              (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado = 'anulada') AS facturas_anuladas,
              (SELECT COUNT(*) FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?) AS recibos,
              (SELECT COUNT(*) FROM clientes WHERE creado_en BETWEEN ? AND ?) AS clientes_nuevos
        `, [desde,hastaInclusive, desde,hastaInclusive, desde,hastaInclusive, desde,hastaInclusive, desde,hasta, desde,hastaInclusive]);

        const [ing] = await this.ds.query(`
            SELECT ROUND(COALESCE(SUM(monto),0),2) AS total, COUNT(*) AS recibos,
              ROUND(COALESCE(SUM(IF(metodo='efectivo',monto,0)),0),2) AS efectivo,
              ROUND(COALESCE(SUM(IF(metodo='transferencia',monto,0)),0),2) AS transferencia,
              ROUND(COALESCE(SUM(IF(metodo='tarjeta',monto,0)),0),2) AS tarjeta,
              ROUND(COALESCE(SUM(IF(metodo='cheque',monto,0)),0),2) AS cheque
            FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?
        `, [desde, hasta]);

        const [saldo] = await this.ds.query(`
            SELECT ROUND(COALESCE(SUM(total - total_pagado),0),2) AS monto, COUNT(*) AS facturas
            FROM facturas WHERE estado IN ('emitida','parcial','credito') AND fecha_emision <= ?
        `, [hastaInclusive]);

        const estados = await this.ds.query(`
            SELECT estado, COUNT(*) AS cant FROM ordenes_produccion
            WHERE creado_en BETWEEN ? AND ? GROUP BY estado ORDER BY cant DESC
        `, [desde, hastaInclusive]);

        const [atras] = await this.ds.query(`
            SELECT COUNT(*) AS cant FROM ordenes_produccion
            WHERE estado IN ('pendiente','en_diseno','en_produccion','en_terminacion','atraso')
              AND fecha_comprometida < CURDATE() AND creado_en BETWEEN ? AND ?
        `, [desde, hastaInclusive]);

        const topClientes = await this.ds.query(`
            SELECT cl.nombre, COUNT(o.id) AS ordenes, ROUND(COALESCE(SUM(cot.total),0),2) AS cotizado
            FROM ordenes_produccion o
            LEFT JOIN cotizaciones cot ON cot.id = o.cotizacion_id
            LEFT JOIN clientes cl ON cl.id = o.cliente_id
            WHERE o.creado_en BETWEEN ? AND ?
            GROUP BY cl.id, cl.nombre HAVING cotizado > 0
            ORDER BY cotizado DESC LIMIT 5
        `, [desde, hastaInclusive]);

        const gastos = await this.ds.query(`
            SELECT tipo, COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
            FROM gastos WHERE fecha BETWEEN ? AND ? GROUP BY tipo
        `, [desde, hasta]);

        return {
            mes: yyyymm, rango: { desde, hasta },
            volumen: vol, ingresos: ing, saldo_pendiente: saldo,
            ordenes_por_estado: estados, atrasadas: atras.cant,
            top_clientes: topClientes, gastos: { por_tipo: gastos },
        };
    }'''
    s2 = s2.replace(old, new, 1)
    open(SVC, 'w').write(s2)
    print('Service inline impl applied.')

print('OK: bot endpoints listos.')
