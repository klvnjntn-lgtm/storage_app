import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WorkOrdersService } from './work-orders.service';

export class MechanicNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  branchId?: string | null;
}

// The mechanics written on the Mechanic account. Each is a Payroll employee marked isMechanic, and only
// these are offered when the front desk picks who does a job (work orders, invoices, the invoice filter).
// Listing is for every member (names only); changing it is an admin's. Needs the Workshop module, not the
// work-orders setting — invoices name the mechanic too.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
@RequireModule(ModuleKey.WORKSHOP_RMS)
@Controller('mechanics')
export class MechanicsController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Roles('ADMIN', 'USER')
  @Get()
  list(@CurrentOrg() orgId: string, @Query('includeArchived') includeArchived?: string) {
    return this.workOrders.listMechanics(orgId, includeArchived === 'true');
  }

  @Roles('ADMIN')
  @Post()
  add(@CurrentOrg() orgId: string, @Body() dto: MechanicNameDto) {
    return this.workOrders.addMechanic(orgId, dto.name, dto.branchId);
  }

  @Roles('ADMIN')
  @Patch(':id')
  rename(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() dto: MechanicNameDto) {
    return this.workOrders.renameMechanic(orgId, id, dto.name);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.workOrders.removeMechanic(orgId, id);
  }
}
