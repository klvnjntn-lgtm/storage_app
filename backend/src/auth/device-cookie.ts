import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { getJwtSecret } from './jwt.strategy';

// "Device cookies" (OWASP): the per-account login lockout only stops
// strangers.
//
// Counting failed sign-ins per email stops password guessing, but on its
// own it also lets anyone who knows an address lock its owner out: five
// wrong passwords and the real person can't get in for fifteen minutes,
// over and over. So a browser that has signed in to an account before gets
// a signed cookie naming that account. Sign-ins carrying it are counted on
// their own, apart from everyone else's, and a lockout caused by others
// never reaches them. An attacker can't forge the cookie (it's signed with
// the server secret) or read it (httpOnly), so their guesses still lock.
export const DEVICE_COOKIE = 'waresys_device';
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function sign(payload: string) {
  return createHmac('sha256', `waresys-device-cookie\n${getJwtSecret()}`).update(payload).digest('base64url');
}

// A new cookie value for this account on this browser.
export function issueDeviceToken(email: string) {
  const payload = `${Buffer.from(email.trim().toLowerCase()).toString('base64url')}.${randomBytes(12).toString('base64url')}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

// The cookie's own id when it's genuine, unexpired and for this email; null
// otherwise.
export function deviceIdFor(token: string | null | undefined, email: string): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [who, nonce, issued, sig] = parts;
  const expected = Buffer.from(sign(`${who}.${nonce}.${issued}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!(Date.now() - Number(issued) < MAX_AGE_MS)) return null;
  if (Buffer.from(who, 'base64url').toString() !== email.trim().toLowerCase()) return null;
  return nonce;
}

// The bucket a sign-in's failures are counted in: the account's own on a
// browser that has signed in before, the shared one otherwise.
export function lockoutKey(email: string, deviceToken: string | null | undefined) {
  const normalized = email.trim().toLowerCase();
  const device = deviceIdFor(deviceToken, normalized);
  return device ? `${normalized}#${device}` : normalized;
}

export function readCookie(req: Pick<Request, 'headers'>, name: string): string | null {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// The driver phone id (devices.service.ts), kept by the server as well as
// in the browser's localStorage. Browsers clear script storage on their own
// (Safari after a week without a visit, "clean up" apps, storage pressure),
// and every clear made an approved phone look new: the driver was told to
// ask the office again. A first-party httpOnly cookie set by the server
// outlives those clears, so it is read first and the header only seeds it.
// Not a secret and not signed: the id was always client-supplied, and
// approval only trusts an id the office approved.
export const PHONE_COOKIE = 'waresys_phone';
const PHONE_MAX_AGE_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const PHONE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function validPhoneId(value: unknown): string | null {
  return typeof value === 'string' && PHONE_ID_PATTERN.test(value) ? value : null;
}

// Cookie first, then the X-Device-Id header, then the login body; a new id
// when there is none, so a browser that can't keep localStorage still gets
// one (and waits for approval like any new phone).
export function resolvePhoneId(req: Pick<Request, 'headers'>, bodyId?: string): string {
  return (
    validPhoneId(readCookie(req, PHONE_COOKIE)) ??
    validPhoneId(req.headers['x-device-id']) ??
    validPhoneId(bodyId) ??
    randomUUID()
  );
}

// The id the request's phone is known by, without minting one.
export function requestPhoneId(req: Pick<Request, 'headers'>): string | null {
  return validPhoneId(readCookie(req, PHONE_COOKIE)) ?? validPhoneId(req.headers['x-device-id']);
}

export function setPhoneCookie(req: Request, res: Response, phoneId: string) {
  res.cookie(PHONE_COOKIE, phoneId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: PHONE_MAX_AGE_MS,
  });
}

// One cookie per browser: signing in to another account replaces it, which
// only means that browser counts as new for the first account again.
export function setDeviceCookie(req: Request, res: Response, token: string) {
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    // '/' rather than the login route: the browser reaches it as
    // /api/auth/… through the frontend, the desktop app straight as /auth/….
    path: '/',
    maxAge: MAX_AGE_MS,
  });
}
