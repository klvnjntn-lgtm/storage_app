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
import { randomUUID, randomBytes, randomInt, createHash } from 'crypto';
import { DevicesService } from './devices.service';
import { LicenseService } from '../license/license.service';
import { resolveTimezone } from '../accounting/business-date';
import { isWithinAccessWindow } from './access-schedule.util';
import { LoginLockout } from './login-lockout';
import { platformOwnerEmails } from '../platform/platform-owner.guard';
import { ModuleKey } from '@prisma/client';
import { BillingService } from '../billing/billing.service';
import { TwoFactorService } from './two-factor.service';
import { PlanLimitsService } from '../billing/plan-limits.service';
import { isAdminRole } from './roles';
import { bookingBranchId } from './branch-scope';
import { resolveBranchId } from '../branches/resolve-branch';

// The desktop app (desktop/) runs its own backend for a single business,
// with no platform owner to grant modules — it sets this to the modules
// every newly registered org starts with (comma-separated ModuleKeys).
export function autoEnabledModules(): ModuleKey[] {
  const keys = Object.values(ModuleKey) as string[];
  return (process.env.AUTO_ENABLE_MODULES ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m): m is ModuleKey => keys.includes(m));
}

// Compared against when the account doesn't exist, so a login for an
// unknown email costs the same bcrypt work as one for a real account.
const TIMING_DUMMY_HASH = bcrypt.hashSync('waresys-timing-dummy', 10);

