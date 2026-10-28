import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import type { MemberActor } from './users.service';
import { SetActiveDto } from './dto/set-active.dto';
import { SetDisplayNameDto } from './dto/set-display-name.dto';
import { SetRoleDto } from './dto/set-role.dto';
import { SetBranchDto } from './dto/set-branch.dto';

@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listMembers(@CurrentOrg() organizationId: string, @CurrentUser() user: MemberActor) {
    return this.usersService.listMembers(organizationId, user);
  }

  @Delete(':id')
  removeMember(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: MemberActor,
    @Param('id') id: string,
  ) {
    return this.usersService.removeMember(organizationId, user, id);
  }

  // Staff see the driver list to handle their phones (DevicesController);
  // locking, renaming and access hours stay admin-only.
  @Get('drivers')
  @Roles('ADMIN', 'USER')
  listDrivers(@CurrentOrg() organizationId: string) {
    return this.usersService.listDrivers(organizationId);
  }

  @Patch(':id/active')
  setActive(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: MemberActor,
    @Param('id') id: string,
    @Body() dto: SetActiveDto,
  ) {
    return this.usersService.setActive(organizationId, user, id, dto.active);
  }

  @Patch(':id/role')
  setRole(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: MemberActor,
    @Param('id') id: string,
    @Body() dto: SetRoleDto,
  ) {
    return this.usersService.setRole(organizationId, user, id, dto.role);
  }

  @Patch(':id/branch')
  @Roles('MASTER')
  setBranch(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: SetBranchDto,
  ) {
    return this.usersService.setBranch(organizationId, id, dto.branchId);
  }

  @Patch(':id/display-name')
  setDisplayName(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: MemberActor,
    @Param('id') id: string,
    @Body() dto: SetDisplayNameDto,
  ) {
    return this.usersService.setDisplayName(
      organizationId,
      user,
      id,
      dto.displayName ?? null,
    );
  }
}
