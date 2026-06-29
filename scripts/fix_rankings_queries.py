"""Fix product vs service queries — usar tipo_producto del producto, no regex de descripcion."""

F = '/home/u372536694/apps/api/dist/metricas/metricas.service.js'
s = open(F).read()

# Buscar el bloque de NOT REGEXP y reemplazar las queries de productos y servicios
# Vamos a usar marcadores únicos para localizar las queries

marker_start_prod = '        // TOP PRODUCTOS (fisicos)'
marker_start_serv = '        // TOP SERVICIOS'
marker_end_serv   = '        // TOP OPERARIOS'

idx_prod = s.find(marker_start_prod)
idx_serv = s.find(marker_start_serv)
idx_end = s.find(marker_end_serv)

if idx_prod < 0 or idx_serv < 0 or idx_end < 0:
    print('ERR: marcadores no encontrados')
    raise SystemExit(1)

bloque_nuevo = '''        // TOP PRODUCTOS (fisicos) — top 10 por monto vendido
        // Si la linea tiene producto, usar tipo_producto. Si no, mirar si descripcion empieza con SERVICIO
        const topProductos = await this.ds.query(`
            SELECT
                COALESCE(p.nombre, SUBSTRING_INDEX(fl.descripcion, ' \\u2014 ', 1)) AS nombre,
                p.id AS producto_id,
                COALESCE(p.tipo_producto, 'sin_clasificar') AS tipo,
                SUM(fl.cantidad) AS cantidad,
                ROUND(SUM(fl.subtotal), 2) AS monto
            FROM factura_lineas fl
            LEFT JOIN productos p ON p.id = fl.producto_id
            LEFT JOIN facturas f ON f.id = fl.factura_id
            WHERE f.fecha_emision BETWEEN ? AND ?
              AND f.estado != 'anulada'
              AND (
                  p.tipo_producto IN ('fisico_fabricado', 'fisico_comprado')
                  OR (p.id IS NULL AND UPPER(fl.descripcion) NOT LIKE 'SERVICIO%')
              )
            GROUP BY producto_id, nombre, tipo
            HAVING monto > 0
            ORDER BY monto DESC
            LIMIT 10
        `, [desde, hastaInclusive]);

        // TOP SERVICIOS — top 10 por monto generado
        const topServicios = await this.ds.query(`
            SELECT
                COALESCE(p.nombre, SUBSTRING_INDEX(fl.descripcion, ' \\u2014 ', 1)) AS nombre,
                p.id AS producto_id,
                SUM(fl.cantidad) AS cantidad,
                ROUND(SUM(fl.subtotal), 2) AS monto
            FROM factura_lineas fl
            LEFT JOIN productos p ON p.id = fl.producto_id
            LEFT JOIN facturas f ON f.id = fl.factura_id
            WHERE f.fecha_emision BETWEEN ? AND ?
              AND f.estado != 'anulada'
              AND (
                  p.tipo_producto = 'servicio'
                  OR (p.id IS NULL AND UPPER(fl.descripcion) LIKE 'SERVICIO%')
              )
            GROUP BY producto_id, nombre
            HAVING monto > 0
            ORDER BY monto DESC
            LIMIT 10
        `, [desde, hastaInclusive]);

'''

s_new = s[:idx_prod] + bloque_nuevo + s[idx_end:]
open(F, 'w').write(s_new)
print('OK: queries reemplazadas')
