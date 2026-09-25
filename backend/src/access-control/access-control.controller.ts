import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { AccessControlService } from './access-control.service';
import { UpsertAccessScheduleDto } from './dto/upsert-access-schedule.dto';

@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles('ADMIN')
@Controller('users/:userId/access-schedule')
export class AccessControlController {
  constructor(private readonly accessControlService: AccessControlService) {}

  @Get()
  list(@CurrentOrg() organizationId: string, @Param('userId') userId: string) {
    return this.accessControlService.listSchedule(organizationId, userId);
  }

  @Put()
  replace(
    @CurrentOrg() organizationId: string,
    @Param('userId') userId: string,
    @Body() dto: UpsertAccessScheduleDto,
  ) {
    return this.accessControlService.replaceSchedule(
      organizationId,
      userId,
      dto.windows,
    );
  }
}
