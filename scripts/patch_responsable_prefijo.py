"""Hace que el match de responsable en mis-tareas/historico sea tolerante a
nombres parciales (SANDY vs SANDY COPLIN) y a doble espacio.

Patrón actual (con backticks template literal):
    .where(`REPLACE(l.responsable, '  ', ' ') = REPLACE(:resp, '  ', ' ')`, { resp: responsable })

Se cambia por:
    .where(`
        LOWER(REPLACE(l.responsable, '  ', ' ')) = LOWER(REPLACE(:resp, '  ', ' '))
        OR LOWER(REPLACE(l.responsable, '  ', ' ')) LIKE CONCAT(LOWER(REPLACE(:resp, '  ', ' ')), ' %')
        OR LOWER(REPLACE(:resp, '  ', ' ')) LIKE CONCAT(LOWER(REPLACE(l.responsable, '  ', ' ')), ' %')
    `, { resp: responsable })
"""
p = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
s = open(p).read()

if 'LIKE CONCAT(LOWER(REPLACE' in s:
    print('Ya parcheado.')
    raise SystemExit(0)

old = ".where(`REPLACE(l.responsable, '  ', ' ') = REPLACE(:resp, '  ', ' ')`, { resp: responsable })"
new = (
    ".where(`"
    "LOWER(REPLACE(l.responsable, '  ', ' ')) = LOWER(REPLACE(:resp, '  ', ' '))"
    " OR LOWER(REPLACE(l.responsable, '  ', ' ')) LIKE CONCAT(LOWER(REPLACE(:resp, '  ', ' ')), ' %')"
    " OR LOWER(REPLACE(:resp, '  ', ' ')) LIKE CONCAT(LOWER(REPLACE(l.responsable, '  ', ' ')), ' %')"
    "`, { resp: responsable })"
)

cnt = s.count(old)
print(f'Ocurrencias a parchear: {cnt}')
if cnt == 0:
    print('ERROR: patrón exacto no encontrado, abortando para no romper.')
    raise SystemExit(1)

s = s.replace(old, new)
open(p, 'w').write(s)
print('OK: backend tolera nombres parciales/incompletos.')

# Tambien el historico que usa el patron en una linea SQL distinto
# (where.push string, sin backticks)
s2 = open(p).read()
old_hist = "where.push(\"REPLACE(l.responsable, '  ', ' ') = REPLACE(?, '  ', ' ')\"); bind.push(responsable);"
new_hist = (
    'where.push("LOWER(REPLACE(l.responsable, \'  \', \' \')) = LOWER(REPLACE(?, \'  \', \' \')) '
    'OR LOWER(REPLACE(l.responsable, \'  \', \' \')) LIKE CONCAT(LOWER(REPLACE(?, \'  \', \' \')), \' %\') '
    'OR LOWER(REPLACE(?, \'  \', \' \')) LIKE CONCAT(LOWER(REPLACE(l.responsable, \'  \', \' \')), \' %\')"); '
    'bind.push(responsable, responsable, responsable);'
)
cnt2 = s2.count(old_hist)
print(f'Ocurrencias en historico: {cnt2}')
if cnt2 > 0:
    s2 = s2.replace(old_hist, new_hist)
    open(p, 'w').write(s2)
    print('OK: historico también parcheado.')
