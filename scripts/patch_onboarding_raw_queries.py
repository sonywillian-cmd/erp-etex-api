"""Reescribir los 3 métodos de onboarding usando queries SQL raw en lugar
de TypeORM, porque la entidad Usuario no tiene declaradas las columnas
nuevas (onboarding_token, etc.) y TypeORM rechaza usar campos no declarados.
"""
import sys

p = '/home/u372536694/apps/api/dist/auth/auth.service.js'
s = open(p).read()

# Bloque actual (3 métodos con typeorm)
old = """    async generarOnboardingToken(usuarioId) {
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
    }"""

new = """    async generarOnboardingToken(usuarioId) {
        const [usuario] = await this.repo.query('SELECT id FROM usuarios WHERE id = ? LIMIT 1', [usuarioId]);
        if (!usuario)
            throw new common_1.NotFoundException(`Usuario #${usuarioId} no encontrado`);
        // Generar token aleatorio de 32 bytes = 64 hex
        const token = require('crypto').randomBytes(32).toString('hex');
        // Expira en 7 días
        const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await this.repo.query(
            'UPDATE usuarios SET onboarding_token = ?, onboarding_token_expira = ?, onboarding_completado_en = NULL WHERE id = ?',
            [token, expira, usuarioId]
        );
        return { token, expira: expira.toISOString() };
    }"""

if 'this.repo.query' in s and 'generarOnboardingToken' in s:
    # Verificar si ya se parcheó (usa raw)
    idx = s.find('generarOnboardingToken(usuarioId)')
    bloque = s[idx:idx+500]
    if 'this.repo.query' in bloque:
        print('Ya con raw queries.')
        raise SystemExit(0)

if old not in s:
    print('ERROR: generarOnboardingToken no encontrado.')
    raise SystemExit(1)

s = s.replace(old, new, 1)

# 2) obtenerOnboardingPublico
old2 = """    async obtenerOnboardingPublico(token) {
        const usuario = await this.repo.findOne({ where: { onboarding_token: token } });
        if (!usuario)
            throw new common_1.NotFoundException('Token no válido');
        const ahora = new Date();
        const expirado = usuario.onboarding_token_expira && new Date(usuario.onboarding_token_expira) < ahora;"""

new2 = """    async obtenerOnboardingPublico(token) {
        const [usuario] = await this.repo.query(
            'SELECT * FROM usuarios WHERE onboarding_token = ? LIMIT 1',
            [token]
        );
        if (!usuario)
            throw new common_1.NotFoundException('Token no válido');
        const ahora = new Date();
        const expirado = usuario.onboarding_token_expira && new Date(usuario.onboarding_token_expira) < ahora;"""

if old2 not in s:
    print('ERROR: obtenerOnboardingPublico no encontrado.')
    raise SystemExit(1)
s = s.replace(old2, new2, 1)

# 3) guardarOnboardingPublico
old3 = """    async guardarOnboardingPublico(token, data) {
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
    }"""

new3 = """    async guardarOnboardingPublico(token, data) {
        const [usuario] = await this.repo.query(
            'SELECT id, onboarding_token_expira FROM usuarios WHERE onboarding_token = ? LIMIT 1',
            [token]
        );
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
        const sets = [];
        const params = [];
        for (const k of camposPermitidos) {
            if (data[k] !== undefined) {
                const v = data[k];
                sets.push(`\\`${k}\\` = ?`);
                params.push((v === '' || v === null) ? null : v);
            }
        }
        const completadoEn = new Date();
        sets.push('onboarding_completado_en = ?');
        params.push(completadoEn);
        params.push(usuario.id);
        await this.repo.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, params);
        return { ok: true, completado_en: completadoEn };
    }"""

if old3 not in s:
    print('ERROR: guardarOnboardingPublico no encontrado.')
    raise SystemExit(1)
s = s.replace(old3, new3, 1)

open(p, 'w').write(s)
print('OK: 3 métodos convertidos a queries raw.')
