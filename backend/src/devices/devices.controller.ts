import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import {
  CurrentUser,
  type JwtPayload,
} from '../auth/decorators/current-user.decorator';
import { DevicesService } from '../auth/devices.service';

@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles('ADMIN')
@Controller()
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get('devices')
  listAll(
    @CurrentOrg() organizationId: string,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
  ) {
    return this.devicesService.listForOrg(organizationId, { userId, status });
  }

  @Get('users/:userId/devices')
  listForUser(
    @CurrentOrg() organizationId: string,
    @Param('userId') userId: string,
  ) {
    return this.devicesService.listForOrg(organizationId, { userId });
  }

  @Patch('devices/:id/approve')
  approve(
    @CurrentOrg() organizationId: string,
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.devicesService.approve(organizationId, id, admin.sub);
  }

  @Patch('devices/:id/reject')
  reject(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.devicesService.reject(organizationId, id);
  }

  @Patch('devices/:id/revoke')
  revoke(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.devicesService.revoke(organizationId, id);
  }
}
