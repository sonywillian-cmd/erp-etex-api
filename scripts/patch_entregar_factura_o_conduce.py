"""Patch produccion.service.js:
   - crearConduce: ya NO requiere factura previa (la idea es que el conduce
     pueda ser un sustituto del comprobante en ventas a credito).
   - entregar: acepta factura O conduce, no solo factura.

Idempotent: si ya esta parcheado, sale sin cambios.
"""
import re, sys

p = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
s = open(p).read()

if 'verificarFacturaOConduce' in s:
    print('Already patched -- no-op.')
    sys.exit(0)

# 1) Insertar nuevo helper justo despues de verificarFactura
helper_old = """    async verificarFactura(ordenId) {
        const rows = await this.ds.query(`SELECT id FROM facturas WHERE orden_produccion_id = ? AND estado != 'anulada' LIMIT 1`, [ordenId]);
        if (!rows.length) {
            throw new common_1.BadRequestException('sin_factura:Esta orden no tiene factura. Genera la factura antes de entregar.');
        }
    }"""

helper_new = """    async verificarFactura(ordenId) {
        const rows = await this.ds.query(`SELECT id FROM facturas WHERE orden_produccion_id = ? AND estado != 'anulada' LIMIT 1`, [ordenId]);
        if (!rows.length) {
            throw new common_1.BadRequestException('sin_factura:Esta orden no tiene factura. Genera la factura antes de entregar.');
        }
    }
    async verificarFacturaOConduce(ordenId) {
        const facturas = await this.ds.query(`SELECT id FROM facturas WHERE orden_produccion_id = ? AND estado != 'anulada' LIMIT 1`, [ordenId]);
        if (facturas.length) return;
        const conduces = await this.ds.query(`SELECT id FROM conduces_entrega WHERE orden_id = ? LIMIT 1`, [ordenId]);
        if (conduces.length) return;
        throw new common_1.BadRequestException('sin_documento:Esta orden no tiene factura ni conduce. Emite uno de los dos antes de marcar como entregada.');
    }"""

if helper_old not in s:
    print('ERROR: verificarFactura helper not found, file structure may have changed.')
    sys.exit(1)
s = s.replace(helper_old, helper_new, 1)

# 2) Cambiar entregar() para usar el nuevo verificador
old_entregar_call = '''        if (!estadosValidos.includes(orden.estado)) {
            throw new common_1.BadRequestException('La orden debe estar en estado Listo para ser entregada.');
        }
        await this.verificarFactura(id);'''
new_entregar_call = '''        if (!estadosValidos.includes(orden.estado)) {
            throw new common_1.BadRequestException('La orden debe estar en estado Listo para ser entregada.');
        }
        await this.verificarFacturaOConduce(id);'''
if old_entregar_call not in s:
    print('ERROR: entregar body not found')
    sys.exit(1)
s = s.replace(old_entregar_call, new_entregar_call, 1)

# 3) Eliminar el bloqueo en crearConduce (ya no requiere factura previa)
old_conduce = '''        if (!estadosValidos.includes(orden.estado)) {
            throw new common_1.BadRequestException('La orden debe estar en estado Listo para emitir un conduce.');
        }
        await this.verificarFactura(ordenId);'''
new_conduce = '''        if (!estadosValidos.includes(orden.estado)) {
            throw new common_1.BadRequestException('La orden debe estar en estado Listo para emitir un conduce.');
        }
        // Conduce ya NO requiere factura previa -- es el documento alternativo
        // para ventas a credito o entregas parciales.'''
if old_conduce not in s:
    print('WARN: crearConduce verificarFactura call not found exactly. Skipping that change.')
else:
    s = s.replace(old_conduce, new_conduce, 1)

open(p, 'w').write(s)
print('OK: patched produccion.service.js for factura-o-conduce.')
