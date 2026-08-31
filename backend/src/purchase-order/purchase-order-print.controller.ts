// src/purchase-order/purchase-order-print.controller.ts
import { Controller, Get, Param, Query, ForbiddenException } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';

// Deliberately NOT behind JwtAuthGuard/OrgGuard/ModuleGuard — the caller
// here is Puppeteer loading the print page, not an authenticated user.
// verifyPrintToken() is the auth for this route, not the guard stack.
// organizationId is read from the token payload, not supplied by the
// caller — mirrors InvoicePrintController exactly.
@Controller('print/purchase-orders')
export class PurchaseOrderPrintController {
  constructor(private purchaseOrderService: PurchaseOrderService) {}

  @Get(':id')
  async getPrintData(@Param('id') id: string, @Query('token') token: string) {
    if (!token) throw new ForbiddenException('Missing print token');

    const payload = this.purchaseOrderService.verifyPrintToken(token, id);
    return this.purchaseOrderService.getPrintView(payload.organizationId, id);
  }
}