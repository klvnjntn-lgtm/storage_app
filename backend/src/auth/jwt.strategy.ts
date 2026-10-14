// src/auth/jwt.strategy.ts

import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTimezone } from '../accounting/business-date';
import { isWithinAccessWindow } from './access-schedule.util';
import { DevicesService } from './devices.service';
import { CSRF_HEADER, CSRF_HEADER_VALUE, readSessionCookie } from './session-cookie';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LAST_ACTIVE_RESOLUTION_MS = 5 * 60 * 1000;

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  organizationId: string;
  sessionId: string;
}

// Fails fast at process startup if JWT_SECRET is missing, rather than
// silently falling back to a hardcoded, publicly-known string. The old
// fallback meant a misconfigured production deploy would keep running
// but sign/verify every session token against a secret anyone could
// read in this file's source — i.e. any client could forge a valid JWT
// for any user. Crashing on boot is the correct failure mode here: a
// misconfigured secret should stop the app, not run it insecurely.
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not set. Refusing to start with an insecure default.',
    );
  }
  return secret;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private devices: DevicesService,
  ) {
    super({
      // Session cookie first (the web app), then a bearer header (scripts
      // and other API clients). See session-cookie.ts.
      jwtFromRequest: ExtractJwt.fromExtractors([
        readSessionCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    // CSRF check for cookie-authenticated writes — see session-cookie.ts.
    // Bearer-token requests are exempt: a browser never attaches those on
    // its own, so they can't be forged cross-site.
    const viaCookie = !req.headers.authorization && !!readSessionCookie(req);
    if (
      viaCookie &&
      !SAFE_METHODS.has(req.method) &&
      req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE
    ) {
      throw new ForbiddenException('Missing request header');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: payload.sub,
      },
      include: {
        accessSchedules: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
        organization: { select: { timezone: true, require2faForAdmins: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    if (!user.active) {
      throw new UnauthorizedException('User is inactive.');
    }

    if (user.currentSessionId !== payload.sessionId) {
      throw new UnauthorizedException('You have logged in on another device.');
    }

    // The org requires two-factor sign-in for admins and this one hasn't
    // set it up: only the /auth routes (profile, logout, 2FA setup) work
    // until they do. The frontend sends them to the security page.
    if (
      user.role === 'ADMIN' &&
      user.organization.require2faForAdmins &&
      !user.totpEnabledAt &&
      !req.path.startsWith('/auth/')
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'TWO_FACTOR_SETUP_REQUIRED',
        message: 'Your organization requires two-factor sign-in. Set it up to continue.',
      });
    }

    // Device/access-hours restrictions only apply to DRIVER accounts — see
    // devices.service.ts and access-schedule.util.ts for the rationale
    // (field driver phones, not office ADMIN/USER desktop logins).
    if (user.role === 'DRIVER') {
      if (user.accessSchedules.length > 0) {
        const tz = resolveTimezone(user.organization);
        if (!isWithinAccessWindow(user.accessSchedules, new Date(), tz)) {
          throw new UnauthorizedException('Outside allowed access hours.');
        }
      }

      // Best-effort freshness touch, not an enforcement point — device
      // approval/revocation is enforced at login time and via revoke()
      // (which nulls currentSessionId), not by re-checking the header here.
      const deviceId = req.headers['x-device-id'];
      if (typeof deviceId === 'string' && deviceId) {
        void this.devices.touchLastSeen(user.id, deviceId);
      }
    }

    // Best-effort, like the device touch above: one write per user every
    // few minutes rather than one per request.
    if (
      !user.lastActiveAt ||
      Date.now() - user.lastActiveAt.getTime() > LAST_ACTIVE_RESOLUTION_MS
    ) {
      void this.prisma.user
        .update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
        .catch(() => undefined);
    }

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };
  }
}
