// Must stay the first import: Sentry instruments the modules loaded after it.
import './instrument';
import 'dotenv/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  // LOG_FORMAT=json: one JSON object per log line, for log collectors
  // (Loki, CloudWatch, Datadog) that index fields instead of grepping text.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.LOG_FORMAT === 'json' ? new ConsoleLogger({ json: true }) : undefined,
  });
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

  // The desktop app sets HOST=127.0.0.1 so its local backend is never
  // reachable from the network.
  await app.listen(port, process.env.HOST || '0.0.0.0');
}
bootstrap();
