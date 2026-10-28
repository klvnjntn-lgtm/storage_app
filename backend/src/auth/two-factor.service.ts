import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';
import { open, seal } from './secret-box';
import { isAdminRole } from './roles';

const RECOVERY_CODE_COUNT = 10;
const CHALLENGE_TTL = '5m';

const hashCode = (code: string) =>
  createHash('sha256')
    .update(code.replace(/[\s-]/g, '').toUpperCase())
    .digest('hex');

// Two-factor sign-in with an authenticator app. Set up in two steps —
// setup() hands out a secret and QR code, enable() switches it on only
// once the user proves their app produces the right codes — so nobody
// locks themselves out with a mistyped secret.
//
// At login the password step returns a short-lived challenge token
// instead of a session (AuthService.login); completing it with a code
// (or a one-time recovery code) is what issues the session.
@Injectable()
export class TwoFactorService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        totpEnabledAt: true,
        totpRecoveryCodes: true,
        organization: { select: { require2faForAdmins: true } },
        role: true,
      },
    });
    return {
      enabled: !!user.totpEnabledAt,
      enabledAt: user.totpEnabledAt,
      recoveryCodesLeft: user.totpRecoveryCodes.length,
      requiredByOrg:
        user.organization.require2faForAdmins && isAdminRole(user.role),
    };
  }

  async setup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, totpEnabledAt: true },
    });
    if (user.totpEnabledAt)
      throw new BadRequestException('Two-factor sign-in is already on');
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: seal(secret) },
    });
    const url = otpauthUrl(secret, user.email);
    return {
      secret,
      otpauthUrl: url,
      qrCode: await QRCode.toDataURL(url, { margin: 1, width: 220 }),
    };
  }

  // Returns the recovery codes — the only time they're ever shown.
  async enable(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpSecret: true, totpEnabledAt: true },
    });
    if (user.totpEnabledAt)
      throw new BadRequestException('Two-factor sign-in is already on');
    if (!user.totpSecret)
      throw new BadRequestException('Start the setup first');
    if (verifyTotp(open(user.totpSecret), code) === null)
      throw new BadRequestException(
        'That code is not right — check the time on your phone and try again',
      );

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = randomBytes(5).toString('hex').toUpperCase();
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: new Date(),
        totpRecoveryCodes: codes.map(hashCode),
      },
    });
    return { recoveryCodes: codes };
  }

  // Needs the password and a current code, so a borrowed unlocked laptop
  // isn't enough to strip the second factor.
  async disable(userId: string, password: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        password: true,
        role: true,
        organization: { select: { require2faForAdmins: true } },
      },
    });
    if (!(await bcrypt.compare(password, user.password)))
      throw new UnauthorizedException('Wrong password');
    if (isAdminRole(user.role) && user.organization.require2faForAdmins) {
      throw new ForbiddenException(
        'Your organization requires two-factor sign-in for admins',
      );
    }
    await this.verifyCode(userId, code);
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpRecoveryCodes: [] },
    });
    return { enabled: false };
  }

  // An authenticator code, or one unused recovery code (consumed).
  async verifyCode(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        totpSecret: true,
        totpEnabledAt: true,
        totpRecoveryCodes: true,
      },
    });
    if (!user.totpEnabledAt || !user.totpSecret)
      throw new BadRequestException('Two-factor sign-in is not on');
    if (verifyTotp(open(user.totpSecret), code) !== null) return;

    const hashed = hashCode(code ?? '');
    if (user.totpRecoveryCodes.includes(hashed)) {
      // Conditional on the code still being there, so two logins racing
      // with the same recovery code can't both use it.
      const used = await this.prisma.user.updateMany({
        where: { id: userId, totpRecoveryCodes: { has: hashed } },
        data: {
          totpRecoveryCodes: user.totpRecoveryCodes.filter((c) => c !== hashed),
        },
      });
      if (used.count === 1) return;
    }
    throw new UnauthorizedException('Invalid two-factor code');
  }

  createChallenge(userId: string): string {
    return this.jwt.sign(
      { sub: userId, purpose: 'mfa-challenge' },
      { expiresIn: CHALLENGE_TTL },
    );
  }

  readChallenge(token: string): string {
    try {
      const payload = this.jwt.verify<{ sub: string; purpose: string }>(token);
      if (payload.purpose !== 'mfa-challenge') throw new Error('wrong purpose');
      return payload.sub;
    } catch {
      throw new UnauthorizedException(
        'Your sign-in expired — enter your password again',
      );
    }
  }

  // Turning the requirement on is only allowed for an admin who already
  // uses 2FA themselves, so the switch can't lock out the person flipping it.
  async setOrgRequirement(
    organizationId: string,
    userId: string,
    required: boolean,
  ) {
    if (required) {
      const me = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { totpEnabledAt: true },
      });
      if (!me.totpEnabledAt)
        throw new BadRequestException(
          'Turn on two-factor sign-in for your own account first',
        );
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { require2faForAdmins: required },
    });
    return { require2faForAdmins: required };
  }
}
