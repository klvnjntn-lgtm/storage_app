import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

// Tokens for a route stop's public page (/stop/<token>): the stop's
// directions and landmark photos for whoever the office pastes the link to,
// with no login. The token carries its own permission, like a signed file
// link: an HMAC over (stop id, expiry), so it can't be altered to point at
// another stop or last longer. Nothing is stored — deleting the stop is
// what kills a link early.
//
// It lasts through the day after the route's date (a driver can still look
// it up the next morning), and at least a day from when it was made, for a
// stop copied from an old route. Expiries are rounded up to the hour, so
// reloading the route gives the same link.
@Injectable()
export class StopShareTokenService {
  private secret(): string {
    const secret = process.env.FILE_URL_SECRET || process.env.JWT_SECRET;
    if (!secret)
      throw new Error(
        'FILE_URL_SECRET/JWT_SECRET is not set — cannot sign stop links',
      );
    return secret;
  }

  private signature(stopId: string, exp: number): string {
    return createHmac('sha256', this.secret())
      .update(`waresys-stop-share\n${stopId}\n${exp}`)
      .digest('base64url');
  }

  expiryFor(routeDate: Date, now = Date.now()): number {
    // routeDate is the route's day at 00:00 UTC; +2 days covers the whole
    // next day in Indonesian time.
    const byRoute = Math.floor(routeDate.getTime() / 1000) + 2 * DAY;
    const byNow = Math.floor(now / 1000) + DAY;
    return Math.ceil(Math.max(byRoute, byNow) / HOUR) * HOUR;
  }

  sign(stopId: string, routeDate: Date): string {
    const exp = this.expiryFor(routeDate);
    return `${stopId}.${exp}.${this.signature(stopId, exp)}`;
  }

  // The stop id, or null for a bad/expired token.
  verify(token: string): string | null {
    const [stopId, expRaw, sig, extra] = (token ?? '').split('.');
    if (!stopId || !expRaw || !sig || extra !== undefined) return null;
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || exp <= Math.floor(Date.now() / 1000))
      return null;
    const expected = Buffer.from(this.signature(stopId, exp));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return null;
    return stopId;
  }
}
