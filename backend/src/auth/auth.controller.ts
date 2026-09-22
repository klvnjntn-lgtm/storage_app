import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { InviteDto } from './dto/invite.dto';
import { SetSeatLimitDto } from './dto/set-seat-limit.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AdminKeyGuard } from './guards/admin-key.guard';
import { SkipLicenseCheck } from 'src/license/decorators/skip-license-check.decorator';
import { AuthGuard } from '@nestjs/passport/dist/auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Always creates a brand-new organization with the caller as its
  // first ADMIN. Deliberately does NOT accept an organizationId or role
  // from the client — see AuthService.register for why. Joining an
  // existing org happens only via invite() below.
  // FIX — was completely unrate-limited. ThrottlerModule/ThrottlerGuard
  // is now registered globally (app.module.ts), so this only needed to
  // opt into a tighter-than-default limit for a credential-stuffing /
  // account-creation-spam target.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @SkipLicenseCheck()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.organizationName);
  }

  // FIX — classic brute-force/credential-stuffing target, previously
  // unrate-limited.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @SkipLicenseCheck()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Get('me')
  async me(@CurrentUser() user: any) {
    return this.authService.me(user.sub);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('me')
  updateMe(@CurrentUser() user: { sub: string }, @Body() dto: UpdateAvatarDto) {
    return this.authService.updateAvatar(user.sub, dto.avatarUrl);
  }

  // organizationId comes from the authenticated caller's own JWT, never
  // from the request body — an ADMIN can only invite into their own org.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('invite')
  invite(
    @Body() dto: InviteDto,
    @CurrentUser() user: { organizationId: string },
  ) {
    return this.authService.invite(
      user.organizationId,
      dto.email,
      dto.password,
      dto.role,
    );
  }

  // Superadmin-only, cross-org operation — reuses the same hardened
  // AdminKeyGuard used by the module-toggle routes instead of a
  // hand-rolled, non-constant-time secret comparison inline here.
  // Same rate limit as OrganizationModulesController's admin-key routes —
  // secret-guessing should be rate-limited independent of the
  // constant-time comparison.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @SkipLicenseCheck()
  @UseGuards(AdminKeyGuard)
  @Patch('org/:orgId/seats')
  setSeatLimit(@Param('orgId') orgId: string, @Body() dto: SetSeatLimitDto) {
    return this.authService.setSeatLimit(orgId, dto.seatLimit);
  }

  // FIX — unrate-limited token-request generation is a mailer-spam / SMTP
  // quota vector even though the response is a uniform message regardless
  // of account existence.
  // FIX — was missing @Public()/@SkipLicenseCheck(), so the global
  // JwtAuthGuard rejected every call with 401 before the handler ever
  // ran: a logged-out user (the only person who'd ever call this) has
  // no bearer token to send. Same shape as register/login above.
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Public()
  @SkipLicenseCheck()
  @Post('forgot-password')
forgotPassword(@Body('email') email: string) {
  return this.authService.forgotPassword(email);
}

// FIX — same missing @Public()/@SkipLicenseCheck() issue as
// forgot-password above; a locked-out user has no token to authenticate
// with, so the global guards must let this route through unauthenticated.
@Public()
@SkipLicenseCheck()
@Post('reset-password')
resetPassword(
  @Body('token') token: string,
  @Body('newPassword') newPassword: string,
) {
  return this.authService.resetPassword(token, newPassword);
}

// FIX — no logout/session-revocation endpoint existed. See
// AuthService.logout for how this invalidates the current token
// immediately rather than waiting for its 7-day expiry.
@UseGuards(AuthGuard('jwt'))
@Post('logout')
logout(@CurrentUser() user: { sub: string }) {
  return this.authService.logout(user.sub);
}

@UseGuards(AuthGuard('jwt'))
@Post('change-password')
changePassword(
  @CurrentUser() user: { sub: string },
  @Body('currentPassword') currentPassword: string,
  @Body('newPassword') newPassword: string,
) {
  return this.authService.changePassword(user.sub, currentPassword, newPassword);
}
}