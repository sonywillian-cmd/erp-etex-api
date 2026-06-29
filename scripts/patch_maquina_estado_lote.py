"""Fix: la máquina se enviaba desde el frontend pero el controller no la pasaba
al service y el service no la guardaba. Resultado: el campo maquina del lote
quedaba NULL siempre que se iniciaba via /produccion/lotes/:loteId/estado.

Aplica 3 cambios:
1) Controller: agregar parámetro `maquina` con @Body('maquina') y pasarlo al svc.
2) Controller decorator: registrar el nuevo Body param.
3) Service: aceptar y persistir `maquina` cuando estado pasa a EN_PROCESO.
"""
import sys

CTL = '/home/u372536694/apps/api/dist/produccion/produccion.controller.js'
SVC = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'

# --- Controller method ---
c = open(CTL).read()
old_method = """    estadoLote(loteId, estado, responsable, piezas_ok, piezas_retrabajo, piezas_descarte) {
        const piezas = (piezas_ok != null || piezas_retrabajo != null || piezas_descarte != null)
            ? { piezas_ok: piezas_ok ?? 0, piezas_retrabajo: piezas_retrabajo ?? 0, piezas_descarte: piezas_descarte ?? 0 }
            : undefined;
        return this.svc.actualizarEstadoLote(loteId, estado, responsable, piezas);
    }"""
new_method = """    estadoLote(loteId, estado, responsable, piezas_ok, piezas_retrabajo, piezas_descarte, maquina) {
        const piezas = (piezas_ok != null || piezas_retrabajo != null || piezas_descarte != null)
            ? { piezas_ok: piezas_ok ?? 0, piezas_retrabajo: piezas_retrabajo ?? 0, piezas_descarte: piezas_descarte ?? 0 }
            : undefined;
        return this.svc.actualizarEstadoLote(loteId, estado, responsable, piezas, maquina);
    }"""
if "actualizarEstadoLote(loteId, estado, responsable, piezas, maquina)" in c:
    print('Controller method ya parcheado.')
else:
    if old_method not in c:
        print('ERROR: no se encontró el método estadoLote en controller')
        sys.exit(1)
    c = c.replace(old_method, new_method, 1)
    print('Controller method parcheado.')

# --- Controller decorator: agregar @Body('maquina') ---
old_dec = """    __param(5, (0, common_1.Body)('piezas_descarte')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String, Number, Number, Number]),
    __metadata("design:returntype", void 0)
], ProduccionController.prototype, "estadoLote", null);"""

new_dec = """    __param(5, (0, common_1.Body)('piezas_descarte')),
    __param(6, (0, common_1.Body)('maquina')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String, Number, Number, Number, String]),
    __metadata("design:returntype", void 0)
], ProduccionController.prototype, "estadoLote", null);"""

if "__param(6, (0, common_1.Body)('maquina'))" in c:
    print('Controller decorator ya parcheado.')
else:
    if old_dec not in c:
        print('ERROR: no se encontró el decorator de estadoLote')
        sys.exit(1)
    c = c.replace(old_dec, new_dec, 1)
    print('Controller decorator parcheado.')

open(CTL, 'w').write(c)

# --- Service: aceptar maquina y persistirla cuando se inicia ---
s = open(SVC).read()
old_svc_sig = "    async actualizarEstadoLote(loteId, estado, responsable, piezas) {"
new_svc_sig = "    async actualizarEstadoLote(loteId, estado, responsable, piezas, maquina) {"
if "actualizarEstadoLote(loteId, estado, responsable, piezas, maquina)" in s:
    print('Service signature ya parcheada.')
else:
    if old_svc_sig not in s:
        print('ERROR: signature del service no encontrada')
        sys.exit(1)
    s = s.replace(old_svc_sig, new_svc_sig, 1)
    print('Service signature parcheada.')

# Persistir maquina en el update cuando pasa a EN_PROCESO
old_update = """            if (estado === lote_produccion_entity_1.EstadoLote.EN_PROCESO && !lote.tiempo_inicio)
                update.tiempo_inicio = new Date();"""

new_update = """            if (estado === lote_produccion_entity_1.EstadoLote.EN_PROCESO && !lote.tiempo_inicio)
                update.tiempo_inicio = new Date();
            if (estado === lote_produccion_entity_1.EstadoLote.EN_PROCESO && maquina)
                update.maquina = maquina;"""

if "update.maquina = maquina" in s:
    print('Service maquina update ya parcheado.')
else:
    if old_update not in s:
        print('ERROR: bloque tiempo_inicio del service no encontrado')
        sys.exit(1)
    s = s.replace(old_update, new_update, 1)
    print('Service maquina persistence parcheada.')

open(SVC, 'w').write(s)
print('OK: máquina ahora se guarda al iniciar lote.')
