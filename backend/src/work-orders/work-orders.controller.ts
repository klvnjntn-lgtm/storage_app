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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AddWorkOrderLineDto,
  CreateRecommendationDto,
  CreateWorkOrderDto,
  CreateWorkOrderFromQuotationDto,
  CreateWorkOrderInvoiceDto,
  OrderPartsDto,
  PartsArrivedDto,
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

  // The Mechanic account's screen (and staff may look too): jobs on the floor, read-only.
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER', 'MECHANIC')
  @Get('board')
  board(@CurrentOrg() orgId: string) {
    return this.workOrders.board(orgId);
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

  // A quotation (accepted by the customer or not) becomes a job; an additional quotation joins its
  // original's job.
  @Post('from-quotation/:quotationId')
  fromQuotation(
    @CurrentOrg() orgId: string,
    @Req() req,
    @Param('quotationId') quotationId: string,
    @Body() dto: CreateWorkOrderFromQuotationDto,
  ) {
    return this.workOrders.createFromQuotation(orgId, req.user.sub, quotationId, dto);
  }

  // What the job is short of and what's ordered for it.
  @Get(':id/parts')
  parts(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.workOrders.parts(orgId, id);
  }

  @Post(':id/parts-orders')
  orderParts(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string, @Body() dto: OrderPartsDto) {
    return this.workOrders.orderParts(orgId, req.user.sub, id, dto);
  }

  // Receiving goes through the purchase order's approval rules, so the caller's role is passed on.
  @Post(':id/parts-orders/:poId/arrived')
  partsArrived(
    @CurrentOrg() orgId: string,
    @Req() req,
    @Param('id') id: string,
    @Param('poId') poId: string,
    @Body() dto: PartsArrivedDto,
  ) {
    return this.workOrders.partsArrived(orgId, req.user.sub, req.user.role, id, poId, dto);
  }

  @Post(':id/parts-orders/:poId/cancel')
  cancelPartsOrder(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string, @Param('poId') poId: string) {
    return this.workOrders.cancelPartsOrder(orgId, req.user.sub, id, poId);
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
