# Tests del backend E-Tex 360

## 🚀 Setup inicial

Antes de correr los tests, instala las dependencias:

```bash
cd erp-etex-api
npm install
```

Las nuevas dependencias agregadas son:
- `jest` — framework de testing
- `ts-jest` — soporte TypeScript
- `@types/jest` — tipos para autocompletado
- `supertest` — testing HTTP (E2E)
- `@types/supertest` — tipos

## ▶️ Comandos

```bash
npm test               # Correr todos los tests unitarios una vez
npm run test:watch     # Modo watch (re-ejecuta al guardar)
npm run test:cov       # Con reporte de cobertura
npm run test:e2e       # Solo tests E2E (requieren BD)
```

## 📂 Estructura

```
src/
  common/
    parse-helpers.ts                  # Funciones puras (parsearMonto, fechaDgii, etc.)
    parse-helpers.spec.ts             # Tests de funciones puras (100% testeable)
  clientes/
    clientes.service.ts
    clientes.service.spec.ts          # Tests con mock de Repository

test/
  jest-e2e.json                       # Config Jest específica para E2E
  auth.e2e-spec.ts                    # Test E2E del login + endpoints protegidos
  README.md                           # (este archivo)
```

## ✅ Tests incluidos

### Funciones puras (`parse-helpers.spec.ts`) — 35+ aserciones

- `parsearMonto()` — 12 formatos de monto en RD (US, latino, sin separadores)
- `categoriaToDgii606()` — mapeo de categorías a códigos DGII
- `metodoPagoToDgii()` — mapeo de métodos de pago
- `tipoIdentificacion()` — RNC vs cédula vs pasaporte
- `upper()` — manejo seguro de null/undefined
- `fechaDgii()` — formato YYYYMMDD
- `ncfFromSecuencia()` — generación de NCFs

### Servicios con mocks (`clientes.service.spec.ts`) — 15+ tests

- Validación de nombre persona (mínimo 2 palabras)
- Normalización a MAYÚSCULAS
- Unicidad de nombre y teléfono
- NotFoundException en `findOne`
- Update con preservación de nombre

### E2E (`auth.e2e-spec.ts`) — 6 tests

- Login con credenciales válidas/inválidas
- Validación de body
- Acceso protegido a `/clientes` con/sin JWT

## 🧪 Cómo correr E2E

Los E2E tocan la BD real, así que necesitas:

1. **Crear un usuario de prueba** en la BD de desarrollo:

```sql
INSERT INTO usuarios (email, password_hash, nombre, rol, activo)
VALUES ('admin@test.local', '$2b$12$<hash-bcrypt-de-admin12345>', 'TEST ADMIN', 'admin', 1);
```

Para generar el hash:
```bash
node -e "console.log(require('bcrypt').hashSync('admin12345', 12))"
```

2. **Configurar variables de entorno** en `.env`:
```env
TEST_ADMIN_EMAIL=admin@test.local
TEST_ADMIN_PASSWORD=admin12345
```

3. **Ejecutar**:
```bash
npm run test:e2e
```

## 📊 Cobertura

```bash
npm run test:cov
```

Abre `coverage/lcov-report/index.html` para ver el reporte visual.

**Meta inicial**: 40-50% en módulos financieros. **Meta a 6 meses**: 70%+.

## 📝 Cómo agregar nuevos tests

### Para una función pura

1. Crea o ubica el helper en `src/common/`.
2. Junto al archivo, crea `<nombre>.spec.ts`.
3. Importa con `import { funcion } from './<nombre>'`.
4. Usa `describe()` + `it()` + `expect()`.

### Para un servicio con dependencias

1. En la carpeta del módulo, crea `<servicio>.service.spec.ts`.
2. Usa `Test.createTestingModule` para crear el módulo de pruebas.
3. Mockea las dependencias con `useValue: { ... }` o `useFactory`.
4. Para `Repository<X>`, usa `getRepositoryToken(X)`.
5. Para `DataSource`, usa `useValue: { query: jest.fn(), transaction: jest.fn() }`.

### Para E2E

1. En `test/`, crea `<modulo>.e2e-spec.ts`.
2. Usa `Test.createTestingModule({ imports: [AppModule] })`.
3. Llama endpoints con `request(app.getHttpServer()).get/post()`.
4. **CUIDADO**: estos tests tocan BD real. Usa solo en ambiente de desarrollo.

## ⚠️ NO ejecutar en producción

Los tests E2E pueden modificar datos. Usa una BD separada para tests:

```env
# .env.test
DB_NAME=u372536694_erp_test
```

Y carga ese archivo en E2E modificando `auth.e2e-spec.ts`:
```typescript
beforeAll(async () => {
  require('dotenv').config({ path: '.env.test' });
  // ...
});
```

## 🎯 Prioridades de próximos tests

Según la auditoría:

1. **facturacion.service** — asignación NCF, transacciones, validaciones
2. **caja.service** — apertura/cierre, race conditions en `nextNumeroSesion()`
3. **recibos.service** — generación de número, validación de monto
4. **produccion.service** — `actualizarEstadoLote` (lógica de piezas)
5. **cxp.service** — modelo híbrido (gasto formal + CxP)
6. **compromisos.service** — recurrencias, regeneración

## 🚨 Tests que FALTAN sí o sí

- **Race condition de NCF**: dos requests simultáneos pidiendo siguiente NCF
- **Rollback de transacción** cuando falla a mitad de crear factura
- **Idempotencia** de pagos (no cobrar dos veces)
- **Anti-duplicación** de gastos al registrar abono de CxP
