"""Arregla parsing de fecha_inicio/fecha_fin que MySQL devuelve como objeto Date.
El codigo anterior concatenaba 'T00:00:00' al objeto Date -> resultaba en Invalid Date
-> no se generaban ocurrencias."""

SVC = '/home/u372536694/apps/api/dist/compromisos/compromisos.service.js'

s = open(SVC).read()

viejo = """  generarFechas(c) {
    const fechas = [];
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    const inicio = c.fecha_inicio ? new Date(c.fecha_inicio + 'T00:00:00') : hoy;
    const limite = c.fecha_fin
      ? new Date(c.fecha_fin + 'T00:00:00')
      : new Date(hoy.getFullYear()+1, hoy.getMonth(), hoy.getDate());"""

nuevo = """  generarFechas(c) {
    const fechas = [];
    const hoy = new Date();
    hoy.setHours(0,0,0,0);

    // MySQL devuelve DATE como objeto Date; aseguramos un Date valido a medianoche local
    const toLocalDate = (v) => {
      if (!v) return null;
      if (v instanceof Date) {
        return new Date(v.getFullYear(), v.getMonth(), v.getDate());
      }
      const str = String(v).slice(0, 10);
      const partes = str.split('-');
      if (partes.length === 3) {
        return new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
      }
      return new Date(str + 'T00:00:00');
    };

    const inicio = toLocalDate(c.fecha_inicio) || hoy;
    const limite = toLocalDate(c.fecha_fin)
      || new Date(hoy.getFullYear() + 1, hoy.getMonth(), hoy.getDate());"""

if viejo in s:
    s = s.replace(viejo, nuevo, 1)
    open(SVC, 'w').write(s)
    print('OK: parser de fechas corregido para aceptar objetos Date de MySQL.')
elif 'toLocalDate' in s:
    print('Ya estaba parcheado.')
else:
    print('ERROR: bloque generarFechas no encontrado')
