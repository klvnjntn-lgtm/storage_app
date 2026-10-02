import { HttpException, HttpStatus } from '@nestjs/common';

// Per-account brute-force protection for /auth/login. The IP rate limit
// can't be relied on here: every request reaches the backend through the
// Next proxy, and a client can choose its own X-Forwarded-For (see main.ts),
// so an attacker can rotate "IPs" freely. Counting failures per email
// address stops password guessing against any one account regardless.
//
// Kept in memory: the backend runs as one process, and a restart simply
// forgets the counters (it never lets anyone in early by mistake beyond
// that). Failures are tracked for unknown emails too, so a locked response
// never reveals whether an account exists.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
// Spraying random emails must not grow this map without bound.
const MAX_TRACKED = 10_000;

type Entry = { failures: number; firstFailureAt: number; lockedUntil: number };

export class LoginLockout {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  assertNotLocked(email: string): void {
    const entry = this.entries.get(email);
    if (!entry || entry.lockedUntil <= this.now()) return;
    const minutes = Math.ceil((entry.lockedUntil - this.now()) / 60000);
    throw new HttpException(
      `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  recordFailure(email: string): void {
    const now = this.now();
    let entry = this.entries.get(email);
    if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
      entry = { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    }
    entry.failures += 1;
    if (entry.failures >= MAX_FAILURES) {
      entry.lockedUntil = now + LOCK_MS;
      entry.failures = 0;
      entry.firstFailureAt = now;
    }
    // Re-insert so Map order stays oldest-first for eviction.
    this.entries.delete(email);
    this.entries.set(email, entry);
    if (this.entries.size > MAX_TRACKED) {
      const oldest: string | undefined = this.entries.keys().next().value as string | undefined;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  recordSuccess(email: string): void {
    this.entries.delete(email);
  }
}
