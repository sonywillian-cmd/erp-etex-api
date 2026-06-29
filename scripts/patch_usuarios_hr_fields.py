"""Extiende auth.service crear() para aceptar los campos HR nuevos (Fase 1).

`actualizar()` ya usa Object.assign(user, data) — acepta cualquier campo
automáticamente, así que no hace falta tocarlo (solo proteger campos
sensibles en otro patch si se desea).
"""
p = '/home/u372536694/apps/api/dist/auth/auth.service.js'
s = open(p).read()

old = """    async crear(data) {
        const existe = await this.repo.findOne({ where: { email: data.email } });
        if (existe)
            throw new common_1.ConflictException('El email ya está registrado');
        const hash = await bcrypt.hash(data.password, 12);
        const usuario = this.repo.create({
            email: data.email,
            nombre: data.nombre,
            password_hash: hash,
            rol: data.rol,
            departamentos: data.departamentos ?? null,
        });
        await this.repo.save(usuario);
        const { password_hash, ...safe } = usuario;
        return safe;
    }"""

new = """    async crear(data) {
        const existe = await this.repo.findOne({ where: { email: data.email } });
        if (existe)
            throw new common_1.ConflictException('El email ya está registrado');
        const hash = await bcrypt.hash(data.password, 12);
        // Whitelist de campos HR aceptados al crear. La idea es no copiar
        // ciegamente data (eso permitiría inyectar password_hash, id, etc.).
        const camposHR = [
            'codigo_empleado','cedula','fecha_nacimiento','sexo','estado_civil',
            'nacionalidad','telefono','direccion','foto_url',
            'contacto_emergencia_nombre','contacto_emergencia_telefono','contacto_emergencia_relacion',
            'fecha_ingreso','fecha_salida','cargo','supervisor_id','tipo_contrato',
            'estatus_laboral','salario','horario_asignado','periodo_pago','departamento',
        ];
        const hrPayload = {};
        for (const k of camposHR) if (data[k] !== undefined) hrPayload[k] = data[k] === '' ? null : data[k];
        const usuario = this.repo.create({
            email: data.email,
            nombre: data.nombre,
            password_hash: hash,
            rol: data.rol,
            departamentos: data.departamentos ?? null,
            ...hrPayload,
        });
        await this.repo.save(usuario);
        const { password_hash, ...safe } = usuario;
        return safe;
    }"""

if "camposHR = [" in s:
    print('Ya parcheado.')
    raise SystemExit(0)

if old not in s:
    print('ERROR: bloque exacto de crear() no encontrado.')
    raise SystemExit(1)

s = s.replace(old, new, 1)
open(p, 'w').write(s)
print('OK: crear() acepta campos HR.')

# También en actualizar(), agregamos protección de campos sensibles
old_upd = """    async actualizar(id, data) {
        const user = await this.repo.findOne({ where: { id } });
        if (!user)
            throw new common_1.NotFoundException(`Usuario #${id} no encontrado`);
        Object.assign(user, data);
        await this.repo.save(user);
        const { password_hash, ...safe } = user;
        return safe;
    }"""

new_upd = """    async actualizar(id, data) {
        const user = await this.repo.findOne({ where: { id } });
        if (!user)
            throw new common_1.NotFoundException(`Usuario #${id} no encontrado`);
        // Filtrar campos protegidos que NO deberían cambiar via este endpoint
        const protegidos = ['id','password_hash','creado_en','actualizado_en','ultimo_acceso'];
        const safeData = {};
        for (const k of Object.keys(data || {})) {
            if (protegidos.includes(k)) continue;
            // Convertir cadenas vacías a null para que MySQL no falle en DATE/ENUM
            safeData[k] = data[k] === '' ? null : data[k];
        }
        Object.assign(user, safeData);
        await this.repo.save(user);
        const { password_hash, ...safe } = user;
        return safe;
    }"""

s2 = open(p).read()
if 'protegidos = [' in s2:
    print('actualizar() ya parcheado.')
else:
    if old_upd in s2:
        s2 = s2.replace(old_upd, new_upd, 1)
        open(p, 'w').write(s2)
        print('OK: actualizar() filtra campos protegidos.')
    else:
        print('WARN: actualizar() no encontrado exacto, omitido.')
