import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from './decorators/roles.decorator';
import { CurrentOrg } from './decorators/current-org.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './decorators/current-user.decorator';
import { AllowSuspendedOrg } from './decorators/allow-suspended-org.decorator';
import { TwoFactorService } from './two-factor.service';
import {
  DisableTwoFactorDto,
  TwoFactorCodeDto,
  TwoFactorPolicyDto,
} from './dto/two-factor.dto';

// Every signed-in user manages their own second factor. These routes stay
// open to an admin who hasn't set it up yet even when the org requires it
// (see JwtStrategy), since this is where they set it up.
@Roles('ADMIN', 'USER', 'DRIVER')
@AllowSuspendedOrg()
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private twoFactor: TwoFactorService) {}

  @Get()
  status(@CurrentUser() user: JwtPayload) {
    return this.twoFactor.status(user.sub);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('setup')
  setup(@CurrentUser() user: JwtPayload) {
    return this.twoFactor.setup(user.sub);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('enable')
  enable(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorCodeDto) {
    return this.twoFactor.enable(user.sub, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('disable')
  disable(@CurrentUser() user: JwtPayload, @Body() dto: DisableTwoFactorDto) {
    return this.twoFactor.disable(user.sub, dto.password, dto.code);
  }

  @Roles('ADMIN')
  @Patch('policy')
  policy(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: TwoFactorPolicyDto,
  ) {
    return this.twoFactor.setOrgRequirement(
      organizationId,
      user.sub,
      dto.require2faForAdmins,
    );
  }
}
