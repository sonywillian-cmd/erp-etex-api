"""Patch getMisTareas en produccion.service.js para tolerar dobles espacios
en el nombre del responsable, igual que ya se hizo en historicoOperario.

Sin esto, si el browser del operario tiene cacheado el nombre con doble espacio
en localStorage, las queries de mis-tareas no devuelven resultados aunque ya
hayamos normalizado los lotes en BD.
"""
import sys

p = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
s = open(p).read()

count = 0
old_line = "l.responsable = :resp"
new_line = "REPLACE(l.responsable, '  ', ' ') = REPLACE(:resp, '  ', ' ')"

# Reemplazar todas las ocurrencias dentro de getMisTareas
if old_line not in s:
    print('NOT FOUND: no es necesario o ya está parcheado.')
    # Verificar si ya está parcheado
    if "REPLACE(l.responsable, '  ', ' ')" in s:
        print('Ya parcheado.')
    sys.exit(0)

# Solo reemplazar dentro de getMisTareas/getOperarios (cualquier uso en lotes_produccion con responsable)
# Hago un reemplazo conservador en TODO el archivo donde aparezca exactamente esa cadena.
new_s = s.replace(old_line, new_line)
count = s.count(old_line)

open(p, 'w').write(new_s)
print(f'OK: reemplazadas {count} ocurrencias de match exacto por REPLACE.')
