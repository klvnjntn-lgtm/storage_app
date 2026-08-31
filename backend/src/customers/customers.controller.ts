// src/customers/customers.controller.ts
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';

// Customers are usable under either plan — INVOICE_POS or WORKSHOP_RMS.
// (Previously hard-locked to INVOICE_POS only via @RequireModule; an
// org with WORKSHOP_RMS but not INVOICE_POS would have been rejected
// here, which contradicted the "either is fine" intent.)
//
// Note: WORKSHOP_RMS itself still requires INVOICE_POS to be active —
// that dependency is enforced separately in ModuleGuard/enableModule,
// not here. In practice, by the time an org has WORKSHOP_RMS active at
// all, INVOICE_POS is guaranteed active too — so this OR-gate mostly
// matters for INVOICE_POS-only orgs who never added WORKSHOP_RMS.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS, ModuleKey.WORKSHOP_RMS)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(@CurrentOrg() organizationId: string, @Query('q') q?: string) {
    return this.customersService.list(organizationId, q);
  }

  @Get(':id')
  findOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.customersService.getWithInvoices(organizationId, id);
  }

  @Post()
  create(@CurrentOrg() organizationId: string, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.customersService.remove(organizationId, id);
  }
}