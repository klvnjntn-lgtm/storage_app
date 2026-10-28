// src/platform/platform-owner.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { isAdminRole } from '../auth/roles';

// The platform console reaches across every organization, so getting in
// takes all of these, checked live on every request:
//   1. a normal logged-in session (global JwtAuthGuard/OrgGuard, CSRF);
//   2. the account is an active ADMIN with isPlatformOwner set — only the
//      platform-owner script sets it, no API route can;
//   3. its email is listed in PLATFORM_OWNER_EMAILS on the server, so a
//      flag set by mistake (or by a bad migration) grants nothing alone;
//   4. this login session was unlocked with password + emailed code in
//      the last 30 minutes (PlatformAuthService). Logging in again, or
//      logging out, ends the unlock.
// Failing 1–3 answers 404, so the console isn't discoverable.

export const PLATFORM_UNLOCK_NOT_REQUIRED = 'platformUnlockNotRequired';
// Only for the routes that perform the unlock itself.
export const PlatformUnlockNotRequired = () =>
  SetMetadata(PLATFORM_UNLOCK_NOT_REQUIRED, true);

export type PlatformActor = {
  id: string;
  email: string;
  organizationId: string;
  sessionId: string;
};

export function platformOwnerEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_OWNER_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

@Injectable()
export class PlatformOwnerGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      user?: { sub?: string };
      platformActor?: PlatformActor;
    }>();
    const userId = req.user?.sub;
    const owners = platformOwnerEmails();
    if (!userId || owners.size === 0) throw new NotFoundException();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        removedAt: true,
        organizationId: true,
        isPlatformOwner: true,
        currentSessionId: true,
        platformUnlockSessionId: true,
        platformUnlockedUntil: true,
      },
    });
    if (
      !user ||
      !user.isPlatformOwner ||
      !user.active ||
      user.removedAt ||
      !isAdminRole(user.role) ||
      !user.currentSessionId ||
      !owners.has(user.email.toLowerCase())
    ) {
      throw new NotFoundException();
    }

    const actor: PlatformActor = {
      id: user.id,
      email: user.email,
      organizationId: user.organizationId,
      // JwtStrategy already matched the token's session to this, so it is
      // the session making this request.
      sessionId: user.currentSessionId,
    };
    req.platformActor = actor;

    const unlockNotRequired = this.reflector.getAllAndOverride<boolean>(
      PLATFORM_UNLOCK_NOT_REQUIRED,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (unlockNotRequired) return true;

    const unlocked =
      user.platformUnlockSessionId === user.currentSessionId &&
      !!user.platformUnlockedUntil &&
      user.platformUnlockedUntil > new Date();
    if (!unlocked) {
      throw new ForbiddenException({
        code: 'PLATFORM_LOCKED',
        message: 'Unlock the platform console to continue.',
      });
    }
    return true;
  }
}
