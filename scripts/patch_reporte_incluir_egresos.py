"""Hacer que el reporte mensual sume EGRESOS DE CAJA al total de costos/gastos.

Antes: solo se contaban los registros en tabla `gastos`
Después: se cuentan gastos + egresos_caja del mismo período, ambos con su
clasificación contable (costo/gasto).

También agrega un campo `egresos` al response con el desglose para que el
frontend pueda mostrarlo separadamente si quiere.
"""
import sys

p = '/home/u372536694/apps/api/dist/metricas/metricas.service.js'
s = open(p).read()

if 'totalEgresos' in s or 'egresos_caja' in s:
    print('Ya parcheado.')
    raise SystemExit(0)

# Patch 1: cambiar la query de por_clasificacion para que sume egresos también
old_clasif = """        // GASTOS POR CLASIFICACIÓN CONTABLE (costo de producción vs gasto operativo)
        const porClasificacion = await this.ds.query(`
            SELECT clasificacion_contable AS clasificacion,
                   COUNT(*) AS cant,
                   ROUND(COALESCE(SUM(monto),0),2) AS total
            FROM gastos WHERE fecha BETWEEN ? AND ?
            GROUP BY clasificacion_contable
        `, [desde, hasta]);"""

new_clasif = """        // GASTOS POR CLASIFICACIÓN CONTABLE (costo de producción vs gasto operativo)
        // Une los registros de la tabla `gastos` con `egresos_caja` para que el
        // reporte refleje TODAS las salidas de dinero (formales + informales de caja).
        const porClasificacion = await this.ds.query(`
            SELECT clasificacion, SUM(cant) AS cant, ROUND(SUM(total),2) AS total
            FROM (
                SELECT clasificacion_contable AS clasificacion, COUNT(*) AS cant, COALESCE(SUM(monto),0) AS total
                FROM gastos WHERE fecha BETWEEN ? AND ? GROUP BY clasificacion_contable
                UNION ALL
                SELECT clasificacion_contable AS clasificacion, COUNT(*) AS cant, COALESCE(SUM(monto),0) AS total
                FROM egresos_caja WHERE fecha BETWEEN ? AND ? GROUP BY clasificacion_contable
            ) AS combinado
            GROUP BY clasificacion
        `, [desde, hasta, desde, hasta]);

        // EGRESOS DE CAJA solos (para mostrar separado)
        const egresosCaja = await this.ds.query(`
            SELECT clasificacion_contable AS clasificacion, COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
            FROM egresos_caja WHERE fecha BETWEEN ? AND ? GROUP BY clasificacion_contable
        `, [desde, hasta]);
        const [totalEgresos] = await this.ds.query(`
            SELECT COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
            FROM egresos_caja WHERE fecha BETWEEN ? AND ?
        `, [desde, hasta]);"""

if old_clasif not in s:
    print('ERROR: bloque porClasificacion no encontrado'); sys.exit(1)
s = s.replace(old_clasif, new_clasif, 1)

# Patch 2: cambiar la query de por_categoria para que también incluya egresos
old_cat = """        // GASTOS POR CATEGORÍA (top 10 — para ver dónde se va el dinero)
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

new_cat = """        // CATEGORÍAS DE GASTOS + EGRESOS (top 10 — para ver dónde se va el dinero)
        // Para egresos sin categoría llenada, usamos el destinatario o la enum
        const porCategoria = await this.ds.query(`
            SELECT categoria, clasificacion, SUM(cant) AS cant, ROUND(SUM(total),2) AS total
            FROM (
                SELECT IFNULL(categoria, 'Sin categoría') AS categoria,
                       clasificacion_contable AS clasificacion,
                       COUNT(*) AS cant, COALESCE(SUM(monto),0) AS total
                FROM gastos WHERE fecha BETWEEN ? AND ?
                GROUP BY categoria, clasificacion_contable
                UNION ALL
                SELECT CASE WHEN categoria IS NULL OR categoria = '' THEN 'Egreso de caja' ELSE categoria END AS categoria,
                       clasificacion_contable AS clasificacion,
                       COUNT(*) AS cant, COALESCE(SUM(monto),0) AS total
                FROM egresos_caja WHERE fecha BETWEEN ? AND ?
                GROUP BY categoria, clasificacion_contable
            ) AS combinado
            GROUP BY categoria, clasificacion
            ORDER BY total DESC LIMIT 10
        `, [desde, hasta, desde, hasta]);"""

if old_cat not in s:
    print('ERROR: bloque porCategoria no encontrado'); sys.exit(1)
s = s.replace(old_cat, new_cat, 1)

# Patch 3: agregar `egresos` al return
old_return = "            gastos: { por_tipo: gastos, por_clasificacion: porClasificacion, por_categoria: porCategoria },"
new_return = """            gastos: { por_tipo: gastos, por_clasificacion: porClasificacion, por_categoria: porCategoria },
            egresos: { por_clasificacion: egresosCaja, total: totalEgresos },"""

if old_return not in s:
    print('ERROR: return no encontrado'); sys.exit(1)
s = s.replace(old_return, new_return, 1)

open(p, 'w').write(s)
print('OK: reporte mensual ahora incluye egresos_caja en el desglose.')
