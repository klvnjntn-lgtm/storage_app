// src/delivery-order/delivery-order-print.controller.ts
import { Controller, Get, Param, Query, ForbiddenException } from '@nestjs/common';
import { DeliveryOrderService } from './delivery-order.service';
import { Public } from '../auth/decorators/public.decorator';
import { SkipLicenseCheck } from '../license/decorators/skip-license-check.decorator';

// Deliberately NOT behind JwtAuthGuard/OrgGuard — same reasoning as
// InvoicePrintController: the caller is Puppeteer, not an authenticated
// user. verifyPrintToken() is the auth for this route.
@Public()
@SkipLicenseCheck()
@Controller('print/delivery-orders')
export class DeliveryOrderPrintController {
  constructor(private deliveryOrderService: DeliveryOrderService) {}

  @Get(':id')
  async getPrintData(
    @Param('id') id: string,
    @Query('token') token: string,
  ) {
    if (!token) throw new ForbiddenException('Missing print token');
    const payload = this.deliveryOrderService.verifyPrintToken(token, id);
    return this.deliveryOrderService.getPrintView(payload.organizationId, id);
  }
}