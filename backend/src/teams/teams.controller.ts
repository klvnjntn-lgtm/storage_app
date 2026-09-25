// src/teams/teams.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { AssignDriverDto } from './dto/assign-driver.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.DELIVERY_DMS)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  list(@CurrentOrg() organizationId: string) {
    return this.teamsService.list(organizationId);
  }

  @Post()
  create(@CurrentOrg() organizationId: string, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(organizationId, dto);
  }

  @Patch(':id')
  rename(@CurrentOrg() organizationId: string, @Param('id') id: string, @Body() dto: CreateTeamDto) {
    return this.teamsService.rename(organizationId, id, dto.name);
  }

  @Delete(':id')
  remove(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.teamsService.remove(organizationId, id);
  }

  @Post(':id/drivers')
  assignDriver(@CurrentOrg() organizationId: string, @Param('id') teamId: string, @Body() dto: AssignDriverDto) {
    return this.teamsService.assignDriver(organizationId, teamId, dto.driverId);
  }

  @Delete('drivers/:driverId')
  unassignDriver(@CurrentOrg() organizationId: string, @Param('driverId') driverId: string) {
    return this.teamsService.unassignDriver(organizationId, driverId);
  }
}
