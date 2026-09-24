// src/invoice/invoice.controller.ts
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Req, Query, BadRequestException, Res, UseGuards,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InvoiceService } from './invoice.service';
import {
  CreateDraftInvoiceDto,
  IssueInvoiceDto,
  ListInvoicesQueryDto,
  RecostInvoiceItemDto,
  RevenueReportQueryDto,
  TopReportQueryDto,
  UpdateDraftInvoiceDto,
} from './dto/invoice.dto';
import { OrgGuard } from '../auth/guards/org.guard';
import type { Response } from 'express';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { EditIssuedInvoiceDto } from './dto/edit-invoice.dto';
import { VoidInvoiceDto } from './dto/void-invoice.dto';
// Gated to INVOICE_POS only (not listed alongside WORKSHOP_RMS like
// Customers/Payments) — deliberate: invoices are the INVOICE_POS
// feature itself, and since WORKSHOP_RMS depends on INVOICE_POS being
// active, any WORKSHOP_RMS org already satisfies this gate transitively.
// Service line items (WORKSHOP_RMS-specific) get their own additional
// check inside InvoiceService.priceLines().
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('invoices')
export class InvoiceController {
  constructor(private invoiceService: InvoiceService) {}

  @Get()
  list(@CurrentOrg() organizationId: string, @Query() query: ListInvoicesQueryDto) {
    return this.invoiceService.list(organizationId, {
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? this.endOfDay(query.to) : undefined,
      locationId: query.locationId,
      customerId: query.customerId,
      dateField: query.dateField,
      page: query.page,
      pageSize: query.pageSize,
      paymentStatus: query.paymentStatus,
      overdue: query.overdue,
      search: query.search,
    });
  }

  private endOfDay(dateStr: string): Date {
    const d = new Date(dateStr);
    d.setUTCHours(23, 59, 59, 999);
    return d;
  }

  @Get('reports')
  getReports(@CurrentOrg() organizationId: string, @Query() query: RevenueReportQueryDto) {
    return this.invoiceService.getRevenueReport(
      organizationId,
      new Date(query.from),
      this.endOfDay(query.to),
      query.locationId,
    );
  }

  // Top customers / top products / top vehicles, for the Sales Insights
  // charts. Two segments ("reports/top"), so this never collides with the
  // single-segment @Get(':id') below regardless of declaration order.
  @Get('reports/top')
  getTopReport(
    @CurrentOrg() organizationId: string,
    @Query() query: TopReportQueryDto,
    @Query('vehicleId') vehicleId?: string | string[],
  ) {
    const vehicleIds = vehicleId ? (Array.isArray(vehicleId) ? vehicleId : [vehicleId]) : undefined;
    return this.invoiceService.getTopReport(
      organizationId,
      new Date(query.from),
      this.endOfDay(query.to),
      vehicleIds,
      query.limit,
    );
  }

  // Non-admin-safe: only the derived, POS-relevant behaviour (never the
  // raw org settings, which stay behind GET /organization/settings and
  // its RolesGuard). This is what the POS UI polls before/while building
  // a sale to decide whether to show a stock warning at all — the actual
  // enforcement still happens inside issue()'s transaction regardless of
  // what the client saw here.
  // Must come before @Get(':id') — same routing trap as overdue-count/
  // statement/:id/draft below.
  @Get('stock-policy')
  async getPosStockConfig(@CurrentOrg() organizationId: string) {
    return this.invoiceService.getPosStockConfig(organizationId);
  }

  // Must come before @Get(':id') — otherwise Nest matches "overdue-count"
  // as the :id param and this route is unreachable (same trap as
  // /statement and /:id/draft below).
  @Get('overdue-count')
  async getOverdueCount(@CurrentOrg() organizationId: string) {
    const count = await this.invoiceService.getOverdueCount(organizationId);
    return { count };
  }

  // Must come before @Get(':id') — otherwise Nest matches "statement"
  // as the :id param and this route is unreachable. (Previously placed
  // after :id in the file, which made it exactly that: unreachable.)
  @Get('statement')
  async getStatement(
    @CurrentOrg() organizationId: string,
    @Query('customerId') customerId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('vehicleId') vehicleId?: string | string[],
  ) {
    const vehicleIds = vehicleId ? (Array.isArray(vehicleId) ? vehicleId : [vehicleId]) : undefined;
    return this.invoiceService.getCustomerStatement(
      organizationId, customerId, new Date(from), this.endOfDay(to), vehicleIds,
    );
  }

