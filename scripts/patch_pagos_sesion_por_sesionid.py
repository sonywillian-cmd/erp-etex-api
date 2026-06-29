"""Fix: pagosDeSesion y resumenMetodosSesion filtran por timestamp en lugar
de por sesion_caja_id. Cuando el sistema crea un factura_pago retroactivo
(p. ej. al convertir un anticipo viejo en pago de factura emitida hoy),
el registro aparece falsamente en la sesión actual porque su creado_en es
de hoy aunque su sesion_caja_id sea NULL.

Cambiamos el filtro a `sesion_caja_id = ?` que es la asociación correcta.
"""
import sys

p = '/home/u372536694/apps/api/dist/caja/caja.service.js'
s = open(p).read()

# Modificar pagosDeSesion
old1 = """      FROM factura_pagos fp
      JOIN facturas fa ON fa.id = fp.factura_id
      WHERE fp.creado_en >= ?
        AND fp.creado_en <= ?
        AND fa.estado != 'anulada'

      UNION ALL"""
new1 = """      FROM factura_pagos fp
      JOIN facturas fa ON fa.id = fp.factura_id
      WHERE fp.sesion_caja_id = ?
        AND fa.estado != 'anulada'

      UNION ALL"""

old2 = """      FROM recibos_ingreso ri
      LEFT JOIN ordenes_produccion op ON op.id = ri.orden_produccion_id
      WHERE ri.creado_en >= ?
        AND ri.creado_en <= ?
        AND ri.factura_id IS NULL

      ORDER BY fp_creado_en DESC
    `, [sesion.fecha_apertura, hasta, sesion.fecha_apertura, hasta]);"""
new2 = """      FROM recibos_ingreso ri
      LEFT JOIN ordenes_produccion op ON op.id = ri.orden_produccion_id
      WHERE ri.sesion_caja_id = ?
        AND ri.factura_id IS NULL

      ORDER BY fp_creado_en DESC
    `, [id, id]);"""

# Modificar resumenMetodosSesion (mismo patrón)
old3 = """        SELECT CONVERT(fp.metodo USING utf8mb4) AS metodo, fp.monto
        FROM factura_pagos fp
        JOIN facturas fa ON fa.id = fp.factura_id
        WHERE fp.creado_en >= ?
          AND fp.creado_en <= ?
          AND fa.estado != 'anulada'
        UNION ALL
        SELECT CONVERT(ri.metodo USING utf8mb4) AS metodo, ri.monto
        FROM recibos_ingreso ri
        WHERE ri.creado_en >= ?
          AND ri.creado_en <= ?
          AND ri.factura_id IS NULL
      ) combined
      GROUP BY metodo
    `, [sesion.fecha_apertura, hasta, sesion.fecha_apertura, hasta]);"""

new3 = """        SELECT CONVERT(fp.metodo USING utf8mb4) AS metodo, fp.monto
        FROM factura_pagos fp
        JOIN facturas fa ON fa.id = fp.factura_id
        WHERE fp.sesion_caja_id = ?
          AND fa.estado != 'anulada'
        UNION ALL
        SELECT CONVERT(ri.metodo USING utf8mb4) AS metodo, ri.monto
        FROM recibos_ingreso ri
        WHERE ri.sesion_caja_id = ?
          AND ri.factura_id IS NULL
      ) combined
      GROUP BY metodo
    `, [id, id]);"""

if "fp.sesion_caja_id = ?" in s and "ri.sesion_caja_id = ?" in s:
    print('Ya parcheado.')
    sys.exit(0)

changes = 0
for old, new in [(old1, new1), (old2, new2), (old3, new3)]:
    if old in s:
        s = s.replace(old, new, 1)
        changes += 1
    else:
        print(f'ADVERTENCIA: bloque #{changes+1} no encontrado, omitido.')

open(p, 'w').write(s)
print(f'OK: {changes} bloques parcheados. Pagos ahora se filtran por sesion_caja_id.')
