import { Controller, Get, Param, Query, ForbiddenException } from '@nestjs/common';
import { SalesOrderService } from './sales-order.service';

// Deliberately NOT behind JwtAuthGuard/OrgGuard/ModuleGuard — same
// reasoning as InvoicePrintController/SalesQuotationPrintController.
// See verifyDocumentToken's doc comment in PrintTokenService for the
// trust model; organizationId comes from the verified token payload,
// never from the caller.
@Controller('print/sales-orders')
export class SalesOrderPrintController {
  constructor(private orderService: SalesOrderService) {}

  @Get(':id')
  async getPrintData(@Param('id') id: string, @Query('token') token: string) {
    if (!token) throw new ForbiddenException('Missing print token');

    const payload = this.orderService.verifyPrintToken(token, id);
    return this.orderService.getPrintView(payload.organizationId, id);
  }
}