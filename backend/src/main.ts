import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  // Large GDB file uploads (400-500MB+) can take longer than Node's
  // default 5-minute requestTimeout, which aborts the connection mid-upload.
  // Disable it so long uploads aren't killed; keepAliveTimeout stays modest.
  // Headers still have to arrive within a minute — a slow upload body is
  // fine, but a client trickling headers forever just holds a socket open.
  const server = app.getHttpServer();
  server.requestTimeout = 0;
  server.headersTimeout = 60000;
  server.keepAliveTimeout = 65000;

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  await app.listen(port, '0.0.0.0');
}
bootstrap();
