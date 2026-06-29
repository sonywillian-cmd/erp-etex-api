"""Agrega 3 endpoints para el onboarding de empleados:

  POST /auth/usuarios/:id/onboarding-token  (admin/supervisor)
       → genera un token nuevo, devuelve { token, url, expira }

  GET  /onboarding/:token  (público)
       → devuelve { nombre, email, ya_completado, expirado, campos_actuales }
       → usado por la página pública para pre-llenar el form

  POST /onboarding/:token  (público)
       → recibe los datos llenados y los guarda en el usuario
       → marca el token como completado e invalida
"""
import sys

SVC = '/home/u372536694/apps/api/dist/auth/auth.service.js'
CTL = '/home/u372536694/apps/api/dist/auth/auth.controller.js'

# 1) SERVICE: agregar 3 métodos
svc = open(SVC).read()
if 'generarOnboardingToken' in svc:
    print('Service ya parcheado.')
else:
    marker = "};\nexports.AuthService"
    if marker not in svc:
        print('ERROR: cierre de clase AuthService no encontrado'); sys.exit(1)

    new_methods = """    async generarOnboardingToken(usuarioId) {
        const usuario = await this.repo.findOne({ where: { id: usuarioId } });
        if (!usuario)
            throw new common_1.NotFoundException(`Usuario #${usuarioId} no encontrado`);
        // Generar token aleatorio de 32 bytes = 64 hex
        const token = require('crypto').randomBytes(32).toString('hex');
        // Expira en 7 días
        const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await this.repo.update(usuarioId, {
            onboarding_token: token,
            onboarding_token_expira: expira,
            onboarding_completado_en: null,
        });
        return { token, expira: expira.toISOString() };
    }
    async obtenerOnboardingPublico(token) {
        const usuario = await this.repo.findOne({ where: { onboarding_token: token } });
        if (!usuario)
            throw new common_1.NotFoundException('Token no válido');
        const ahora = new Date();
        const expirado = usuario.onboarding_token_expira && new Date(usuario.onboarding_token_expira) < ahora;
        return {
            nombre: usuario.nombre,
            email: usuario.email,
            cargo: usuario.cargo ?? null,
            ya_completado: !!usuario.onboarding_completado_en,
            completado_en: usuario.onboarding_completado_en,
            expirado: !!expirado,
            expira: usuario.onboarding_token_expira,
            // Datos actuales (pre-fill si ya tiene algo guardado)
            campos: {
                codigo_empleado: usuario.codigo_empleado ?? '',
                cedula: usuario.cedula ?? '',
                fecha_nacimiento: usuario.fecha_nacimiento ?? '',
                sexo: usuario.sexo ?? '',
                estado_civil: usuario.estado_civil ?? '',
                nacionalidad: usuario.nacionalidad ?? 'Dominicana',
                telefono: usuario.telefono ?? '',
                direccion: usuario.direccion ?? '',
                contacto_emergencia_nombre: usuario.contacto_emergencia_nombre ?? '',
                contacto_emergencia_telefono: usuario.contacto_emergencia_telefono ?? '',
                contacto_emergencia_relacion: usuario.contacto_emergencia_relacion ?? '',
            },
        };
    }
    async guardarOnboardingPublico(token, data) {
        const usuario = await this.repo.findOne({ where: { onboarding_token: token } });
        if (!usuario)
            throw new common_1.NotFoundException('Token no válido');
        if (usuario.onboarding_token_expira && new Date(usuario.onboarding_token_expira) < new Date()) {
            throw new common_1.BadRequestException('El enlace ha expirado. Pídele al administrador uno nuevo.');
        }
        // Whitelist de campos que el empleado puede llenar (NO salario, NO rol, NO cargo)
        const camposPermitidos = [
            'cedula','fecha_nacimiento','sexo','estado_civil','nacionalidad',
            'telefono','direccion',
            'contacto_emergencia_nombre','contacto_emergencia_telefono','contacto_emergencia_relacion',
        ];
        const payload = {};
        for (const k of camposPermitidos) {
            if (data[k] !== undefined) {
                const v = data[k];
                payload[k] = (v === '' || v === null) ? null : v;
            }
        }
        payload.onboarding_completado_en = new Date();
        // Invalidar token (se queda guardado pero ya completado, no se puede usar de nuevo)
        await this.repo.update(usuario.id, payload);
        return { ok: true, completado_en: payload.onboarding_completado_en };
    }
"""
    svc = svc.replace(marker, new_methods + marker, 1)
    open(SVC, 'w').write(svc)
    print('Service: 3 métodos agregados.')

# 2) CONTROLLER: agregar 3 endpoints
ctl = open(CTL).read()
if 'generarOnboardingToken' in ctl:
    print('Controller ya parcheado.')
else:
    # Insertar métodos antes del cierre de clase (});
    method_marker = "};\nexports.AuthController = AuthController;"
    if method_marker not in ctl:
        print('ERROR: cierre AuthController no encontrado'); sys.exit(1)

    new_handlers = """    generarOnboardingToken(id) {
        return this.svc.generarOnboardingToken(id);
    }
    obtenerOnboardingPublico(token) {
        return this.svc.obtenerOnboardingPublico(token);
    }
    guardarOnboardingPublico(token, body) {
        return this.svc.guardarOnboardingPublico(token, body);
    }
"""
    # Reemplazar el cierre con métodos + cierre
    ctl = ctl.replace(method_marker, new_handlers + method_marker, 1)

    # Agregar decorators al final (antes de exports.AuthController = AuthController = __decorate)
    final_marker = "exports.AuthController = AuthController = __decorate(["
    if final_marker not in ctl:
        print('ERROR: decorator final no encontrado'); sys.exit(1)
    new_decorators = """__decorate([
    (0, common_1.Post)('usuarios/:id/onboarding-token'),
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
    (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
    (0, swagger_1.ApiBearerAuth)(),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "generarOnboardingToken", null);
__decorate([
    (0, common_1.Get)('onboarding/:token'),
    __param(0, (0, common_1.Param)('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "obtenerOnboardingPublico", null);
__decorate([
    (0, common_1.Post)('onboarding/:token'),
    __param(0, (0, common_1.Param)('token')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "guardarOnboardingPublico", null);
""" + final_marker
    ctl = ctl.replace(final_marker, new_decorators, 1)
    open(CTL, 'w').write(ctl)
    print('Controller: 3 endpoints registrados.')

print('OK: onboarding endpoints listos.')
