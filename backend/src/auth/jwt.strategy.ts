// src/auth/jwt.strategy.ts

import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

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
function getJwtSecret(): string {
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
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: payload.sub,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    if (!user.active) {
      throw new UnauthorizedException('User is inactive.');
    }

    if (user.currentSessionId !== payload.sessionId) {
      throw new UnauthorizedException(
        'You have logged in on another device.',
      );
    }

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };
  }
}