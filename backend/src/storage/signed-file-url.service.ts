// src/storage/signed-file-url.service.ts
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

// Keys under these prefixes are never served publicly — only through a
// short-lived URL signed here and checked by FilesController.
export const PRIVATE_KEY_PREFIXES = ['delivery-proofs/'];

export const isPrivateKey = (key: string) =>
  PRIVATE_KEY_PREFIXES.some((p) => key.startsWith(p));

const DEFAULT_TTL_SECONDS = 15 * 60;

// Temporary links for private files, for use in <img src> — the browser
// can't attach the app's Bearer token there, so the link itself carries
// the permission: an HMAC over (key, expiry). Whoever is allowed to see a
// file asks an authenticated endpoint for a link; the link then works for
// anyone holding it until it expires, and can't be altered to point at a
// different file or live longer.
//
// FILE_URL_SECRET if set, otherwise JWT_SECRET — prefixed with a purpose
// label so a signature here can never double as anything else.
@Injectable()
export class SignedFileUrlService {
  private secret(): string {
    const secret = process.env.FILE_URL_SECRET || process.env.JWT_SECRET;
    if (!secret)
      throw new Error(
        'FILE_URL_SECRET/JWT_SECRET is not set — cannot sign file URLs',
      );
    return secret;
  }

  private signature(key: string, expiresAt: number): string {
    return createHmac('sha256', this.secret())
      .update(`waresys-file-url\n${key}\n${expiresAt}`)
      .digest('base64url');
  }

  // Path relative to the API root; the frontend reaches it via /api.
  sign(
    key: string,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): { path: string; expiresAt: Date } {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const params = new URLSearchParams({
      key,
      exp: String(exp),
      sig: this.signature(key, exp),
    });
    return {
      path: `/files/signed?${params.toString()}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  // Returns the seconds left, or null for a bad/expired link.
  verify(key: string, exp: string, sig: string): number | null {
    const expiresAt = Number(exp);
    if (!Number.isInteger(expiresAt)) return null;
    const left = expiresAt - Math.floor(Date.now() / 1000);
    if (left <= 0) return null;
    const expected = Buffer.from(this.signature(key, expiresAt));
    const given = Buffer.from(sig ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return null;
    return left;
  }
}
