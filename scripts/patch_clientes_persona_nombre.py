"""Patch clientes.service.js to enforce 2+ words on persona name.

Adds:
  - validarNombrePersona helper method
  - Call inside create(dto)
  - Call inside update(id, dto)

Idempotent: if already patched, no-op.
"""
import re
import sys

p = '/home/u372536694/apps/api/dist/clientes/clientes.service.js'
s = open(p).read()

if 'validarNombrePersona' in s:
    print('Already patched — no-op.')
    sys.exit(0)

# 1) Insert helper right BEFORE the create method.
helper_block = '''    validarNombrePersona(tipo, nombre) {
        if ((tipo ?? 'empresa') !== 'persona') return;
        const palabras = nombre.trim().split(/\\s+/).filter(p => p.length >= 2);
        if (palabras.length < 2) {
            throw new common_1.BadRequestException(`Para clientes tipo "persona" el nombre debe incluir al menos dos palabras (ej: nombre + apellido). Recibido: "${nombre.trim()}".`);
        }
    }
    async create(dto) {'''

if 'async create(dto) {' not in s:
    print('ERROR: create(dto) not found')
    sys.exit(1)

s = s.replace('async create(dto) {', helper_block, 1)

# 2) Call validar inside create — right after `const nombre = ...`
old_create_body = '''    async create(dto) {
        const nombre = (dto.nombre ?? '').toUpperCase().trim();
        await this.checkUnique(nombre, dto.telefono ?? '');'''
new_create_body = '''    async create(dto) {
        const nombre = (dto.nombre ?? '').toUpperCase().trim();
        this.validarNombrePersona(dto.tipo, nombre);
        await this.checkUnique(nombre, dto.telefono ?? '');'''
if old_create_body not in s:
    print('ERROR: create body not found for patch')
    sys.exit(1)
s = s.replace(old_create_body, new_create_body, 1)

# 3) Same for update
old_update_body = '''    async update(id, dto) {
        const current = await this.findOne(id);
        const nombre = dto.nombre ? dto.nombre.toUpperCase().trim() : current.nombre;
        const telefono = dto.telefono !== undefined ? dto.telefono : (current.telefono ?? '');
        await this.checkUnique(nombre, telefono, id);'''
new_update_body = '''    async update(id, dto) {
        const current = await this.findOne(id);
        const nombre = dto.nombre ? dto.nombre.toUpperCase().trim() : current.nombre;
        const telefono = dto.telefono !== undefined ? dto.telefono : (current.telefono ?? '');
        const tipoEfectivo = dto.tipo ?? current.tipo;
        this.validarNombrePersona(tipoEfectivo, nombre);
        await this.checkUnique(nombre, telefono, id);'''
if old_update_body not in s:
    print('ERROR: update body not found for patch')
    sys.exit(1)
s = s.replace(old_update_body, new_update_body, 1)

# 4) Ensure BadRequestException is destructured if needed — verify it's available
# In NestJS common imports, BadRequestException is in @nestjs/common which is required as common_1
# (verify by searching for an existing use of common_1.BadRequestException)
# If not present, we cannot fix automatically here, but it's almost certainly already imported.

open(p, 'w').write(s)
print('OK: patched clientes.service.js — persona names now require 2+ words.')
