import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PurchaseOrderStatus, ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { PurchaseOrderService } from './purchase-order.service';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderDto } from './dto/purchase-order.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private purchaseOrderService: PurchaseOrderService) {}

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrderService.create(organizationId, req.user.sub, dto);
  }

@Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('status') status?: PurchaseOrderStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.purchaseOrderService.list(organizationId, {
      status,
      from,
      to,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  getOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.purchaseOrderService.getOne(organizationId, id);
  }

  @Patch(':id')
  update(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchaseOrderService.update(organizationId, id, req.user.sub, dto);
  }

  @Post(':id/send')
  send(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.purchaseOrderService.send(organizationId, id, req.user.sub);
  }

  @Post(':id/cancel')
  cancel(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.purchaseOrderService.cancel(organizationId, id, req.user.sub);
  }

  // ---- print / PDF — mirrors InvoiceController's equivalent routes ----

  @Get(':id/print-view')
  getPrintView(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.purchaseOrderService.getPrintView(organizationId, id);
  }

  @Get(':id/pdf')
  async getPdf(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.purchaseOrderService.renderPdf(organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="PO-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }
}