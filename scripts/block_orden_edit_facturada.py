"""Bloquea modificaciones fiscales de una orden si tiene factura activa.
Campos sensibles: lineas_produccion, especificaciones, descuento_global_pct, complejidad, tipo_ncf_default
"""
import re

F = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
s = open(F).read()

marker = 'const editFinanciero = data.lineas_produccion !== undefined;'

if 'camposFiscales' in s:
    print('Ya estaba bloqueado')
else:
    bloque_nuevo = (
        "// Campos sensibles que NO se pueden modificar si hay factura emitida\n"
        "        const camposFiscales = ['lineas_produccion', 'especificaciones', 'descuento_global_pct', 'complejidad', 'tipo_ncf_default'];\n"
        "        const intentaEditarFiscal = camposFiscales.some(k => data[k] !== undefined);\n"
        "        " + marker + "\n"
        "        if (intentaEditarFiscal && factura) {\n"
        "            throw new common_1.BadRequestException(\n"
        "                'La orden tiene factura ' + factura.numero + ' (' + factura.estado + ') emitida. ' +\n"
        "                'No se puede modificar contenido fiscal (lineas, especificaciones, descuento, complejidad, tipo de NCF). ' +\n"
        "                'Para hacer cambios, anula primero la factura.'\n"
        "            );\n"
        "        }"
    )
    s2 = s.replace(marker, bloque_nuevo, 1)
    if s == s2:
        print('ERR: no se aplicó el reemplazo')
    else:
        open(F, 'w').write(s2)
        print('OK: bloqueo agregado')
