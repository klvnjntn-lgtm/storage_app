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

// No @RequireModule / @RequireAnyModule anywhere in this controller —
// intentional. Locations are core infrastructure, not gated behind
// INVOICE_POS / WORKSHOP_RMS. Any authenticated org member (or ADMIN,
// per-route below) can manage them regardless of module entitlements.
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
  @Post()
  create(@CurrentOrg() organizationId: string, @Body('name') name: string) {
    return this.locationService.create(organizationId, name);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id')
  rename(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ) {
    return this.locationService.rename(organizationId, id, dto.name);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('merge')
  merge(@CurrentOrg() organizationId: string, @Body() dto: MergeDto) {
    return this.locationService.merge(organizationId, dto.sourceIds, dto.targetId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  delete(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.locationService.delete(organizationId, id);
  }
}