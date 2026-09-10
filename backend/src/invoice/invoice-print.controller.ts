import { Controller, Get, Param, Query, ForbiddenException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { Public } from '../auth/decorators/public.decorator';

@Public()
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