// Shared registration/reset/change minimum.
export const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly loginLockout = new LoginLockout();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mailer: MailerService,
    private devices: DevicesService,
    private license: LicenseService,
    private billing: BillingService,
    private planLimits: PlanLimitsService,
    private twoFactor: TwoFactorService,
  ) {}

  async login(
    email: string,
    password: string,
    deviceId?: string,
    userAgent?: string,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    this.loginLockout.assertNotLocked(normalizedEmail);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        accessSchedules: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
        organization: { select: { timezone: true } },
      },
    });

    // Always run one bcrypt comparison, even for an unknown or inactive
    // account — returning early made "no such email" measurably faster
    // than "wrong password", which let response timing enumerate accounts.
    const valid = await bcrypt.compare(password, user?.password ?? TIMING_DUMMY_HASH);
    if (!user || !user.active || !valid) {
      this.loginLockout.recordFailure(normalizedEmail);
      throw new UnauthorizedException('Invalid credentials');
    }
    this.loginLockout.recordSuccess(normalizedEmail);

    // DRIVER-only restrictions — see devices.service.ts / access-schedule.util.ts.
    if (user.role === 'DRIVER') {
      if (user.accessSchedules.length > 0) {
        const tz = resolveTimezone(user.organization);
        if (!isWithinAccessWindow(user.accessSchedules, new Date(), tz)) {
          throw new UnauthorizedException('Outside allowed access hours.');
        }
      }

      // Device approval is switched off unless DRIVER_DEVICE_APPROVAL=true
      // (turned off while approved drivers were still being refused).
      if (process.env.DRIVER_DEVICE_APPROVAL === 'true') {
        // Without this, a driver whose device was rejected could log in by
        // simply not sending x-device-id. The web client always sends one.
        if (!deviceId) {
          throw new UnauthorizedException('A device id is required to sign in as a driver.');
        }
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

    // Second factor: the password was right, but the session only comes
    // from completeTwoFactorLogin() with a code.
    if (user.totpEnabledAt) {
      return { mfaRequired: true as const, mfaToken: this.twoFactor.createChallenge(user.id) };
    }

    return this.issueToken(user.id, user.email, user.role, user.organizationId);
  }

  async completeTwoFactorLogin(mfaToken: string, code: string) {
    const userId = this.twoFactor.readChallenge(mfaToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException('Invalid credentials');
    // Same per-account lockout as passwords: a challenge token is good for
    // five minutes, which is plenty of guesses otherwise.
    this.loginLockout.assertNotLocked(user.email);
    try {
      await this.twoFactor.verifyCode(user.id, code);
    } catch (err) {
      this.loginLockout.recordFailure(user.email);
      throw err;
    }
    this.loginLockout.recordSuccess(user.email);
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

    // The desktop app is licensed per business: once its one organization
    // exists, nobody on the office network can register another.
    if (
      process.env.SINGLE_ORGANIZATION === 'true' &&
      (await this.prisma.organization.count()) > 0
    ) {
      throw new ForbiddenException(
        'This WareSys install already has a business registered',
      );
    }

    const hashed = await bcrypt.hash(password, 10);

    // On the self-serve SaaS, signups start a free trial of the plans.
    // Opt-in per deployment (SELF_SERVE_BILLING=true): licensed installs
    // and the desktop app keep new orgs on "custom", as before — the
    // edition alone can't tell them apart, since cloud servers carry a
    // license key too.
    const selfServe =
      process.env.SELF_SERVE_BILLING === 'true' &&
      process.env.SINGLE_ORGANIZATION !== 'true';

    const org = await this.prisma.organization.create({
      data: {
        name: organizationName.trim(),
        // Desktop app: the seats on its license (see LicenseService).
        ...(process.env.SINGLE_ORGANIZATION === 'true' && {
          seatLimit: this.license.licensedSeats() ?? undefined,
        }),
        users: {
          create: { email: normalizedEmail, password: hashed, role: 'MASTER' },
        },
        // AUTO_ENABLE_MODULES grants modules with no expiry, so it's
        // skipped for a self-serve signup: the trial already turns every
        // module on, and a forever grant would outlive it.
        modules: {
          create: (selfServe ? [] : autoEnabledModules()).map((module) => ({
            module,
            enabled: true,
          })),
        },
      },
      include: { users: true },
    });

    if (selfServe) await this.billing.startTrial(org.id);

    const user = org.users[0];
    return this.issueToken(user.id, user.email, user.role, user.organizationId);
  }

  // The only supported way to add a user to an EXISTING org. Requires
  // an authenticated ADMIN of that org (enforced by RolesGuard on the
  // controller route) — inviterOrgId comes from the caller's own JWT,
  // never from client input, so this can't be used to add users to a
  // different org than the one the caller administers.
  // A branch ADMIN invites into their own branch and can't make a MASTER;
  // a MASTER picks the branch (default: the first).
  async invite(
    inviterOrgId: string,
    email: string,
    password: string,
    role: 'MASTER' | 'ADMIN' | 'USER' | 'DRIVER' = 'USER',
    inviter: { role: string; branchId?: string | null } = { role: 'MASTER' },
    requestedBranchId?: string,
  ) {
    if (role === 'MASTER' && inviter.role !== 'MASTER') {
      throw new ForbiddenException('Only a master account can invite another master');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    // A member removed from this same org can be re-invited: restore the
    // account (new password/role) instead of failing on the unique email.
    const restoring =
      existing?.removedAt != null && existing.organizationId === inviterOrgId;
    if (existing && !restoring) {
      throw new ConflictException('Email already registered');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: inviterOrgId },
    });
    if (!org) {
      throw new ForbiddenException('Organization not found');
    }

    await this.planLimits.assertCanAdd(inviterOrgId, 'seats');

    const branchId =
      role === 'ADMIN' || role === 'USER'
        ? await resolveBranchId(this.prisma, inviterOrgId, {
            branchId: bookingBranchId(inviter, requestedBranchId ?? null),
          })
        : null;

    const hashed = await bcrypt.hash(password, 10);

    if (restoring) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          password: hashed,
          role,
          branchId,
          active: true,
          removedAt: null,
          currentSessionId: null,
        },
        select: { id: true, email: true, role: true },
      });
    }

    return this.prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashed,
        role,
        branchId,
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

    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ForbiddenException('Password must be at least 8 characters');
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.password);
    if (sameAsOld) {
      throw new ForbiddenException(
        'New password must be different from current password',
      );
    }

    // crypto.randomInt, not Math.random — the code is a credential.
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
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

    // Claim an attempt atomically BEFORE comparing. Reading the counter and
    // incrementing it afterwards let parallel requests all pass the check
    // against the same stale count, so the 5-try cap could be exceeded by
    // firing guesses concurrently. The successful try also uses up an
    // attempt, which doesn't matter since success clears the counter.
    const claimed = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        changePasswordOtpAttempts: { lt: AuthService.CHANGE_PASSWORD_OTP_MAX_ATTEMPTS },
      },
      data: { changePasswordOtpAttempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      await this.clearPendingPasswordChange(user.id);
      throw new UnauthorizedException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    const valid = await bcrypt.compare(code ?? '', user.changePasswordOtpHash);
    if (!valid) {
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
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
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
  //
  // Logout by presented token. Ends the session only if the token is still
  // the user's current one, so signing out a stale tab never kills the
  // session the same user has since opened somewhere else. An invalid or
  // expired token is simply ignored — the caller clears the cookie anyway.
  async logoutToken(token: string | null) {
    if (!token) return;
    let payload: { sub?: string; sessionId?: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      return;
    }
    if (!payload.sub || !payload.sessionId) return;
    await this.prisma.user.updateMany({
      where: { id: payload.sub, currentSessionId: payload.sessionId },
      data: { currentSessionId: null },
    });
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
        lastLoginAt: new Date(),
        lastActiveAt: new Date(),
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

  // branchId: the branch the request was scoped to (jwt.strategy.ts) —
  // the member's own, or the first when theirs was archived.
  async me(userId: string, branchId?: string | null) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
        role: true,
        avatarUrl: true,
        active: true,
        removedAt: true,
        isPlatformOwner: true,
        organization: {
          select: {
            id: true,
            name: true,
            // suspendedReason is written to be shown to the org's members;
            // billingNote is internal and deliberately not selected.
            suspendedAt: true,
            suspendedReason: true,
          },
        },
      },
    });
    if (!user) return null;
    const { active, removedAt, isPlatformOwner, ...profile } = user;
    // Only decides whether the app shows the console link; the console's
    // own routes re-check everything (PlatformOwnerGuard).
    const platformOwner =
      isPlatformOwner &&
      active &&
      !removedAt &&
      isAdminRole(user.role) &&
      platformOwnerEmails().has(user.email.toLowerCase());
    // Null = every branch (MASTER, DRIVER).
    const branch = branchId
      ? await this.prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } })
      : null;
    return { ...profile, platformOwner, branch };
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
