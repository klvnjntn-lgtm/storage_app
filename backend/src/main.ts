import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: [
      'http://localhost:3003',
      'http://192.168.1.4:3003',
      'http://192.168.1.13:3003',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // Large GDB file uploads (400-500MB+) can take longer than Node's
  // default 5-minute requestTimeout, which aborts the connection mid-upload.
  // Disable it so long uploads aren't killed; keepAliveTimeout stays modest.
  const server = app.getHttpServer();
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 65000;

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  await app.listen(port, '0.0.0.0');
}
bootstrap();