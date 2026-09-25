import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { UsersService } from './users.service';
import { SetActiveDto } from './dto/set-active.dto';

@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('drivers')
  listDrivers(@CurrentOrg() organizationId: string) {
    return this.usersService.listDrivers(organizationId);
  }

  @Patch(':id/active')
  setActive(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: SetActiveDto,
  ) {
    return this.usersService.setActive(organizationId, id, dto.active);
  }
}