  // Must come before @Get(':id') below — otherwise Nest would try to match
  // "draft" as the :id param on that route instead. Returns the raw
  // nested invoice (real productId/taxRateId, not the flattened print
  // view) — see InvoiceService.getDraftDetail() for why these two routes
  // can't share a handler.
  @Get(':id/draft')
  getDraftDetail(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.invoiceService.getDraftDetail(organizationId, id);
  }

  @Get(':id/edit-detail')
  getEditDetail(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.invoiceService.getIssuedInvoiceEditDetail(organizationId, id);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/edit')
  editIssuedInvoice(
    @Req() req,
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() dto: EditIssuedInvoiceDto,
  ) {
    const { sub: userId } = req.user;
    return this.invoiceService.editIssuedInvoice(orgId, id, dto, userId);
  }

  // Corrects a line's provisional cost (booked while it oversold) once the
  // real cost is known — e.g. after a goods receipt updates Product.costPrice.
  // Posts a correcting COGS/Inventory journal entry for the delta rather than
  // reposting the whole line, so this never double-counts.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/items/:itemId/recost')
  recostInvoiceItem(
    @Req() req,
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: RecostInvoiceItemDto,
  ) {
    return this.invoiceService.recostInvoiceItem(organizationId, id, Number(itemId), dto.unitCost, req.user.sub);
  }

  @Get(':id/edit-history')
  getEditHistory(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.invoiceService.getEditHistory(orgId, id);
  }

  @Get(':id')
  getOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.invoiceService.getOne(organizationId, id);
  }

  // Streams a rendered PDF rather than returning JSON, so this needs @Res()
  // directly — Nest's normal return-value response handling assumes JSON.
  // ?format= lets the frontend's format toggle (58mm/80mm/A5/A4) override
  // what's printed without touching the invoice's stored format.
  @Get(':id/pdf')
  async downloadPdf(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    const pdf = await this.invoiceService.renderPdf(organizationId, id, format);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="invoice.pdf"',
    });
    res.send(pdf);
  }

  @Post()
  createDraft(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateDraftInvoiceDto) {
    return this.invoiceService.createDraft(
      organizationId,
      req.user.sub,
      dto,
    );
  }

  // NEW — createDraftFromQuotation() already existed on the service
  // (copies items/customer from a SENT or ACCEPTED quotation, sets
  // quotationId, calls quotationService.markConvertedToInvoice) but had
  // no route, so the frontend's "Convert to Invoice" button 404'd.
  // Mirrors SalesOrderController's from-quotation/:quotationId pattern.
  @Post('from-quotation/:quotationId')
  createFromQuotation(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('quotationId') quotationId: string,
  ) {
    return this.invoiceService.createDraftFromQuotation(organizationId, req.user.sub, quotationId);
  }

  @Patch(':id')
  updateDraft(@CurrentOrg() organizationId: string, @Param('id') id: string, @Body() dto: UpdateDraftInvoiceDto) {
    return this.invoiceService.updateDraft(organizationId, id, dto);
  }

  // NOTE: discardDraft's signature grew a userId param (needed so
  // reopenIfConverted can log the ACCEPTED activity event on the linked
  // quotation, if any) — req.user.sub now gets passed through.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  discard(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.invoiceService.discardDraft(organizationId, id, req.user.sub);
  }

@Post(':id/print')
print(
  @CurrentOrg() organizationId: string,
  @Req() req,
  @Param('id') id: string,
  @Body() dto: IssueInvoiceDto,
) {
  return this.invoiceService.issue(organizationId, id, req.user.sub, req.user.role, !!dto?.confirmOversell);
}

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/void')
  async voidInvoice(
    @Param('id') id: string,
    @Body() dto: VoidInvoiceDto,
    @CurrentOrg() organizationId: string,
    @Req() req,
  ) {
    return this.invoiceService.voidInvoice(
      organizationId,
      id,
      dto.reason,
      req.user.sub,
    );
  }
  @Post('from-order/:orderId')
createFromSalesOrder(
  @CurrentOrg() organizationId: string,
  @Req() req,
  @Param('orderId') orderId: string,
) {
  return this.invoiceService.createDraftFromSalesOrder(organizationId, req.user.sub, orderId);
}
}