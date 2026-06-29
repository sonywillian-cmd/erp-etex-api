"""Patch produccion.service.js getVistaFinanciera para incluir cliente_id y telefono."""
import sys

p = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
s = open(p).read()

if 'cliente_telefono' in s and 'getVistaFinanciera' in s and 'cl.telefono' in s:
    # Verificar que realmente este dentro de getVistaFinanciera
    idx = s.find('async getVistaFinanciera')
    end = s.find('async ', idx + 10)
    bloque = s[idx:end]
    if 'cl.telefono' in bloque:
        print('Already patched.'); sys.exit(0)

old_select = '''        o.responsable_principal,
        cot.total                                   AS total_cotizacion,'''
new_select = '''        o.responsable_principal,
        cl.id                                       AS cliente_id,
        cl.telefono                                 AS cliente_telefono,
        cot.total                                   AS total_cotizacion,'''
if old_select not in s:
    print('ERROR: SELECT block not found'); sys.exit(1)
s = s.replace(old_select, new_select, 1)

# Tambien en el GROUP BY agregar los nuevos campos
old_group = '''      GROUP BY o.id, cl.nombre, cot.total, f.id, f.numero, f.total_pagado'''
new_group = '''      GROUP BY o.id, cl.id, cl.nombre, cl.telefono, cot.total, f.id, f.numero, f.total_pagado'''
if old_group not in s:
    print('ERROR: GROUP BY not found'); sys.exit(1)
s = s.replace(old_group, new_group, 1)

# Y en el mapper agregar cliente_id y cliente_telefono al objeto
old_map = '''            responsable_principal: r.responsable_principal ?? null,
            total_cotizacion:'''
new_map = '''            responsable_principal: r.responsable_principal ?? null,
            cliente_id:            r.cliente_id != null ? Number(r.cliente_id) : null,
            cliente_telefono:      r.cliente_telefono ?? null,
            total_cotizacion:'''
if old_map not in s:
    print('ERROR: mapper not found'); sys.exit(1)
s = s.replace(old_map, new_map, 1)

open(p, 'w').write(s)
print('OK: patched.')
