// src/auth/utils/secure-compare.ts
import { createHash, timingSafeEqual } from 'crypto';

// Constant-time string comparison. Hashing both sides first sidesteps
// the need to pad unequal-length strings for timingSafeEqual (which
// throws on mismatched buffer lengths) — SHA-256 always produces a
// fixed 32-byte digest either way, and an attacker learns nothing
// about the real secret's length either.
export function secureCompare(provided: string, expected: string): boolean {
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}