"""Hace que la query de piezasPorDepto en incentivos deduplique los lotes
padre cuando tienen tareas hijas. Sin esto, las calificaciones cuentan
DOBLE: el L1 BORDADO (departamento) Y el L3 BORDADO EN MAQUINA (tarea hija).

Aplica el mismo criterio que ya usa el histórico.
"""
p = '/home/u372536694/apps/api/dist/incentivos/incentivos.service.js'
s = open(p).read()

# Patrón actual de las 2 ocurrencias de piezasPorDepto.
# Una está sin incentivo, otra con incentivo (linea ~217 aprox).
old = """SELECT l.departamento, COALESCE(SUM(l.piezas_ok), 0) AS total
         FROM lotes_produccion l
         WHERE l.responsable = ?
           AND l.estado = 'completado'
           AND l.piezas_ok IS NOT NULL
           AND l.piezas_ok > 0
           AND DATE(l.tiempo_fin) BETWEEN ? AND ?
         GROUP BY l.departamento"""

new = """SELECT l.departamento, COALESCE(SUM(l.piezas_ok), 0) AS total
         FROM lotes_produccion l
         WHERE l.responsable = ?
           AND l.estado = 'completado'
           AND l.piezas_ok IS NOT NULL
           AND l.piezas_ok > 0
           AND DATE(l.tiempo_fin) BETWEEN ? AND ?
           AND (l.tipo = 'tarea' OR (l.tipo = 'departamento' AND NOT EXISTS (
             SELECT 1 FROM lotes_produccion sub WHERE sub.lote_padre_id = l.id AND sub.tipo = 'tarea'
           )))
         GROUP BY l.departamento"""

if "AND (l.tipo = 'tarea' OR (l.tipo = 'departamento'" in s:
    print('Ya parcheado.')
    raise SystemExit(0)

cnt = s.count(old)
print(f'Ocurrencias a parchear: {cnt}')
if cnt == 0:
    print('ERROR: no se encontró la query exacta.')
    raise SystemExit(1)

s = s.replace(old, new)
open(p, 'w').write(s)
print(f'OK: {cnt} ocurrencias parcheadas.')
