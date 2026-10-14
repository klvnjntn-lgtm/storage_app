import { Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { OnboardingService } from './onboarding.service';

@Roles('ADMIN')
@Controller('onboarding')
export class OnboardingController {
  constructor(private onboarding: OnboardingService) {}

  @Get()
  status(@CurrentOrg() organizationId: string) {
    return this.onboarding.status(organizationId);
  }

  // Finished, or skipped — either way the wizard stops showing.
  @Post('complete')
  complete(@CurrentOrg() organizationId: string) {
    return this.onboarding.complete(organizationId);
  }
}
