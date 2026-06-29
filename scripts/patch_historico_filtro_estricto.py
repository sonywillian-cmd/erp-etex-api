"""Patch historicoOperario: hacer el filtro de técnica/departamento ESTRICTO.

Antes: si filtrabas 'DISEÑO BORDADO', el EXISTS expandía a TODOS los lotes
de cualquier orden que tuviera UN lote de DISEÑO BORDADO. Eso traía también
los lotes de BORDADO y TERMINACION de esas mismas órdenes.

Después: match estricto al departamento o tarea_nombre del lote mismo.
"""
import sys

p = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
s = open(p).read()

old = """            where.push(`(
                LOWER(l.tecnica) LIKE CONCAT('%', LOWER(?), '%')
                OR LOWER(l.departamento) LIKE CONCAT('%', LOWER(?), '%')
                OR LOWER(IFNULL(l.tarea_nombre,'')) LIKE CONCAT('%', LOWER(?), '%')
                OR EXISTS (
                    SELECT 1 FROM lotes_produccion ol
                    WHERE ol.orden_id = l.orden_id
                    AND (
                        LOWER(ol.tecnica) LIKE CONCAT('%', LOWER(?), '%')
                        OR LOWER(ol.departamento) LIKE CONCAT('%', LOWER(?), '%')
                        OR LOWER(IFNULL(ol.tarea_nombre,'')) LIKE CONCAT('%', LOWER(?), '%')
                    )
                )
            )`);
            bind.push(tecnica, tecnica, tecnica, tecnica, tecnica, tecnica);"""

new = """            // Filtro estricto: solo el lote mismo, sin expandir a hermanos de
            // la misma orden. Así filtrar 'DISEÑO BORDADO' devuelve únicamente
            // los lotes de diseño, no los lotes de bordado/terminación que
            // estén en la misma orden.
            where.push(`(
                LOWER(l.departamento) = LOWER(?)
                OR LOWER(l.tecnica) = LOWER(?)
                OR LOWER(IFNULL(l.tarea_nombre,'')) = LOWER(?)
            )`);
            bind.push(tecnica, tecnica, tecnica);"""

if 'Filtro estricto' in s:
    print('Ya parcheado.')
elif old not in s:
    print('ERROR: no se encontró el bloque del filtro de técnica')
    sys.exit(1)
else:
    s = s.replace(old, new)
    open(p, 'w').write(s)
    print('OK: filtro estricto aplicado.')
