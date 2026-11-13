import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer/mailer.service';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// Verification only means something where the server can send email. A
// licensed single-business install (desktop app) has no public sign-up to
// abuse, and a LAN install without SMTP couldn't deliver the code at all,
// so neither is held to it.
export function emailVerificationEnforced(mailer: MailerService) {
  return mailer.isConfigured() && process.env.SINGLE_ORGANIZATION !== 'true';
}

// What an unverified business can't do yet: anything that sends from our
// servers to people outside the account (team invites, document emails).
// Without it, sign-up with a made-up address is a free spam relay that
// hurts the sending domain for every customer. Checked per organization —
// one verified MASTER is enough — so an invited member's own unverified
// address never blocks the business.
export async function assertOrgEmailVerified(
  prisma: PrismaService,
  mailer: MailerService,
  organizationId: string,
) {
  if (!emailVerificationEnforced(mailer)) return;
  const verified = await prisma.user.count({
    where: {
      organizationId,
      role: 'MASTER',
      active: true,
      removedAt: null,
      emailVerifiedAt: { not: null },
    },
  });
  if (!verified) {
    throw new ForbiddenException(
      "Verify the business owner's email address first (see the banner at the top of the app).",
    );
  }
}

// Email ownership: a 6-digit code to the address, entered in the app. Same
// shape as the change-password code (AuthService.requestPasswordChange):
// only a bcrypt hash is stored, it expires, and guesses are capped.
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

  async sendCode(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, active: true, emailVerifiedAt: true },
    });
    if (!user || !user.active) throw new UnauthorizedException('User not found');
    if (user.emailVerifiedAt) throw new BadRequestException('Your email address is already verified');
    if (!this.mailer.isConfigured()) {
      throw new ServiceUnavailableException('Email is not set up on this server.');
    }

    // crypto.randomInt, not Math.random — the code is a credential.
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifyOtpHash: await bcrypt.hash(code, 10),
        emailVerifyOtpExpires: new Date(Date.now() + OTP_TTL_MS),
        emailVerifyOtpAttempts: 0,
      },
    });

    try {
      await this.mailer.sendEmailVerificationCode(user.email, code);
    } catch (err) {
      this.logger.error(
        `Failed to send email verification code to ${user.email}`,
        err instanceof Error ? err.stack : err,
      );
      throw new ServiceUnavailableException('Could not send the verification email. Please try again.');
    }
    return { message: 'A verification code has been sent to your email.' };
  }

  async confirm(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        active: true,
        emailVerifiedAt: true,
        emailVerifyOtpHash: true,
        emailVerifyOtpExpires: true,
      },
    });
    if (!user || !user.active) throw new UnauthorizedException('User not found');
    if (user.emailVerifiedAt) return { verified: true };

    if (!user.emailVerifyOtpHash || !user.emailVerifyOtpExpires || user.emailVerifyOtpExpires < new Date()) {
      throw new BadRequestException('Code is invalid or expired. Please request a new one.');
    }

    // Claim the attempt atomically before comparing, so parallel guesses
    // can't all slip past the cap (see AuthService.confirmPasswordChange).
    const claimed = await this.prisma.user.updateMany({
      where: { id: user.id, emailVerifyOtpAttempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { emailVerifyOtpAttempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifyOtpHash: null, emailVerifyOtpExpires: null, emailVerifyOtpAttempts: 0 },
      });
      throw new BadRequestException('Too many incorrect attempts. Please request a new code.');
    }

    if (!(await bcrypt.compare(code ?? '', user.emailVerifyOtpHash))) {
      throw new BadRequestException('Incorrect code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerifyOtpHash: null,
        emailVerifyOtpExpires: null,
        emailVerifyOtpAttempts: 0,
      },
    });
    return { verified: true };
  }
}
