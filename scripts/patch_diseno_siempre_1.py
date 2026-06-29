"""Patch calcCantidadPorTecnica: si el departamento contiene 'diseño/diseno',
SIEMPRE devolver 1 — porque el diseño es trabajo único (1 archivo, 1 punteo,
etc.) sin importar cuántas piezas se vayan a producir.
"""
p = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
s = open(p).read()

old = """    calcCantidadPorTecnica(lineas, producto, tecnica, departamento, unidadDeTrabajo) {
        if (!lineas.length)
            return 1;"""

new = """    calcCantidadPorTecnica(lineas, producto, tecnica, departamento, unidadDeTrabajo) {
        if (!lineas.length)
            return 1;
        // Los departamentos de DISEÑO son trabajo único (1 archivo/punteo/arte
        // sirve para todas las piezas). Siempre cuenta como 1 sin importar
        // cuántas piezas se vayan a producir despues.
        const __dep = (departamento ?? '').toLowerCase().trim();
        if (__dep.includes('dise')) return 1;"""

if 'dep.includes(\'dise\')' in s or '__dep.includes' in s:
    print('Ya parcheado.')
elif old not in s:
    print('ERROR: no se encontró el bloque calcCantidadPorTecnica')
else:
    s = s.replace(old, new)
    open(p, 'w').write(s)
    print('OK: diseños ahora siempre cuentan como 1 pieza.')
