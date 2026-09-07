import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, Res } from '@nestjs/common';
import { DeliveryOrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { DeliveryOrderService } from './delivery-order.service';
import { CreateDeliveryOrderDto } from './dto/delivery-order.dto';
import { RecordDeliveryOrderReturnDto } from './dto/delivery-order-return.dto';
import { RecordDeliveryOrderProofDto } from './dto/delivery-order-proof.dto'; // adjust path/name to your actual DTO
import type { Response } from 'express';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('delivery-orders')
export class DeliveryOrderController {
  constructor(private deliveryOrderService: DeliveryOrderService) {}

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateDeliveryOrderDto) {
    return this.deliveryOrderService.create(organizationId, req.user.sub, dto);
  }

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('salesOrderId') salesOrderId?: string,
    @Query('status') status?: DeliveryOrderStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.deliveryOrderService.list(organizationId, {
      salesOrderId, status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  getOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.deliveryOrderService.getOne(organizationId, id);
  }

  // Authenticated JSON print view — the browser fetches this to render
  // <DeliveryOrderA4Template> client-side. Distinct from the unguarded
  // print/delivery-orders/:id controller (Puppeteer, token-authed) and
  // from :id/pdf below (binary download).
  @Get(':id/print')
  getPrintView(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.deliveryOrderService.getPrintView(organizationId, id);
  }

  @Get(':id/pdf')
  async downloadPdf(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.deliveryOrderService.renderPdf(organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="delivery-order.pdf"',
    });
    res.send(pdf);
  }

  @Post(':id/ship')
  ship(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.deliveryOrderService.ship(organizationId, id, req.user.sub);
  }

  // Was implemented on the service but never wired up — the frontend's
  // "Save signature" button was 404ing the same way print was.
  @Patch(':id/proof-of-delivery')
  recordProofOfDelivery(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: RecordDeliveryOrderProofDto,
  ) {
    return this.deliveryOrderService.recordProofOfDelivery(organizationId, id, {
      deliveredBy: dto.deliveredBy,
      receivedBy: dto.receivedBy,
      signedAt: dto.signedAt ? new Date(dto.signedAt) : undefined,
    });
  }

  @Post(':id/return')
  recordReturn(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body() dto: RecordDeliveryOrderReturnDto,
  ) {
    return this.deliveryOrderService.recordReturn(organizationId, id, req.user.sub, dto.items, dto.reason);
  }

  @Post(':id/cancel')
  cancel(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.deliveryOrderService.cancel(organizationId, id, req.user.sub);
  }

  @Post('from-invoice/:invoiceId')
  createFromInvoice(@CurrentOrg() organizationId: string, @Param('invoiceId') invoiceId: string, @Req() req) {
    return this.deliveryOrderService.createFromInvoice(organizationId, req.user.sub, invoiceId);
  }
}