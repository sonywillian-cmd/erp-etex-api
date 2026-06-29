"""Agrega el campo clasificacion_contable a:
- Entidad Gasto (gasto.entity.js) — para que TypeORM lo conozca
- Service crear() y actualizar() — para aceptarlo y guardarlo
"""
import sys

ENT = '/home/u372536694/apps/api/dist/gastos/gasto.entity.js'
SVC = '/home/u372536694/apps/api/dist/gastos/gastos.service.js'

# 1) Entidad: agregar Column antes del CreateDateColumn
e = open(ENT).read()
if 'clasificacion_contable' in e:
    print('Entidad ya tiene clasificacion_contable.')
else:
    marker = """__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], Gasto.prototype, "creado_en", void 0);"""
    if marker not in e:
        print('ERROR: no se encontró el marker en entidad'); sys.exit(1)
    new_block = """__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: ['costo', 'gasto'], default: 'gasto' }),
    __metadata("design:type", String)
], Gasto.prototype, "clasificacion_contable", void 0);
""" + marker
    e = e.replace(marker, new_block, 1)
    open(ENT, 'w').write(e)
    print('Entidad parcheada.')

# 2) Service crear(): agregar al objeto que pasa a repo.create
s = open(SVC).read()
if 'clasificacion_contable' in s:
    print('Service ya tiene clasificacion_contable.')
else:
    old_crear = """        const g = this.repo.create({
            tipo: data.tipo,
            fecha: data.fecha,
            monto: Number(data.monto),"""
    new_crear = """        const g = this.repo.create({
            tipo: data.tipo,
            clasificacion_contable: data.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
            fecha: data.fecha,
            monto: Number(data.monto),"""
    if old_crear not in s:
        print('ERROR: bloque crear no encontrado'); sys.exit(1)
    s = s.replace(old_crear, new_crear, 1)

    # 3) Service actualizar(): agregar al Object.assign
    old_act = """            ...(data.tipo !== undefined ? { tipo: data.tipo } : {}),
            ...(data.fecha !== undefined ? { fecha: data.fecha } : {}),"""
    new_act = """            ...(data.tipo !== undefined ? { tipo: data.tipo } : {}),
            ...(data.clasificacion_contable !== undefined ? { clasificacion_contable: data.clasificacion_contable === 'costo' ? 'costo' : 'gasto' } : {}),
            ...(data.fecha !== undefined ? { fecha: data.fecha } : {}),"""
    if old_act not in s:
        print('ERROR: bloque actualizar no encontrado'); sys.exit(1)
    s = s.replace(old_act, new_act, 1)
    open(SVC, 'w').write(s)
    print('Service parcheado.')

print('OK: gasto.clasificacion_contable activado.')
