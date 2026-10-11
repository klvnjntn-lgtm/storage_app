// src/platform/platform-auth.service.ts
import {
  ForbiddenException,
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../auth/mailer/mailer.service';
import { AuditContext, writeAudit } from './platform-audit';

// Wrong password/code answers 400, never 401: the frontend treats any
// 401 as "session ended" and logs the user out.
//
// Step-up unlock for the platform console: password again, then a code
// sent to the owner's email. Same shape as the change-password OTP in
// AuthService (hashed code, short expiry, attempts claimed atomically).
@Injectable()
export class PlatformAuthService {
  static readonly OTP_TTL_MS = 10 * 60 * 1000;
  static readonly OTP_MAX_ATTEMPTS = 5;
  static readonly UNLOCK_TTL_MS = 30 * 60 * 1000;

  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  async status(ctx: AuditContext) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.actor.id },
      select: { platformUnlockSessionId: true, platformUnlockedUntil: true },
    });
    const unlocked =
      user.platformUnlockSessionId === ctx.actor.sessionId &&
      !!user.platformUnlockedUntil &&
      user.platformUnlockedUntil > new Date();
    return {
      email: ctx.actor.email,
      unlocked,
      unlockedUntil: unlocked ? user.platformUnlockedUntil : null,
    };
  }

  async requestUnlock(ctx: AuditContext, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.actor.id },
      select: { email: true, password: true },
    });

    if (!(await bcrypt.compare(password ?? '', user.password))) {
      await writeAudit(this.prisma, ctx, 'unlock.password_failed');
      throw new BadRequestException('Password is incorrect');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.user.update({
      where: { id: ctx.actor.id },
      data: {
        platformOtpHash: await bcrypt.hash(code, 10),
        platformOtpExpires: new Date(
          Date.now() + PlatformAuthService.OTP_TTL_MS,
        ),
        platformOtpAttempts: 0,
      },
    });

    try {
      await this.mailer.sendPlatformUnlockCode(user.email, code);
    } catch (err) {
      this.logger.error(
        `Failed to send platform unlock code to ${user.email}`,
        err instanceof Error ? err.stack : err,
      );
      await this.clearCode(ctx.actor.id);
      throw new ForbiddenException(
        'Could not send the code email. Please try again.',
      );
    }

    await writeAudit(this.prisma, ctx, 'unlock.code_sent');
    return { message: 'A code has been sent to your email.' };
  }

  async confirmUnlock(ctx: AuditContext, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.actor.id },
      select: { platformOtpHash: true, platformOtpExpires: true },
    });
    if (
      !user.platformOtpHash ||
      !user.platformOtpExpires ||
      user.platformOtpExpires < new Date()
    ) {
      throw new BadRequestException(
        'Code is invalid or expired. Please request a new one.',
      );
    }

    // Claim an attempt before comparing, so parallel guesses can't all
    // slip under the cap (see AuthService.confirmPasswordChange).
    const claimed = await this.prisma.user.updateMany({
      where: {
        id: ctx.actor.id,
        platformOtpAttempts: { lt: PlatformAuthService.OTP_MAX_ATTEMPTS },
      },
      data: { platformOtpAttempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      await this.clearCode(ctx.actor.id);
      await writeAudit(this.prisma, ctx, 'unlock.too_many_attempts');
      throw new BadRequestException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    if (!(await bcrypt.compare(code ?? '', user.platformOtpHash))) {
      await writeAudit(this.prisma, ctx, 'unlock.code_failed');
      throw new BadRequestException('Incorrect code');
    }

    const unlockedUntil = new Date(
      Date.now() + PlatformAuthService.UNLOCK_TTL_MS,
    );
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: ctx.actor.id },
        data: {
          platformOtpHash: null,
          platformOtpExpires: null,
          platformOtpAttempts: 0,
          platformUnlockSessionId: ctx.actor.sessionId,
          platformUnlockedUntil: unlockedUntil,
        },
      }),
      writeAudit(this.prisma, ctx, 'unlock'),
    ]);
    return { unlocked: true, unlockedUntil };
  }

  async lock(ctx: AuditContext) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: ctx.actor.id },
        data: { platformUnlockSessionId: null, platformUnlockedUntil: null },
      }),
      writeAudit(this.prisma, ctx, 'lock'),
    ]);
    return { unlocked: false };
  }

  private clearCode(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        platformOtpHash: null,
        platformOtpExpires: null,
        platformOtpAttempts: 0,
      },
    });
  }
}
