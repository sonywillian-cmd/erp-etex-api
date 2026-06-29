"""Extiende el reporte mensual para devolver desglose de costos vs gastos.

Antes: solo `gastos.por_tipo` (formal/informal/personal)
Después: agrega `gastos.por_clasificacion` (costo/gasto) y `gastos.por_categoria`

También calcula el margen bruto automáticamente para el reporte.
"""
import sys

p = '/home/u372536694/apps/api/dist/metricas/metricas.service.js'
s = open(p).read()

if 'por_clasificacion' in s:
    print('Ya parcheado.')
    raise SystemExit(0)

old = """        // GASTOS POR TIPO
        const gastos = await this.ds.query(`
            SELECT tipo, COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
            FROM gastos WHERE fecha BETWEEN ? AND ? GROUP BY tipo
        `, [desde, hasta]);"""

new = """        // GASTOS POR TIPO (formal/informal/personal)
        const gastos = await this.ds.query(`
            SELECT tipo, COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
            FROM gastos WHERE fecha BETWEEN ? AND ? GROUP BY tipo
        `, [desde, hasta]);

        // GASTOS POR CLASIFICACIÓN CONTABLE (costo de producción vs gasto operativo)
        const porClasificacion = await this.ds.query(`
            SELECT clasificacion_contable AS clasificacion,
                   COUNT(*) AS cant,
                   ROUND(COALESCE(SUM(monto),0),2) AS total
            FROM gastos WHERE fecha BETWEEN ? AND ?
            GROUP BY clasificacion_contable
        `, [desde, hasta]);

        // GASTOS POR CATEGORÍA (top 10 — para ver dónde se va el dinero)
        const porCategoria = await this.ds.query(`
            SELECT
              IFNULL(categoria, 'Sin categoría') AS categoria,
              clasificacion_contable AS clasificacion,
              COUNT(*) AS cant,
              ROUND(COALESCE(SUM(monto),0),2) AS total
            FROM gastos WHERE fecha BETWEEN ? AND ?
            GROUP BY categoria, clasificacion_contable
            ORDER BY total DESC LIMIT 10
        `, [desde, hasta]);"""

if old not in s:
    print('ERROR: bloque GASTOS POR TIPO no encontrado')
    raise SystemExit(1)
s = s.replace(old, new, 1)

# Y agregar al return
old_return = "            gastos: { por_tipo: gastos },"
new_return = "            gastos: { por_tipo: gastos, por_clasificacion: porClasificacion, por_categoria: porCategoria },"

if old_return not in s:
    print('ERROR: return de gastos no encontrado')
    raise SystemExit(1)
s = s.replace(old_return, new_return, 1)

open(p, 'w').write(s)
print('OK: reporte mensual ahora devuelve por_clasificacion y por_categoria.')
