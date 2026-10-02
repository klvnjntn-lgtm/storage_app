import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { join } from 'path';
import type { ServerResponse } from 'http';
import { uploadsRoot } from './storage/local-file-storage';

// Everything main.ts applies to the app besides listening — kept here so the
// e2e specs run against the same parsers, pipes, CORS and static-file
// headers as production instead of a hand-copied subset.

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

export function configureApp(app: NestExpressApplication) {
  // Every browser request arrives through the frontend's /api rewrite, so
  // the socket peer is the Next server, not the user. Trusting one proxy
  // hop makes req.ip the rightmost X-Forwarded-For entry — without it the
  // rate limiter treated every user as one client, so 10 failed logins a
  // minute from anyone locked the whole site out.
  //
  // Caveat: Next only sets X-Forwarded-For when the request doesn't already
  // carry one, so a client can choose its own. Per-IP limits are therefore
  // best-effort unless a reverse proxy in front of Next (nginx, Caddy, a
  // cloud load balancer) overwrites the header; brute-force protection
  // doesn't rely on them — see the per-account lockout in AuthService.login.
  // A front proxy that appends the client address (nginx's
  // $proxy_add_x_forwarded_for) works with the default of 1, since Next
  // passes the header through unchanged.
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

  // Stock import posts the whole spreadsheet in one request, and the
  // response's import batch backs a single RECEIVE session, so it can't be
  // split client-side. Registered before Nest's own parser (100kb), which
  // then skips the already-parsed body. Every other route keeps the default.
  // The CSV order import's confirm step is the same: it posts back every
  // parsed row of a file the preview step already accepted (10MB).
  //
  // Wrapped in a named function on purpose: Nest skips registering its own
  // global JSON parser if any middleware in the stack is named "jsonParser"
  // (ExpressAdapter.isMiddlewareApplied), and express.json() returns a
  // function with exactly that name — mounting it directly here silently
  // turned off JSON parsing for every other route.
  const largeJsonParser = json({ limit: '10mb' });
  app.use(['/stock/import', '/integrations/import/confirm'], function largeJsonBody(req, res, next) {
    largeJsonParser(req, res, next);
  });

  app.enableCors({
    origin: getAllowedOrigins(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Device-Id'],
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
      // These files are served from the app's own origin. If one is ever
      // opened directly (not as an <img>), the sandbox CSP stops any script
      // in it — e.g. an SVG logo uploaded before SVG uploads were removed.
      setHeaders: (res: ServerResponse) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        );
      },
    });
  }
}
