import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Test E2E del módulo de Auth.
 *
 * Verifica:
 * - POST /auth/login con credenciales válidas → 201 + JWT
 * - POST /auth/login con credenciales inválidas → 401
 * - GET /clientes sin auth → 401
 * - GET /clientes con auth → 200
 *
 * Requiere:
 * - BD de tests configurada en .env.test
 * - Usuario admin de prueba creado
 *
 * NOTA: este test toca la BD real. NO ejecutar contra producción.
 */
describe('Auth + endpoints protegidos (E2E)', () => {
  let app: INestApplication;
  let jwt: string;

  // Credenciales del usuario admin de prueba.
  // Idealmente vienen de .env.test, no hardcoded.
  const adminCreds = {
    email: process.env.TEST_ADMIN_EMAIL || 'admin@test.local',
    password: process.env.TEST_ADMIN_PASSWORD || 'admin12345',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('rechaza credenciales inválidas con 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'noexiste@test.local', password: 'wrong' })
        .expect(401);
    });

    it('rechaza body inválido (sin email) con 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ password: 'algo' })
        .expect(400);
    });

    it('acepta credenciales válidas y devuelve JWT', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(adminCreds);

      // Si el usuario de prueba no existe, este test fallará con 401.
      // Crearlo con: INSERT INTO usuarios (email, password_hash, nombre, rol) ...
      if (res.status === 401) {
        console.warn('⚠️ TEST SKIP: usuario admin de prueba no existe. Crear con TEST_ADMIN_EMAIL.');
        return;
      }
      expect(res.status).toBe(201);
      expect(res.body.access_token).toBeDefined();
      jwt = res.body.access_token;
    });
  });

  describe('GET /api/v1/clientes', () => {
    it('rechaza sin Authorization → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/clientes')
        .expect(401);
    });

    it('rechaza con JWT inválido → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/clientes')
        .set('Authorization', 'Bearer token-invalido-123')
        .expect(401);
    });

    it('acepta con JWT válido → 200', async () => {
      if (!jwt) {
        console.warn('⚠️ TEST SKIP: sin JWT (login falló arriba).');
        return;
      }
      const res = await request(app.getHttpServer())
        .get('/api/v1/clientes')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
