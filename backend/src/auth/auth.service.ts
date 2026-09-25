import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer/mailer.service';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { DevicesService } from './devices.service';
import { resolveTimezone } from '../accounting/business-date';
import { isWithinAccessWindow } from './access-schedule.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mailer: MailerService,
    private devices: DevicesService,
  ) {}

  async login(
    email: string,
    password: string,
    deviceId?: string,
    userAgent?: string,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        accessSchedules: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
        organization: { select: { timezone: true } },
      },
    });
    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // DRIVER-only restrictions — see devices.service.ts / access-schedule.util.ts.
    if (user.role === 'DRIVER') {
      if (user.accessSchedules.length > 0) {
        const tz = resolveTimezone(user.organization);
        if (!isWithinAccessWindow(user.accessSchedules, new Date(), tz)) {
          throw new UnauthorizedException('Outside allowed access hours.');
        }
      }

      if (deviceId) {
        const result = await this.devices.registerOrCheck(
          user.organizationId,
          user.id,
          deviceId,
          userAgent,
        );
        if (result === 'PENDING') {
          throw new UnauthorizedException(
            'This device is pending admin approval.',
          );
        }
        if (result === 'REJECTED') {
          throw new UnauthorizedException(
            'This device has been denied access. Contact your administrator.',
          );
        }
      }
    }

    return this.issueToken(user.id, user.email, user.role, user.organizationId);
  }

  // Public registration ALWAYS creates a brand new organization, and the
  // registering user is always its first ADMIN. There is intentionally
  // no way to join an existing org through this endpoint — that used to
  // be possible via a client-supplied organizationId (and an equally
  // client-supplied role, defaulting to 'ADMIN'), which let anyone on
  // the internet self-register as an admin of any org whose id they
  // knew or guessed. Joining an existing org now only happens through
  // invite(), which requires an authenticated ADMIN of that org to call
  // it — see AuthController.invite.
  async register(email: string, password: string, organizationName: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    if (!organizationName?.trim()) {
      throw new ForbiddenException('organizationName is required');
    }

    const hashed = await bcrypt.hash(password, 10);

    const org = await this.prisma.organization.create({
      data: {
        name: organizationName.trim(),
        users: {
          create: { email: normalizedEmail, password: hashed, role: 'ADMIN' },
        },
      },
      include: { users: true },
    });

    const user = org.users[0];
    return this.issueToken(user.id, user.email, user.role, user.organizationId);
  }

  // The only supported way to add a user to an EXISTING org. Requires
  // an authenticated ADMIN of that org (enforced by RolesGuard on the
  // controller route) — inviterOrgId comes from the caller's own JWT,
  // never from client input, so this can't be used to add users to a
  // different org than the one the caller administers.
  async invite(
    inviterOrgId: string,
    email: string,
    password: string,
    role: 'ADMIN' | 'USER' | 'DRIVER' = 'USER',
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: inviterOrgId },
    });
    if (!org) {
      throw new ForbiddenException('Organization not found');
    }

    const activeCount = await this.prisma.user.count({
      where: { organizationId: inviterOrgId, active: true },
    });

    if (activeCount >= org.seatLimit) {
      throw new ForbiddenException(
        `Seat limit reached (${org.seatLimit}). Upgrade your plan to add more users.`,
      );
    }

    const hashed = await bcrypt.hash(password, 10);

    return this.prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashed,
        role,
        organizationId: inviterOrgId,
      },
      select: { id: true, email: true, role: true },
    });
  }
  private static readonly CHANGE_PASSWORD_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly CHANGE_PASSWORD_OTP_MAX_ATTEMPTS = 5;

  // Step 1 of 2: validates the current/new password the same way the old
  // single-step changePassword() used to, then emails a one-time code
  // instead of applying the change immediately. The new password is
  // already hashed and stashed on the user row (pendingPasswordHash) so
  // confirmPasswordChange() only needs the code, not the password again —
  // it never touches the plaintext password after this call returns.
  async requestPasswordChange(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) {
      throw new UnauthorizedException('User not found');
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (!newPassword || newPassword.length < 8) {
      throw new ForbiddenException('Password must be at least 8 characters');
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.password);
    if (sameAsOld) {
      throw new ForbiddenException(
        'New password must be different from current password',
      );
    }

    const code = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    const [otpHash, pendingPasswordHash] = await Promise.all([
      bcrypt.hash(code, 10),
      bcrypt.hash(newPassword, 10),
    ]);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        changePasswordOtpHash: otpHash,
        changePasswordOtpExpires: new Date(
          Date.now() + AuthService.CHANGE_PASSWORD_OTP_TTL_MS,
        ),
        changePasswordOtpAttempts: 0,
        pendingPasswordHash,
      },
    });

    // Unlike forgotPassword(), the caller here is already authenticated as
    // this exact account, so there's no enumeration risk in surfacing a
    // mailer failure — the user should know their code never arrived.
    try {
      await this.mailer.sendChangePasswordOtp(user.email, code);
    } catch (err) {
      this.logger.error(
        `Failed to send change-password OTP to ${user.email}`,
        err instanceof Error ? err.stack : err,
      );
      throw new ForbiddenException(
        'Could not send confirmation email. Please try again.',
      );
    }

    return { message: 'A confirmation code has been sent to your email.' };
  }

  // Step 2 of 2: confirms the code and applies the password already
  // hashed & stashed by requestPasswordChange(). Attempts are capped
  // (CHANGE_PASSWORD_OTP_MAX_ATTEMPTS) since a 6-digit code is brute-
  // forceable given enough tries — exceeding the cap invalidates the
  // pending request entirely, mirroring how an expired code is handled.
  async confirmPasswordChange(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) {
      throw new UnauthorizedException('User not found');
    }

    if (
      !user.changePasswordOtpHash ||
      !user.changePasswordOtpExpires ||
      !user.pendingPasswordHash ||
      user.changePasswordOtpExpires < new Date()
    ) {
      throw new UnauthorizedException(
        'Code is invalid or expired. Please request a new one.',
      );
    }

    if (
      user.changePasswordOtpAttempts >=
      AuthService.CHANGE_PASSWORD_OTP_MAX_ATTEMPTS
    ) {
      await this.clearPendingPasswordChange(user.id);
      throw new UnauthorizedException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    const valid = await bcrypt.compare(code ?? '', user.changePasswordOtpHash);
    if (!valid) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { changePasswordOtpAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Incorrect code');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: user.pendingPasswordHash,
        currentSessionId: null, // force re-login on all devices, same as resetPassword()
        changePasswordOtpHash: null,
        changePasswordOtpExpires: null,
        changePasswordOtpAttempts: 0,
        pendingPasswordHash: null,
      },
    });

    return { message: 'Password changed. Please sign in again.' };
  }

  private async clearPendingPasswordChange(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        changePasswordOtpHash: null,
        changePasswordOtpExpires: null,
        changePasswordOtpAttempts: 0,
        pendingPasswordHash: null,
      },
    });
  }

  // Always returns the same message whether or not the email is
  // registered — a differing response here would let this endpoint be
  // used to enumerate every registered email address.
  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    const genericResponse = {
      message:
        'If an account exists for that email, a reset link is on its way.',
    };

    if (!user || !user.active) {
      return genericResponse;
    }

    // Only the hash is stored, mirroring how passwords are handled — if
    // the database ever leaks, the leaked hashes alone can't be used to
    // reset anyone's password (the raw token never touches the DB).
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken: tokenHash, resetTokenExpires: expires },
    });

    // FIX — a mailer failure (bad SMTP creds, provider outage) must not
    // bubble up as a 500: that would distinguish a real email (500) from
    // a fake one (genericResponse below), defeating the whole point of
    // this method returning identical responses either way.
    try {
      await this.mailer.sendPasswordReset(user.email, rawToken);
    } catch (err) {
      this.logger.error(
        `Failed to send password reset email to ${user.email}`,
        err instanceof Error ? err.stack : err,
      );
    }

    return genericResponse;
  }

  async resetPassword(rawToken: string, newPassword: string) {
    if (!rawToken) {
      throw new UnauthorizedException('Reset link is invalid or expired');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new ForbiddenException('Password must be at least 8 characters');
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const user = await this.prisma.user.findFirst({
      where: { resetToken: tokenHash, resetTokenExpires: { gt: new Date() } },
    });

    if (!user) {
      throw new UnauthorizedException('Reset link is invalid or expired');
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        resetToken: null,
        resetTokenExpires: null,
        currentSessionId: null, // force logout everywhere — see jwt.strategy.ts
      },
    });

    return { message: 'Password has been reset' };
  }

  // FIX — there was no way for a user to invalidate their own token short
  // of changing their password. JWTs are 7-day lived (auth.module.ts), so
  // a leaked token previously stayed valid for up to 7 days with no
  // user-triggered revocation. Nulling currentSessionId makes
  // jwt.strategy.ts's session check reject the token on its very next use.
  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { currentSessionId: null },
    });
    return { message: 'Logged out' };
  }

  private async issueToken(
    sub: string,
    email: string,
    role: string,
    organizationId: string,
  ) {
    const sessionId = randomUUID();

    await this.prisma.user.update({
      where: { id: sub },
      data: {
        currentSessionId: sessionId,
      },
    });

    const accessToken = this.jwt.sign({
      sub,
      email,
      role,
      organizationId,
      sessionId,
    });

    return { accessToken };
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
        role: true,
        avatarUrl: true,
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async updateAvatar(userId: string, avatarUrl: string | null | undefined) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: avatarUrl ?? null },
      select: { id: true, email: true, role: true, avatarUrl: true },
    });
  }

  // orgId here is only ever reached via AdminKeyGuard (see controller) —
  // no @CurrentOrg()/JWT org involved, this is a superadmin-only,
  // cross-org operation by design.
  async setSeatLimit(orgId: string, seatLimit: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    return this.prisma.organization.update({
      where: { id: orgId },
      data: { seatLimit },
    });
  }
}
