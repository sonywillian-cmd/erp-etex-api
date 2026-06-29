"""Mejora la validación de duplicados al crear/editar clientes:
- Antes: ConflictException con texto simple ("Ya existe un cliente con el nombre X")
- Ahora: el error incluye un objeto 'duplicado' con el cliente conflictivo
  para que el frontend pueda ofrecer un link directo al cliente existente.
- Agrega validación de RNC/cédula (documento) además de nombre y teléfono.
"""
import sys

p = '/home/u372536694/apps/api/dist/clientes/clientes.service.js'
s = open(p).read()

if "duplicado: { campo:" in s:
    print('Ya parcheado.')
    raise SystemExit(0)

# Reemplazar el método checkUnique completo
old = """    async checkUnique(nombre, telefono, excludeId) {
        const nameQb = this.repo.createQueryBuilder('c')
            .where('c.nombre = :nombre', { nombre });
        if (excludeId)
            nameQb.andWhere('c.id != :id', { id: excludeId });
        if (await nameQb.getOne()) {
            throw new common_1.ConflictException(`Ya existe un cliente con el nombre \"${nombre}\"`);
        }
        if (telefono) {
            const phoneQb = this.repo.createQueryBuilder('c')
                .where('c.telefono = :telefono', { telefono });
            if (excludeId)
                phoneQb.andWhere('c.id != :id', { id: excludeId });
            if (await phoneQb.getOne()) {
                throw new common_1.ConflictException(`Ya existe un cliente con el teléfono \"${telefono}\"`);
            }
        }
    }"""

new = """    async checkUnique(nombre, telefono, documento, excludeId) {
        // Helper para construir respuesta de duplicado con info del cliente existente
        const arrojarDuplicado = (campo, cliente) => {
            throw new common_1.ConflictException({
                message: `Ya existe un cliente con ese ${campo === 'documento' ? 'RNC/cédula' : campo}: \"${cliente.nombre}\"`,
                duplicado: {
                    campo,
                    cliente: {
                        id: cliente.id,
                        nombre: cliente.nombre,
                        documento: cliente.documento ?? null,
                        telefono: cliente.telefono ?? null,
                    },
                },
            });
        };
        // 1) Nombre único (case-insensitive normalizado)
        const nameQb = this.repo.createQueryBuilder('c')
            .where('UPPER(TRIM(c.nombre)) = UPPER(TRIM(:nombre))', { nombre });
        if (excludeId)
            nameQb.andWhere('c.id != :id', { id: excludeId });
        const dupNombre = await nameQb.getOne();
        if (dupNombre)
            arrojarDuplicado('nombre', dupNombre);
        // 2) Documento (RNC/cédula) único — solo si se provee
        if (documento && String(documento).trim()) {
            const docNorm = String(documento).replace(/[^0-9A-Za-z]/g, '');
            if (docNorm) {
                const docQb = this.repo.createQueryBuilder('c')
                    .where(\"REPLACE(REPLACE(c.documento, '-', ''), ' ', '') = :doc\", { doc: docNorm });
                if (excludeId)
                    docQb.andWhere('c.id != :id', { id: excludeId });
                const dupDoc = await docQb.getOne();
                if (dupDoc)
                    arrojarDuplicado('documento', dupDoc);
            }
        }
        // 3) Teléfono único (solo si se provee)
        if (telefono && String(telefono).trim()) {
            const telNorm = String(telefono).replace(/[^0-9]/g, '');
            if (telNorm.length >= 7) {
                const phoneQb = this.repo.createQueryBuilder('c')
                    .where(\"REGEXP_REPLACE(c.telefono, '[^0-9]', '') = :tel\", { tel: telNorm });
                if (excludeId)
                    phoneQb.andWhere('c.id != :id', { id: excludeId });
                const dupTel = await phoneQb.getOne();
                if (dupTel)
                    arrojarDuplicado('telefono', dupTel);
            }
        }
    }"""

if old not in s:
    print('ERROR: no se encontró el bloque exacto de checkUnique. Revisar manualmente.')
    sys.exit(1)
s = s.replace(old, new, 1)

# Actualizar las llamadas a checkUnique para pasar documento
old_create = """    async create(dto) {
        const nombre = (dto.nombre ?? '').toUpperCase().trim();
        this.validarNombrePersona(dto.tipo, nombre);
        await this.checkUnique(nombre, dto.telefono ?? '');"""
new_create = """    async create(dto) {
        const nombre = (dto.nombre ?? '').toUpperCase().trim();
        this.validarNombrePersona(dto.tipo, nombre);
        await this.checkUnique(nombre, dto.telefono ?? '', dto.documento ?? '');"""
if old_create not in s:
    print('ERROR: no se encontró create()'); sys.exit(1)
s = s.replace(old_create, new_create, 1)

old_update = """    async update(id, dto) {
        const current = await this.findOne(id);
        const nombre = dto.nombre ? dto.nombre.toUpperCase().trim() : current.nombre;
        const telefono = dto.telefono !== undefined ? dto.telefono : (current.telefono ?? '');
        const tipoEfectivo = dto.tipo ?? current.tipo;
        this.validarNombrePersona(tipoEfectivo, nombre);
        await this.checkUnique(nombre, telefono, id);"""
new_update = """    async update(id, dto) {
        const current = await this.findOne(id);
        const nombre = dto.nombre ? dto.nombre.toUpperCase().trim() : current.nombre;
        const telefono = dto.telefono !== undefined ? dto.telefono : (current.telefono ?? '');
        const documento = dto.documento !== undefined ? dto.documento : (current.documento ?? '');
        const tipoEfectivo = dto.tipo ?? current.tipo;
        this.validarNombrePersona(tipoEfectivo, nombre);
        await this.checkUnique(nombre, telefono, documento, id);"""
if old_update not in s:
    print('ERROR: no se encontró update()'); sys.exit(1)
s = s.replace(old_update, new_update, 1)

open(p, 'w').write(s)
print('OK: checkUnique actualizado con info de duplicado y validación de documento.')
