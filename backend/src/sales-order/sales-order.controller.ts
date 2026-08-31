import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ModuleKey, SalesOrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { SalesOrderService } from './sales-order.service';
import { CreateSalesOrderDto, UpdateSalesOrderDto } from './dto/sales-order.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('sales-orders')
export class SalesOrderController {
  constructor(private orderService: SalesOrderService) {}

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateSalesOrderDto) {
    return this.orderService.create(organizationId, req.user.sub, dto);
  }

  @Post('from-quotation/:quotationId')
  createFromQuotation(@CurrentOrg() organizationId: string, @Req() req, @Param('quotationId') quotationId: string) {
    return this.orderService.createFromQuotation(organizationId, req.user.sub, quotationId);
  }

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('status') status?: SalesOrderStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.orderService.list(organizationId, {
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  // Must come before @Get(':id') — otherwise Nest matches "print-view" as
  // the :id param and this route is unreachable. Same trap the invoice
  // controller's comments call out for /overdue-count and /statement.
  //
  // In-app preview of the print-shaped data — distinct from the raw
  // getOne(). Separate from PrintController's /print/sales-orders/:id,
  // which is the unguarded route Puppeteer actually hits during
  // renderPdf(); this one is for an authenticated "preview before
  // confirming" screen without minting a print token.
  @Get(':id/print-view')
  getPrintView(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.orderService.getPrintView(organizationId, id);
  }

  // Streams the rendered PDF rather than returning JSON, so this needs
  // @Res() directly — mirrors InvoiceController.downloadPdf /
  // SalesQuotationController.getPdf.
  @Get(':id/pdf')
  async getPdf(@CurrentOrg() organizationId: string, @Param('id') id: string, @Res() res: Response) {
    const buffer = await this.orderService.renderPdf(organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="sales-order-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Get(':id')
  getOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.orderService.getOne(organizationId, id);
  }

  @Get(':id/activity')
  getActivityHistory(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.orderService.getActivityHistory(organizationId, id);
  }

  @Patch(':id')
  update(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateSalesOrderDto,
  ) {
    return this.orderService.update(organizationId, id, req.user.sub, dto);
  }

  @Post(':id/confirm')
  confirm(@CurrentOrg() organizationId: string, @Req() req, @Param('id') id: string) {
    return this.orderService.confirm(organizationId, id, req.user.sub);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.orderService.cancel(organizationId, id, req.user.sub, reason);
  }
}