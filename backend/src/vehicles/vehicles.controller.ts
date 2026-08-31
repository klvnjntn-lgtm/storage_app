import {
  Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, Query
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';

// Gated on WORKSHOP_RMS only, same pattern as CustomersController's
// INVOICE_POS gate — an org can have INVOICE_POS without WORKSHOP_RMS
// (customers, no vehicles), or both (customers + vehicles + per-vehicle
// invoices), but never WORKSHOP_RMS alone since vehicles hang off customers.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.WORKSHOP_RMS)
@Controller()
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

// vehicles.controller.ts — add the route (and import Query from '@nestjs/common'):
@Get('vehicles')
listAll(@CurrentOrg() orgId: string, @Query('q') q?: string) {
  return this.vehiclesService.listAll(orgId, q);
}
  @Post('customers/:customerId/vehicles')
  create(
    @CurrentOrg() orgId: string,
    @Param('customerId') customerId: string,
    @Body() dto: CreateVehicleDto,
  ) {
    return this.vehiclesService.create(orgId, customerId, dto);
  }

  @Get('vehicles/:id')
  findOne(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.vehiclesService.getWithInvoices(orgId, id);
  }

  @Patch('vehicles/:id')
  update(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehiclesService.update(orgId, id, dto);
  }

  @Delete('vehicles/:id')
  remove(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.vehiclesService.remove(orgId, id);
  }
}