import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { origenesCors } from './common/rutas-instancia';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Aumentar límite de body para guardar logo en base64 (hasta ~5MB)
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // Cabeceras de seguridad (HSTS, nosniff, frameguard, etc.). CSP queda
  // desactivado: Next.js usa scripts en línea y un CSP estricto rompería el
  // frontend. crossOriginResourcePolicy en 'same-site' para no bloquear
  // recursos entre etex360erp.com y sus subdominios.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));

  // CORS — lista blanca. En producción el frontend vive en el MISMO dominio
  // (el proxy sirve /api/v1), así que CORS casi nunca interviene; las llamadas
  // servidor-a-servidor (bot de Telegram) no traen Origin y pasan igual.
  // El dominio de la instancia sale de FRONTEND_URL (+ CORS_ORIGINS opcional); ver common/rutas-instancia.ts
  app.enableCors({ origin: origenesCors(), credentials: true });

  // Validación global de DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Prefijo global de la API
  app.setGlobalPrefix('api/v1');

  // Swagger — documentación automática en /api/docs
  const config = new DocumentBuilder()
    .setTitle('E-Tex 360 API')
    .setDescription('API REST del sistema ERP E-Tex 360')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`\n🚀  E-Tex 360 API corriendo en http://localhost:${port} · instancia ${process.env.FRONTEND_URL ?? '(sin FRONTEND_URL)'}`);
  console.log(`📖  Documentación en http://localhost:${port}/api/docs\n`);
}
bootstrap();
