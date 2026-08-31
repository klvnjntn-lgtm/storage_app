import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { InviteDto } from './dto/invite.dto';
import { SetSeatLimitDto } from './dto/set-seat-limit.dto';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AdminKeyGuard } from './guards/admin-key.guard';
import { SkipLicenseCheck } from 'src/license/decorators/skip-license-check.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Always creates a brand-new organization with the caller as its
  // first ADMIN. Deliberately does NOT accept an organizationId or role
  // from the client — see AuthService.register for why. Joining an
  // existing org happens only via invite() below.
  @Public()
  @SkipLicenseCheck()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.organizationName);
  }

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
  @Public()
  @SkipLicenseCheck()
  @UseGuards(AdminKeyGuard)
  @Patch('org/:orgId/seats')
  setSeatLimit(@Param('orgId') orgId: string, @Body() dto: SetSeatLimitDto) {
    return this.authService.setSeatLimit(orgId, dto.seatLimit);
  }
}