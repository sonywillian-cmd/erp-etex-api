"""Restaura el endpoint /produccion/historico-operario que se perdió en deploys
anteriores. Toma el código del backup .bak.20260524_181552 y lo integra en
el produccion.service.js y produccion.controller.js actuales.

Además, hace la búsqueda por `responsable` tolerante a dobles espacios para
que casos como 'SANDY  COPLIN' (con doble espacio en BD) sigan funcionando.

Idempotent.
"""
import sys, re

SVC = '/home/u372536694/apps/api/dist/produccion/produccion.service.js'
CTL = '/home/u372536694/apps/api/dist/produccion/produccion.controller.js'
SVC_BAK = '/home/u372536694/apps/api/dist/produccion/produccion.service.js.bak.20260524_181552'
CTL_BAK = '/home/u372536694/apps/api/dist/produccion/produccion.controller.js.bkp_maq'

# 1) SERVICE -------------------------------------------------------------
svc = open(SVC).read()
if 'async historicoOperario' in svc:
    print('Service already has historicoOperario.')
else:
    bak = open(SVC_BAK).read()
    # Extraer el método: empieza en '    async historicoOperario(params) {' y termina en
    # el siguiente '    async ' al mismo nivel de indentación.
    start_marker = '    async historicoOperario(params) {'
    s_idx = bak.find(start_marker)
    if s_idx < 0:
        print('ERROR: no encuentra historicoOperario en el backup'); sys.exit(1)
    # Buscar el siguiente método ('    async XXX(' en bak)
    n_idx = bak.find('\n    async ', s_idx + 50)
    if n_idx < 0:
        print('ERROR: no encuentra el final del método'); sys.exit(1)
    method_code = bak[s_idx:n_idx]
    # Normalizar el filtro responsable: tolerar dobles espacios usando
    # REPLACE() en ambos lados. Reemplazamos
    #   where.push(`l.responsable = ?`); bind.push(responsable);
    # por
    #   where.push(`REPLACE(l.responsable, '  ', ' ') = REPLACE(?, '  ', ' ')`); bind.push(responsable);
    method_code = method_code.replace(
        "where.push(`l.responsable = ?`); bind.push(responsable);",
        "where.push(\"REPLACE(l.responsable, '  ', ' ') = REPLACE(?, '  ', ' ')\"); bind.push(responsable);",
    )

    # Insertar antes del marker de cierre de clase
    insert_marker = "};\nexports.ProduccionService"
    if insert_marker not in svc:
        print('ERROR: no encuentra el cierre de clase del service'); sys.exit(1)
    # Asegurar terminación con newline
    if not method_code.endswith('\n'):
        method_code += '\n'
    svc = svc.replace(insert_marker, method_code + insert_marker, 1)
    open(SVC, 'w').write(svc)
    print('Service patched.')

# 2) CONTROLLER -----------------------------------------------------------
ctl = open(CTL).read()
if 'historicoOperario' in ctl:
    print('Controller already has historicoOperario.')
else:
    # Insertar método después de 'reporte(desde, hasta) {...}' que sí está
    method_block = '''    historicoOperario(user, desde, hasta, responsable, departamento, tecnica) {
        const rol = user?.rol;
        const responsableFinal = (rol === 'admin' || rol === 'supervisor')
            ? (responsable || undefined)
            : user?.nombre;
        return this.svc.historicoOperario({
            desde, hasta,
            responsable: responsableFinal,
            departamento: departamento || undefined,
            tecnica: tecnica || undefined,
        });
    }
    operarios(departamento) {'''
    if 'operarios(departamento) {' not in ctl:
        print('ERROR: anchor operarios(departamento) not found'); sys.exit(1)
    ctl = ctl.replace('operarios(departamento) {', method_block, 1)

    # Insertar decorator. Insertar antes del decorator 'Get(operarios)'.
    dec_block = '''__decorate([
    (0, common_1.Get)('historico-operario'),
    __param(0, (0, decorators_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('desde')),
    __param(2, (0, common_1.Query)('hasta')),
    __param(3, (0, common_1.Query)('responsable')),
    __param(4, (0, common_1.Query)('departamento')),
    __param(5, (0, common_1.Query)('tecnica')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], ProduccionController.prototype, "historicoOperario", null);
__decorate([
    (0, common_1.Get)('operarios'),'''
    anchor = "__decorate([\n    (0, common_1.Get)('operarios'),"
    if anchor not in ctl:
        print('ERROR: anchor operarios decorator not found'); sys.exit(1)
    ctl = ctl.replace(anchor, dec_block, 1)

    # Verificar que decorators_1 ya está importado, si no agregarlo
    if 'decorators_1' not in ctl:
        # Fallback simple: usar require directo
        # Insertar require/import al inicio
        if "const decorators_1 = require" not in ctl:
            # Buscar el require más cercano y agregar después
            req_marker = 'const common_1 = require("@nestjs/common");'
            if req_marker in ctl:
                ctl = ctl.replace(
                    req_marker,
                    req_marker + '\nconst decorators_1 = require("../auth/decorators");',
                    1,
                )

    open(CTL, 'w').write(ctl)
    print('Controller patched.')

print('OK: historico-operario restaurado.')
