import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer/mailer.service';
import { randomUUID, randomBytes, createHash } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mailer: MailerService,
  ) {}

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
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
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
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
    role: 'ADMIN' | 'USER' = 'USER',
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const org = await this.prisma.organization.findUnique({ where: { id: inviterOrgId } });
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
      data: { email: normalizedEmail, password: hashed, role, organizationId: inviterOrgId },
      select: { id: true, email: true, role: true },
    });
  }
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
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
    throw new ForbiddenException('New password must be different from current password');
  }

  const hashed = await bcrypt.hash(newPassword, 10);

  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashed,
      currentSessionId: null, // force re-login on all devices, same as resetPassword()
    },
  });

  return { message: 'Password changed. Please sign in again.' };
}

  // Always returns the same message whether or not the email is
  // registered — a differing response here would let this endpoint be
  // used to enumerate every registered email address.
  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

    const genericResponse = {
      message: 'If an account exists for that email, a reset link is on its way.',
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

    await this.mailer.sendPasswordReset(user.email, rawToken);

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
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  // orgId here is only ever reached via AdminKeyGuard (see controller) —
  // no @CurrentOrg()/JWT org involved, this is a superadmin-only,
  // cross-org operation by design.
  async setSeatLimit(orgId: string, seatLimit: number) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    return this.prisma.organization.update({
      where: { id: orgId },
      data: { seatLimit },
    });
  }
}