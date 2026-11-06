import type { Request, Response } from 'express';

// The session JWT lives in an httpOnly cookie, not in localStorage. Script
// on the page — including any injected by an XSS bug — can't read it, so a
// single XSS no longer means a stolen session that keeps working elsewhere.
// The cookie is set on the frontend's origin: every browser call goes
// through the /api rewrite, which forwards Cookie and Set-Cookie as-is.
export const SESSION_COOKIE = 'waresys_session';

// Same lifetime as the JWT itself (auth.module.ts signOptions.expiresIn).
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// CSRF: a cookie is attached by the browser automatically, so a state-
// changing request authenticated by it must also carry this header. Pages
// on other origins can't add a custom header without a CORS preflight,
// which the backend's origin allowlist refuses. SameSite=Lax already stops
// most cross-site requests; this covers same-site ones (another app on the
// same host or LAN IP) too.
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'waresys';

// One log line for a write refused by the CSRF check, to tell a browser that
// dropped the header (or an extension changing it) from a real cross-site
// request. Never the cookie, and the referer without its query: print links
// carry a token there. All of it is sent by the client, so it's treated as
// untrusted and kept short.
export function describeCsrfRefusal(req: Request, userId?: string) {
  const flat = (v: unknown, max = 120) => String(v).replace(/[\r\n\t]+/g, ' ').slice(0, max);
  const received = req.headers?.[CSRF_HEADER];
  const referer = req.headers?.referer;
  let refererPath = '-';
  if (referer) {
    try {
      refererPath = new URL(referer).pathname;
    } catch {
      refererPath = 'invalid';
    }
  }
  return (
    `${flat(req.method, 10)} ${flat(req.originalUrl?.split('?')[0] ?? req.url?.split('?')[0])}` +
    ` header=${received === undefined ? 'absent' : `"${flat(received, 60)}"`}` +
    ` user=${flat(userId ?? '-')}` +
    ` fetchSite=${flat(req.headers?.['sec-fetch-site'] ?? '-', 20)}` +
    ` fetchMode=${flat(req.headers?.['sec-fetch-mode'] ?? '-', 20)}` +
    ` from=${flat(refererPath)}` +
    ` ua="${flat(req.headers?.['user-agent'] ?? '-', 160)}"`
  );
}

function cookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Only over HTTPS — LAN installs on plain http still need the cookie.
    // req.secure honours X-Forwarded-Proto via 'trust proxy' (main.ts).
    secure: req.secure,
    path: '/',
  };
}

export function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: MAX_AGE_MS });
}

export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

// Minimal Cookie-header parser — avoids pulling in cookie-parser for one
// value.
export function readSessionCookie(req: Request): string | null {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
