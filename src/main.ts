import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Aumentar límite de body para guardar logo en base64 (hasta ~5MB)
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // CORS — manejado por el proxy PHP en producción.
  // En desarrollo local se permite todo.
  app.enableCors({
    origin: true,   // refleja el Origin del request (permite cualquier origen con credenciales)
    credentials: true,
  });

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
  console.log(`\n🚀  E-Tex 360 API corriendo en http://localhost:${port}`);
  console.log(`📖  Documentación en http://localhost:${port}/api/docs\n`);
}
bootstrap();
