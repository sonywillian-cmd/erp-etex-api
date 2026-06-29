"""Filtrar de mis-tareas los lotes cuyas órdenes ya están terminadas.

Sin esto, si una orden se cierra/entrega sin completar todas sus tareas
asignadas, los lotes pendientes/desbloqueados quedan huérfanos y aparecen
en 'Mis tareas' del operario aunque ya no hay nada que hacer.
"""
p = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
s = open(p).read()

if "innerJoin('ordenes_produccion'" in s and "o2.estado NOT IN" in s:
    print('Ya parcheado.')
    raise SystemExit(0)

# Patrón actual del bloque "asignados"
old = (
    "        const asignados = await this.lotesRepo\n"
    "            .createQueryBuilder('l')\n"
    "            .where(`LOWER(REPLACE(l.responsable, '  ', ' ')) = LOWER(REPLACE(:resp, '  ', ' '))"
    " OR LOWER(REPLACE(l.responsable, '  ', ' ')) LIKE CONCAT(LOWER(REPLACE(:resp, '  ', ' ')), ' %')"
    " OR LOWER(REPLACE(:resp, '  ', ' ')) LIKE CONCAT(LOWER(REPLACE(l.responsable, '  ', ' ')), ' %')`, { resp: responsable })\n"
    "            .andWhere('l.estado IN (:...estados)', { estados: estadosActivos })\n"
    "            .orderBy('l.orden_ejecucion', 'ASC')\n"
    "            .addOrderBy('l.id', 'ASC')\n"
    "            .getMany();"
)
new = (
    "        const asignados = await this.lotesRepo\n"
    "            .createQueryBuilder('l')\n"
    "            .innerJoin('ordenes_produccion', 'o2', 'o2.id = l.orden_id')\n"
    "            .where(`LOWER(REPLACE(l.responsable, '  ', ' ')) = LOWER(REPLACE(:resp, '  ', ' '))"
    " OR LOWER(REPLACE(l.responsable, '  ', ' ')) LIKE CONCAT(LOWER(REPLACE(:resp, '  ', ' ')), ' %')"
    " OR LOWER(REPLACE(:resp, '  ', ' ')) LIKE CONCAT(LOWER(REPLACE(l.responsable, '  ', ' ')), ' %')`, { resp: responsable })\n"
    "            .andWhere('l.estado IN (:...estados)', { estados: estadosActivos })\n"
    "            // Excluir lotes de órdenes ya terminadas. Esos lotes quedan en BD\n"
    "            // pero no son trabajo pendiente real — son huérfanos del cierre.\n"
    "            .andWhere(\"o2.estado NOT IN ('listo','listo_parcial','entregado','cancelado')\")\n"
    "            .orderBy('l.orden_ejecucion', 'ASC')\n"
    "            .addOrderBy('l.id', 'ASC')\n"
    "            .getMany();"
)

if old not in s:
    print('ERROR: no se encontró el bloque exacto (puede haber cambiado formato).')
    raise SystemExit(1)

s = s.replace(old, new)
open(p, 'w').write(s)
print('OK: filtro de órdenes terminadas aplicado al asignados.')

# Hacer lo mismo para "disponibles" para no mostrar tareas sueltas de
# órdenes ya cerradas
old_disp = (
    "        const dispQb = this.lotesRepo\n"
    "            .createQueryBuilder('l')\n"
    "            .where('l.estado = :estado', { estado: lote_produccion_entity_1.EstadoLote.DESBLOQUEADO })\n"
    "            .andWhere('l.responsable IS NULL')\n"
)
new_disp = (
    "        const dispQb = this.lotesRepo\n"
    "            .createQueryBuilder('l')\n"
    "            .innerJoin('ordenes_produccion', 'o2', 'o2.id = l.orden_id')\n"
    "            .where('l.estado = :estado', { estado: lote_produccion_entity_1.EstadoLote.DESBLOQUEADO })\n"
    "            .andWhere('l.responsable IS NULL')\n"
    "            .andWhere(\"o2.estado NOT IN ('listo','listo_parcial','entregado','cancelado')\")\n"
)
if old_disp in open(p).read():
    s2 = open(p).read().replace(old_disp, new_disp)
    open(p, 'w').write(s2)
    print('OK: filtro también aplicado a disponibles.')
else:
    print('WARN: no se aplicó a disponibles (patrón no encontrado).')
