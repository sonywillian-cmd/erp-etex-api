"""Patch metricas.service.js + metricas.controller.js to add /metricas/reporte-mensual.

Adds a method `reporteMensual(mes)` that runs the SQL queries for the monthly
report (volumen, ingresos, conversion, ordenes por estado, top clientes, etc.)
and exposes it as GET /metricas/reporte-mensual?mes=YYYY-MM.

Idempotent.
"""
import re, sys

SVC = '/home/u372536694/apps/api/dist/metricas/metricas.service.js'
CTL = '/home/u372536694/apps/api/dist/metricas/metricas.controller.js'

# -------------------------------------------------------------------------
# 1. metricas.service.js -- add reporteMensual method
# -------------------------------------------------------------------------
s = open(SVC).read()
if 'reporteMensual' in s:
    print('Service already patched.')
else:
    # Find the closing brace of the class. We append a method just before it.
    # The class definition ends with "}" followed by exports.MetricasService = ...
    marker = "};\nexports.MetricasService"
    if marker not in s:
        print('ERROR: cannot find service class end marker'); sys.exit(1)

    new_method = '''    async reporteMensual(mes) {
        // mes: 'YYYY-MM' (e.g., '2026-05'). Default: mes actual.
        const ahora = new Date();
        let yyyymm = mes;
        if (!yyyymm || !/^\\d{4}-\\d{2}$/.test(yyyymm)) {
            yyyymm = ahora.getFullYear() + '-' + String(ahora.getMonth() + 1).padStart(2, '0');
        }
        const [y, m] = yyyymm.split('-').map(Number);
        const desde = `${y}-${String(m).padStart(2,'0')}-01`;
        // ultimo dia del mes
        const ultimo = new Date(y, m, 0).getDate();
        const hasta = `${y}-${String(m).padStart(2,'0')}-${String(ultimo).padStart(2,'0')}`;
        const hastaInclusive = hasta + ' 23:59:59';

        // VOLUMEN
        const [vol] = await this.ds.query(`
            SELECT
              (SELECT COUNT(*) FROM cotizaciones WHERE creado_en BETWEEN ? AND ?) AS cotizaciones,
              (SELECT COUNT(*) FROM ordenes_produccion WHERE creado_en BETWEEN ? AND ?) AS ordenes,
              (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado != 'anulada') AS facturas_emitidas,
              (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado = 'anulada') AS facturas_anuladas,
              (SELECT COUNT(*) FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?) AS recibos,
              (SELECT COUNT(*) FROM clientes WHERE creado_en BETWEEN ? AND ?) AS clientes_nuevos,
              (SELECT COUNT(*) FROM gastos WHERE fecha BETWEEN ? AND ?) AS gastos
        `, [desde,hastaInclusive, desde,hastaInclusive, desde,hastaInclusive, desde,hastaInclusive, desde,hasta, desde,hastaInclusive, desde,hasta]);

        // CONVERSION
        const [conv] = await this.ds.query(`
            SELECT
              (SELECT COUNT(*) FROM cotizaciones WHERE creado_en BETWEEN ? AND ?) AS total,
              (SELECT COUNT(*) FROM cotizaciones c JOIN ordenes_produccion o ON o.cotizacion_id = c.id WHERE c.creado_en BETWEEN ? AND ?) AS con_orden,
              (SELECT COUNT(*) FROM cotizaciones c JOIN ordenes_produccion o ON o.cotizacion_id = c.id JOIN facturas f ON f.orden_produccion_id = o.id AND f.estado != 'anulada' WHERE c.creado_en BETWEEN ? AND ?) AS con_factura
        `, [desde,hastaInclusive, desde,hastaInclusive, desde,hastaInclusive]);

        // INGRESOS POR METODO
        const [ing] = await this.ds.query(`
            SELECT
              ROUND(COALESCE(SUM(monto),0),2) AS total,
              COUNT(*) AS recibos,
              ROUND(COALESCE(SUM(IF(metodo='efectivo',monto,0)),0),2) AS efectivo,
              ROUND(COALESCE(SUM(IF(metodo='transferencia',monto,0)),0),2) AS transferencia,
              ROUND(COALESCE(SUM(IF(metodo='tarjeta',monto,0)),0),2) AS tarjeta,
              ROUND(COALESCE(SUM(IF(metodo='cheque',monto,0)),0),2) AS cheque
            FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?
        `, [desde, hasta]);

        // SALDO POR COBRAR al cierre del mes
        const [saldo] = await this.ds.query(`
            SELECT ROUND(COALESCE(SUM(total - total_pagado),0),2) AS monto,
                   COUNT(*) AS facturas
            FROM facturas WHERE estado IN ('emitida','parcial','credito') AND fecha_emision <= ?
        `, [hastaInclusive]);

        // ORDENES POR ESTADO
        const estados = await this.ds.query(`
            SELECT estado, COUNT(*) AS cant FROM ordenes_produccion
            WHERE creado_en BETWEEN ? AND ?
            GROUP BY estado ORDER BY cant DESC
        `, [desde, hastaInclusive]);

        // TIEMPO PROMEDIO ENTREGA
        const [tiempo] = await this.ds.query(`
            SELECT ROUND(AVG(TIMESTAMPDIFF(DAY, c.creado_en, o.fecha_hora_entrega)),1) AS dias,
                   COUNT(*) AS ordenes
            FROM ordenes_produccion o JOIN cotizaciones c ON c.id = o.cotizacion_id
            WHERE o.estado IN ('listo','entregado') AND c.creado_en BETWEEN ? AND ?
              AND o.fecha_hora_entrega IS NOT NULL
        `, [desde, hastaInclusive]);

        // ATRASADAS
        const [atras] = await this.ds.query(`
            SELECT COUNT(*) AS cant FROM ordenes_produccion
            WHERE estado IN ('pendiente','en_diseno','en_produccion','en_terminacion','atraso')
              AND fecha_comprometida < CURDATE() AND creado_en BETWEEN ? AND ?
        `, [desde, hastaInclusive]);

        // ACTIVIDAD POR USUARIO
        const usuarios = await this.ds.query(`
            SELECT u.id, u.nombre, u.rol,
              (SELECT COUNT(*) FROM cotizaciones c WHERE c.creado_por = u.nombre AND c.creado_en BETWEEN ? AND ?) AS cotizaciones,
              (SELECT COUNT(*) FROM recibos_ingreso r WHERE r.creado_por = u.nombre AND r.fecha BETWEEN ? AND ?) AS recibos,
              (SELECT COUNT(*) FROM facturas f WHERE f.creado_por = u.nombre AND f.fecha_emision BETWEEN ? AND ? AND f.estado != 'anulada') AS facturas,
              (SELECT COUNT(*) FROM sesiones_caja s WHERE s.usuario_id = u.id AND s.fecha_apertura BETWEEN ? AND ?) AS sesiones_caja
            FROM usuarios u WHERE u.activo = 1
            HAVING (cotizaciones + recibos + facturas + sesiones_caja) > 0
            ORDER BY recibos DESC, cotizaciones DESC
        `, [desde,hastaInclusive, desde,hasta, desde,hastaInclusive, desde,hastaInclusive]);

        // TOP CLIENTES
        const topClientes = await this.ds.query(`
            SELECT cl.nombre, COUNT(o.id) AS ordenes,
                   ROUND(COALESCE(SUM(cot.total),0),2) AS cotizado
            FROM ordenes_produccion o
            LEFT JOIN cotizaciones cot ON cot.id = o.cotizacion_id
            LEFT JOIN clientes cl ON cl.id = o.cliente_id
            WHERE o.creado_en BETWEEN ? AND ?
            GROUP BY cl.id, cl.nombre
            HAVING cotizado > 0
            ORDER BY cotizado DESC LIMIT 10
        `, [desde, hastaInclusive]);

        // GASTOS POR TIPO
        const gastos = await this.ds.query(`
            SELECT tipo, COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
            FROM gastos WHERE fecha BETWEEN ? AND ? GROUP BY tipo
        `, [desde, hasta]);

        // SESIONES DE CAJA
        const [sesiones] = await this.ds.query(`
            SELECT COUNT(*) AS total,
                   SUM(IF(estado='abierta',1,0)) AS abiertas,
                   SUM(IF(estado='validada',1,0)) AS validadas,
                   SUM(IF(estado='por_validar',1,0)) AS por_validar
            FROM sesiones_caja WHERE fecha_apertura BETWEEN ? AND ?
        `, [desde, hastaInclusive]);

        // PAGOS HUERFANOS (sin sesion de caja)
        const [huerfanos] = await this.ds.query(`
            SELECT
              (SELECT COUNT(*) FROM factura_pagos WHERE sesion_caja_id IS NULL AND fecha BETWEEN ? AND ?) AS factura_pagos,
              (SELECT COUNT(*) FROM recibos_ingreso WHERE sesion_caja_id IS NULL AND fecha BETWEEN ? AND ?) AS recibos
        `, [desde, hasta, desde, hasta]);

        return {
            mes: yyyymm,
            rango: { desde, hasta },
            generado_en: new Date().toISOString(),
            volumen: vol,
            conversion: conv,
            ingresos: ing,
            saldo_pendiente: saldo,
            ordenes_por_estado: estados,
            tiempo_entrega: tiempo,
            atrasadas: atras.cant,
            actividad_usuarios: usuarios,
            top_clientes: topClientes,
            gastos: { por_tipo: gastos },
            sesiones_caja: sesiones,
            pagos_huerfanos: huerfanos,
        };
    }
'''
    s = s.replace(marker, new_method + marker, 1)
    open(SVC, 'w').write(s)
    print('Service patched.')

