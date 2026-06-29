"""Evitar mostrar el lote departamento PADRE cuando tiene tareas hijas.

Si Sandy tiene asignado el L1 (BORDADO departamento) y también el L3 (BORDADO
EN MAQUINA tarea hija), ver ambos en la lista es ruido — basta con ver la
tarea concreta. La misma lógica ya existe en "disponibles" pero faltaba en
"asignados".
"""
p = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
s = open(p).read()

# Patrón a localizar: el bloque de asignados ya parcheado.
old = (
    "            .andWhere('l.estado IN (:...estados)', { estados: estadosActivos })\n"
    "            // Excluir lotes de órdenes ya terminadas. Esos lotes quedan en BD\n"
    "            // pero no son trabajo pendiente real — son huérfanos del cierre.\n"
    "            .andWhere(\"o2.estado NOT IN ('listo','listo_parcial','entregado','cancelado')\")\n"
    "            .orderBy('l.orden_ejecucion', 'ASC')"
)
new = (
    "            .andWhere('l.estado IN (:...estados)', { estados: estadosActivos })\n"
    "            // Excluir lotes de órdenes ya terminadas. Esos lotes quedan en BD\n"
    "            // pero no son trabajo pendiente real — son huérfanos del cierre.\n"
    "            .andWhere(\"o2.estado NOT IN ('listo','listo_parcial','entregado','cancelado')\")\n"
    "            // Si el lote es 'departamento' Y tiene tareas hijas, NO mostrar el padre:\n"
    "            // las tareas hijas son las que el operario debe ejecutar.\n"
    "            .andWhere(`(l.tipo = 'tarea' OR (l.tipo = 'departamento' AND NOT EXISTS (\n"
    "                SELECT 1 FROM lotes_produccion sub WHERE sub.lote_padre_id = l.id AND sub.tipo = 'tarea'\n"
    "            )))`)\n"
    "            .orderBy('l.orden_ejecucion', 'ASC')"
)

if "(l.tipo = 'tarea' OR (l.tipo = 'departamento' AND NOT EXISTS (" in s and 'asignados' in s.split("Excluir lotes de órdenes")[1][:500]:
    # Ya hay esa cláusula en asignados (no solo en disponibles)
    pass

if old not in s:
    print('ERROR: no encontrado el bloque exacto. Tal vez el patch ya fue aplicado.')
    raise SystemExit(0)

s = s.replace(old, new)
open(p, 'w').write(s)
print('OK: dedupe de padre-departamento aplicado a asignados.')
