import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { WorkOrdersService } from './work-orders.service';
import { BranchRecord } from '../auth/guards/branch-record.guard';
import { bookingBranchId, filterBranchId } from '../auth/branch-scope';
import {
  AddWorkOrderLineDto,
  ApproveWorkOrderDto,
  CreateRecommendationDto,
  CreateWorkOrderDto,
  CreateWorkOrderInvoiceDto,
  SetWorkOrderStatusDto,
  UpdateWorkOrderDto,
} from './dto/work-order.dto';

// Job cards turn into invoices; a single WORKSHOP_RMS gate also makes
// ModuleGuard check its INVOICE_POS dependency.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.WORKSHOP_RMS)
@BranchRecord('workOrder')
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  // Readable by every member (unlike /organization/settings), so the nav
  // and vehicle pages can tell whether to offer work orders.
  @Get('config')
  config(@CurrentOrg() orgId: string) {
    return this.workOrders.config(orgId);
  }

  // Names only — /payroll/employees is admin-only since it carries pay.
  @Get('mechanics')
  mechanics(@CurrentOrg() orgId: string, @Req() req) {
    return this.workOrders.mechanics(orgId, filterBranchId(req.user));
  }

  @Get()
  list(
    @CurrentOrg() orgId: string,
    @Req() req,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('branchId') branchId?: string,
    @Query('mechanicId') mechanicId?: string,
  ) {
    return this.workOrders.list(orgId, {
      status,
      q,
      vehicleId,
      mechanicId,
      branchId: filterBranchId(req.user, branchId),
    });
  }

  @Get(':id/print')
  printView(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.workOrders.printView(orgId, id);
  }

  @Get(':id')
  getOne(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.workOrders.getOne(orgId, id);
  }

  @Post()
  create(@CurrentOrg() orgId: string, @Req() req, @Body() dto: CreateWorkOrderDto) {
    return this.workOrders.create(orgId, req.user.sub, { ...dto, branchId: bookingBranchId(req.user, dto.branchId) });
  }

  @Patch(':id')
  update(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string, @Body() dto: UpdateWorkOrderDto) {
    return this.workOrders.update(orgId, req.user.sub, id, { ...dto, branchId: bookingBranchId(req.user, dto.branchId) });
  }

  @Post(':id/items')
  addLine(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string, @Body() dto: AddWorkOrderLineDto) {
    return this.workOrders.addLine(orgId, req.user.sub, id, dto);
  }

  @Patch(':id/status')
  setStatus(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() dto: SetWorkOrderStatusDto) {
    return this.workOrders.setStatus(orgId, id, dto.status);
  }

  @Post(':id/approve')
  approve(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string, @Body() dto: ApproveWorkOrderDto) {
    return this.workOrders.approve(orgId, req.user.sub, id, dto.note);
  }

  // The customer approval link's secret; the page builds the URL.
  @Post(':id/approval-link')
  approvalLink(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.workOrders.approvalLink(orgId, id);
  }

  @Post(':id/recommendations')
  addRecommendation(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() dto: CreateRecommendationDto) {
    return this.workOrders.addRecommendation(orgId, id, dto);
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
