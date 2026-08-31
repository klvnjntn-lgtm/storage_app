import { Controller, Get, Param, Query, ForbiddenException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';

// Deliberately NOT behind JwtAuthGuard/OrgGuard/ModuleGuard — the caller
// here is Puppeteer loading the print page, not an authenticated user.
// verifyPrintToken() (→ PrintTokenService.verifyDocumentToken) is the
// auth for this route, not the guard stack. organizationId is read from
// the token payload, not supplied by the caller — see verifyDocumentToken's
// doc comment for why that's safe.
@Controller('print/invoices')
export class InvoicePrintController {
  constructor(private invoiceService: InvoiceService) {}

  @Get(':id')
  async getPrintData(
    @Param('id') id: string,
    @Query('token') token: string,
    @Query('format') format: string | undefined,
  ) {
    if (!token) throw new ForbiddenException('Missing print token');

    const payload = this.invoiceService.verifyPrintToken(token, id);
    const invoice = await this.invoiceService.getOne(payload.organizationId, id);
    return format ? { ...invoice, format } : invoice;
  }
}