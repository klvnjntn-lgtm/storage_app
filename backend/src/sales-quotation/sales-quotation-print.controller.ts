import { Controller, Get, Param, Query, ForbiddenException } from '@nestjs/common';
import { SalesQuotationService } from './sales-quotation.service';

// Deliberately NOT behind JwtAuthGuard/OrgGuard/ModuleGuard — same
// reasoning as InvoicePrintController. See verifyDocumentToken's doc
// comment in PrintTokenService for the trust model.
@Controller('print/quotations')
export class SalesQuotationPrintController {
  constructor(private quotationService: SalesQuotationService) {}

  @Get(':id')
  async getPrintData(@Param('id') id: string, @Query('token') token: string) {
    if (!token) throw new ForbiddenException('Missing print token');

    const payload = this.quotationService.verifyPrintToken(token, id);
    return this.quotationService.getPrintView(payload.organizationId, id);
  }
}