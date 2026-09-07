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

  @Get('vehicles')
  listAll(@CurrentOrg() orgId: string, @Query('q') q?: string) {
    return this.vehiclesService.listAll(orgId, q);
  }

  // ── Vehicle Lookup (/vehicles/search) ─────────────────────────────────
  // MUST stay declared above @Get('vehicles/:id') below — these are flat
  // string paths, not nested under @Controller('vehicles'), so Nest/Express
  // matches them in declaration order. If 'vehicles/:id' comes first, a
  // request to /vehicles/search matches it with id="search" instead.

  @Get('vehicles/search')
  search(@CurrentOrg() orgId: string, @Query('q') q = '') {
    return this.vehiclesService.search(orgId, q);
  }

  @Get('vehicles/lookup')
  lookup(@CurrentOrg() orgId: string, @Query('q') q = '') {
    return this.vehiclesService.findByExactPlate(orgId, q);
  }

  @Get('vehicles/:id/summary')
  summary(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.vehiclesService.getSummary(orgId, id);
  }

  @Get('vehicles/:id/history')
  history(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.vehiclesService.getHistory(
      orgId,
      id,
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
    );
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

  @Get('customers/:customerId/vehicles')
  listByCustomer(
    @CurrentOrg() orgId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.vehiclesService.listByCustomer(orgId, customerId);
  }
}