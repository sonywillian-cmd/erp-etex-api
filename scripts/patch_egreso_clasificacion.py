"""Agrega clasificacion_contable a la creación de egresos.
Actualiza la entidad EgresoCaja y el método del service.
"""
import sys, glob

SVC = '/home/u372536694/apps/api/dist/caja/caja.service.js'

# Encontrar la entidad EgresoCaja
ents = glob.glob('/home/u372536694/apps/api/dist/caja/**/egreso*.entity.js', recursive=True)
if not ents:
    print('ERROR: no se encontró entidad EgresoCaja'); sys.exit(1)
ENT = ents[0]
print(f'Entidad: {ENT}')

# 1) Entidad: agregar columna
e = open(ENT).read()
if 'clasificacion_contable' in e:
    print('Entidad ya tiene clasificacion_contable.')
else:
    # Buscar un Column existente para anclar (típicamente "categoria")
    if "Gasto.prototype" in e:
        # Es la entidad Gasto, error de path
        print('ERROR: archivo encontrado no es de egreso')
        sys.exit(1)
    # Buscar el patrón de CreateDateColumn como marker (siempre va al final)
    marker = """__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], EgresoCaja.prototype, "creado_en", void 0);"""
    if marker not in e:
        print('ERROR: marker CreateDateColumn no encontrado')
        sys.exit(1)
    new_block = """__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: ['costo', 'gasto'], default: 'gasto' }),
    __metadata("design:type", String)
], EgresoCaja.prototype, "clasificacion_contable", void 0);
""" + marker
    e = e.replace(marker, new_block, 1)
    open(ENT, 'w').write(e)
    print('Entidad parcheada.')

# 2) Service: agregar al egresoRepo.create
s = open(SVC).read()
if 'clasificacion_contable' in s:
    print('Service ya tiene clasificacion_contable.')
else:
    old = """        const egreso = this.egresoRepo.create({
            monto: dto.monto,
            destinatario: dto.destinatario,
            categoria: dto.categoria,
            comentario: dto.comentario,
            registrado_por: dto.registrado_por,
            fecha: f,
            sesion_caja_id: sesion.id,
        });"""
    new = """        const egreso = this.egresoRepo.create({
            monto: dto.monto,
            destinatario: dto.destinatario,
            categoria: dto.categoria,
            comentario: dto.comentario,
            registrado_por: dto.registrado_por,
            fecha: f,
            sesion_caja_id: sesion.id,
            clasificacion_contable: dto.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
        });"""
    if old not in s:
        print('ERROR: bloque egresoRepo.create no encontrado')
        sys.exit(1)
    s = s.replace(old, new, 1)
    open(SVC, 'w').write(s)
    print('Service parcheado.')

print('OK: egreso.clasificacion_contable activado.')
