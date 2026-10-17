import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { WorkOrdersService } from './work-orders.service';
import {
  CreateWorkOrderDto,
  CreateWorkOrderInvoiceDto,
  SetWorkOrderStatusDto,
  UpdateWorkOrderDto,
} from './dto/work-order.dto';

// Job cards turn into invoices; a single WORKSHOP_RMS gate also makes
// ModuleGuard check its INVOICE_POS dependency.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.WORKSHOP_RMS)
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  // Readable by every member (unlike /organization/settings), so the nav
  // and vehicle pages can tell whether to offer work orders.
  @Get('config')
  async config(@CurrentOrg() orgId: string) {
    return { enabled: await this.workOrders.isEnabled(orgId) };
  }

  // Names only — /payroll/employees is admin-only since it carries pay.
  @Get('mechanics')
  mechanics(@CurrentOrg() orgId: string) {
    return this.workOrders.mechanics(orgId);
  }

  @Get()
  list(
    @CurrentOrg() orgId: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.workOrders.list(orgId, { status, q, vehicleId });
  }

  @Get(':id')
  getOne(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.workOrders.getOne(orgId, id);
  }

  @Post()
  create(@CurrentOrg() orgId: string, @Req() req, @Body() dto: CreateWorkOrderDto) {
    return this.workOrders.create(orgId, req.user.sub, dto);
  }

  @Patch(':id')
  update(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string, @Body() dto: UpdateWorkOrderDto) {
    return this.workOrders.update(orgId, req.user.sub, id, dto);
  }

  @Patch(':id/status')
  setStatus(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() dto: SetWorkOrderStatusDto) {
    return this.workOrders.setStatus(orgId, id, dto.status);
  }

  @Post(':id/invoice')
  createInvoice(
    @CurrentOrg() orgId: string,
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CreateWorkOrderInvoiceDto,
  ) {
    return this.workOrders.createInvoice(orgId, req.user.sub, id, dto.format);
  }
}
