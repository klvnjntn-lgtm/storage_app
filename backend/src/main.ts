import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { uploadsRoot } from './storage/local-file-storage';
import { ValidationPipe } from '@nestjs/common';

// The browser never calls this server cross-origin in normal operation —
// the frontend proxies /api and /uploads to the backend server-side (see
// frontend/next.config.ts), so the browser only ever talks to whatever
// origin served the page (localhost, a LAN IP, a Tailscale name, or the
// cloud domain), and CORS never enters into that path. This allowlist only
// matters for direct browser->backend calls, which don't exist today; it's
// kept as an env-configurable escape hatch rather than deleted outright.
// Falls back to the previous hardcoded dev list if unset, so behavior is
// unchanged for anyone who hasn't set ALLOWED_ORIGINS yet.
function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) {
    return [
      'http://localhost:3000',
      'http://192.168.1.4:3000',
      'http://192.168.1.13:3000',
    ];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: getAllowedOrigins(),
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

  // Only the public key prefixes are served straight off disk. Anything
  // else under the uploads root (delivery-proofs/) is private and only
  // reachable through a signed link (storage/files.controller.ts).
  for (const publicPrefix of ['media', 'logos']) {
    app.useStaticAssets(join(uploadsRoot(), publicPrefix), {
      prefix: `/uploads/${publicPrefix}/`,
    });
  }

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