# -------------------------------------------------------------------------
# 2. metricas.controller.js -- add controller method + decorator
# -------------------------------------------------------------------------
c = open(CTL).read()
if 'reporteMensual' in c:
    print('Controller already patched.')
else:
    # Add controller method right after sugerencia method
    old_methods = '''    sugerencia(ordenId) {
        return this.svc.sugerenciaFechaOrden(ordenId);
    }
};'''
    new_methods = '''    sugerencia(ordenId) {
        return this.svc.sugerenciaFechaOrden(ordenId);
    }
    reporteMensual(mes) {
        return this.svc.reporteMensual(mes);
    }
};'''
    if old_methods not in c:
        print('ERROR: cannot find sugerencia method'); sys.exit(1)
    c = c.replace(old_methods, new_methods, 1)

    # Add the decorator block before the final __decorate of class
    decorator_marker = '''exports.MetricasController = MetricasController = __decorate([
    (0, common_1.Controller)('metricas'),'''
    new_decorator = '''__decorate([
    (0, common_1.Get)('reporte-mensual'),
    __param(0, (0, common_1.Query)('mes')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MetricasController.prototype, "reporteMensual", null);
exports.MetricasController = MetricasController = __decorate([
    (0, common_1.Controller)('metricas'),'''
    if decorator_marker not in c:
        print('ERROR: cannot find controller decorator marker'); sys.exit(1)
    c = c.replace(decorator_marker, new_decorator, 1)
    open(CTL, 'w').write(c)
    print('Controller patched.')

print('OK: reporte-mensual endpoint listo.')
