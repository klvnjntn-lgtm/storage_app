// src/customers/customers.controller.ts
import {
  Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ImportCustomersDto } from './dto/import-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from './dto/customer-address.dto';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { isAdminRole } from '../auth/roles';
import { filterBranchId } from '../auth/branch-scope';

// Customers are usable under INVOICE_POS, WORKSHOP_RMS or DELIVERY_DMS
// (a delivery-only org picks route stops from its customer list).
// (Previously hard-locked to INVOICE_POS only via @RequireModule; an
// org with WORKSHOP_RMS but not INVOICE_POS would have been rejected
// here, which contradicted the "either is fine" intent.)
//
// Note: WORKSHOP_RMS itself still requires INVOICE_POS to be active —
// that dependency is enforced separately in ModuleGuard/enableModule,
// not here. In practice, by the time an org has WORKSHOP_RMS active at
// all, INVOICE_POS is guaranteed active too — so this OR-gate mostly
// matters for INVOICE_POS-only orgs who never added WORKSHOP_RMS.
//
// Office staff only — a DRIVER sees a customer's directions and photos on
// their own route stops (DeliveryRoutesService), never the customer list.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
@Roles('ADMIN', 'USER')
@RequireModule(ModuleKey.INVOICE_POS, ModuleKey.WORKSHOP_RMS, ModuleKey.DELIVERY_DMS)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('pin') pin?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
  ) {
    const num = (v?: string) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);
    return this.customersService.list(organizationId, q, {
      page: page !== undefined ? (num(page) ?? 1) : undefined,
      pageSize: num(pageSize),
      limit: num(limit),
      pin,
      sort,
      dir,
    });
  }

  @Get(':id')
  findOne(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.customersService.getWithInvoices(organizationId, id, filterBranchId(req.user));
  }

  @Post()
  create(@CurrentOrg() organizationId: string, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(organizationId, dto);
  }

  // Spreadsheet import — rows parsed client-side, see ImportCustomersDto.
  // Deleting and bulk-importing customers is admin-only.
  @Roles('ADMIN')
  @Post('import')
  importMany(@CurrentOrg() organizationId: string, @Body() dto: ImportCustomersDto) {
    return this.customersService.importMany(organizationId, dto.rows);
  }

  @Patch(':id')
  update(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req,
  ) {
    // Clearing a location unlocks the pin for the next driver's GPS, so
    // only an admin may do it; anyone who can edit customers can move it.
    if ((dto.latitude === null || dto.longitude === null) && !isAdminRole(req.user?.role)) {
      throw new ForbiddenException("Only an administrator can clear a customer's location");
    }
    return this.customersService.update(organizationId, id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.customersService.remove(organizationId, id);
  }

  @Get(':id/addresses')
  listAddresses(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.customersService.listAddresses(organizationId, id);
  }

  @Post(':id/addresses')
  createAddress(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: CreateCustomerAddressDto,
  ) {
    return this.customersService.createAddress(organizationId, id, dto);
  }

  @Patch(':id/addresses/:addressId')
  updateAddress(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateCustomerAddressDto,
  ) {
    return this.customersService.updateAddress(organizationId, id, addressId, dto);
  }

  @Delete(':id/addresses/:addressId')
  removeAddress(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Param('addressId') addressId: string,
  ) {
    return this.customersService.removeAddress(organizationId, id, addressId);
  }
}