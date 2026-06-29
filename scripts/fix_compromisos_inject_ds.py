"""Arregla la inyeccion de DataSource en compromisos.service.js y
agrega conversion automatica a MAYUSCULAS en los campos de texto.
"""
import sys

SVC = '/home/u372536694/apps/api/dist/compromisos/compromisos.service.js'

s = open(SVC).read()

# 1) Agregar import de @nestjs/typeorm
if "require(\"@nestjs/typeorm\")" not in s and "require('@nestjs/typeorm')" not in s:
    s = s.replace(
        'const typeorm_2 = require("typeorm");',
        'const typeorm_1 = require("@nestjs/typeorm");\nconst typeorm_2 = require("typeorm");'
    )
    print('Import @nestjs/typeorm agregado.')

# 2) Inyectar DataSource en el constructor
old_decor = """CompromisosService = __decorate([
  (0, common_1.Injectable)(),
  __metadata("design:paramtypes", [typeorm_2.DataSource])
], CompromisosService);"""

new_decor = """const __param = (this && this.__param) || function (paramIndex, decorator) {
  return function (target, key) { decorator(target, key, paramIndex); };
};

CompromisosService = __decorate([
  (0, common_1.Injectable)(),
  __param(0, (0, typeorm_1.InjectDataSource)()),
  __metadata("design:paramtypes", [typeorm_2.DataSource])
], CompromisosService);"""

if old_decor in s:
    s = s.replace(old_decor, new_decor, 1)
    print('InjectDataSource agregado al constructor.')
elif 'InjectDataSource' in s:
    print('InjectDataSource ya estaba presente.')
else:
    print('ERROR: bloque de decorate no encontrado'); sys.exit(1)

# 3) Helper UPPER para campos texto + aplicar en crear() y actualizar()
helper = """
function _upper(v) {
  if (v == null) return v;
  if (typeof v !== 'string') return v;
  return v.toUpperCase();
}
"""

if '_upper' not in s:
    # Insertar antes de "let CompromisosService"
    s = s.replace(
        'let CompromisosService = class CompromisosService {',
        helper + '\nlet CompromisosService = class CompromisosService {'
    )
    print('Helper _upper agregado.')

# 4) Reemplazar el INSERT del crear() para convertir a MAYUSCULAS
old_insert_block = """    `, [
      dto.nombre,
      dto.categoria || 'otros',
      dto.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
      Number(dto.monto_estimado) || 0,
      dto.frecuencia,
      dto.dia_vencimiento != null ? Number(dto.dia_vencimiento) : null,
      dto.proveedor || null,
      dto.descripcion || null,
      dto.metodo_pago_default || null,
      dto.cuenta_banco_id || null,
      Number(dto.recordar_dias_antes) || 5,
      dto.activo === false ? 0 : 1,
      dto.fecha_inicio || null,
      dto.fecha_fin || null,
      dto.creado_por || null,
    ]);"""

new_insert_block = """    `, [
      _upper(dto.nombre),
      _upper(dto.categoria || 'otros'),
      dto.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
      Number(dto.monto_estimado) || 0,
      dto.frecuencia,
      dto.dia_vencimiento != null ? Number(dto.dia_vencimiento) : null,
      _upper(dto.proveedor) || null,
      _upper(dto.descripcion) || null,
      dto.metodo_pago_default || null,
      dto.cuenta_banco_id || null,
      Number(dto.recordar_dias_antes) || 5,
      dto.activo === false ? 0 : 1,
      dto.fecha_inicio || null,
      dto.fecha_fin || null,
      dto.creado_por || null,
    ]);"""

if old_insert_block in s:
    s = s.replace(old_insert_block, new_insert_block, 1)
    print('INSERT crear() convertido a MAYUSCULAS.')
elif '_upper(dto.nombre)' in s:
    print('crear() ya estaba en MAYUSCULAS.')
else:
    print('WARN: bloque INSERT no encontrado, no se aplico mayusculas en crear()')

# 5) Aplicar MAYUSCULAS en actualizar() para campos texto
old_upd = """    for (const k of campos) {
      if (dto[k] !== undefined) {
        sets.push(`\\`${k}\\` = ?`);
        let v = dto[k];
        if (k === 'activo') v = v === false || v === 0 ? 0 : 1;
        if (k === 'clasificacion_contable') v = v === 'costo' ? 'costo' : 'gasto';
        if (v === '') v = null;
        params.push(v);
      }
    }"""

new_upd = """    const camposTexto = new Set(['nombre','categoria','proveedor','descripcion']);
    for (const k of campos) {
      if (dto[k] !== undefined) {
        sets.push(`\\`${k}\\` = ?`);
        let v = dto[k];
        if (k === 'activo') v = v === false || v === 0 ? 0 : 1;
        if (k === 'clasificacion_contable') v = v === 'costo' ? 'costo' : 'gasto';
        if (camposTexto.has(k)) v = _upper(v);
        if (v === '') v = null;
        params.push(v);
      }
    }"""

if old_upd in s:
    s = s.replace(old_upd, new_upd, 1)
    print('actualizar() convierte a MAYUSCULAS.')
elif 'camposTexto' in s:
    print('actualizar() ya estaba en MAYUSCULAS.')
else:
    print('WARN: bloque actualizar() no encontrado, no se aplico mayusculas en actualizar()')

open(SVC, 'w').write(s)
print('\nOK: compromisos.service.js actualizado.')
