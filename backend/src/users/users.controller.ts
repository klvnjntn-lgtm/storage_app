import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { SetActiveDto } from './dto/set-active.dto';
import { SetDisplayNameDto } from './dto/set-display-name.dto';

@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listMembers(@CurrentOrg() organizationId: string) {
    return this.usersService.listMembers(organizationId);
  }

  @Delete(':id')
  removeMember(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: { sub: string },
    @Param('id') id: string,
  ) {
    return this.usersService.removeMember(organizationId, user.sub, id);
  }

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

  @Patch(':id/display-name')
  setDisplayName(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: SetDisplayNameDto,
  ) {
    return this.usersService.setDisplayName(
      organizationId,
      id,
      dto.displayName ?? null,
    );
  }
}
