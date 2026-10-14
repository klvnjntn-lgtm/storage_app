import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Roles('ADMIN', 'USER')
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get('summary')
  summary(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.dashboard.summary(organizationId, user);
  }
}
