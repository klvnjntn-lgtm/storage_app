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
