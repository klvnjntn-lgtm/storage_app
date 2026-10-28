// src/location/location.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { LocationService } from './location.service';
import { RenameDto } from '../common/dto/rename.dto';
import { MergeDto } from '../common/dto/merge.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModuleKey } from '@prisma/client';

// Reading is open to every member: every org has at least its CENTRE
// location, which forms use without asking. Managing locations (adding,
// renaming, merging, deleting) is a WAREHOUSE_OPS feature — without it an
// org's stock all sits on CENTRE, which its users never see.
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('locations')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Get()
  findAll(@CurrentOrg() organizationId: string) {
    return this.locationService.findAll(organizationId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post()
  create(@CurrentOrg() organizationId: string, @Body('name') name: string) {
    return this.locationService.create(organizationId, name);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Patch(':id')
  rename(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ) {
    return this.locationService.rename(organizationId, id, dto.name);
  }

  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Patch(':id/branch')
  setBranch(@CurrentOrg() organizationId: string, @Param('id') id: string, @Body('branchId') branchId: string) {
    return this.locationService.setBranch(organizationId, id, branchId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post('merge')
  merge(@CurrentOrg() organizationId: string, @Body() dto: MergeDto) {
    return this.locationService.merge(organizationId, dto.sourceIds, dto.targetId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Delete(':id')
  delete(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.locationService.delete(organizationId, id);
  }
}