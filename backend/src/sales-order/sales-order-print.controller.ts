import { Controller, Get, Param, Query, ForbiddenException } from '@nestjs/common';
import { SalesOrderService } from './sales-order.service';
import { Public } from '../auth/decorators/public.decorator';
import { SkipLicenseCheck } from '../license/decorators/skip-license-check.decorator';

// Deliberately NOT behind JwtAuthGuard/OrgGuard/ModuleGuard — same
// reasoning as InvoicePrintController/SalesQuotationPrintController.
// See verifyDocumentToken's doc comment in PrintTokenService for the
// trust model; organizationId comes from the verified token payload,
// never from the caller.
@Public()
@SkipLicenseCheck()
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