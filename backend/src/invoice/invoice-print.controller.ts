// src/invoice/invoice-print.controller.ts
import { Controller, Get, Param, Query, ForbiddenException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { Public } from '../auth/decorators/public.decorator';
import { SkipLicenseCheck } from '../license/decorators/skip-license-check.decorator';
import { PrintTemplatesService } from '../print-templates/print-templates.service';

const DESIGNABLE_FORMATS = ['A4', 'A5'];

@Public()
@SkipLicenseCheck()
@Controller('print/invoices')
export class InvoicePrintController {
  constructor(
    private invoiceService: InvoiceService,
    private printTemplates: PrintTemplatesService,
  ) {}

  @Get(':id')
  async getPrintData(
    @Param('id') id: string,
    @Query('token') token: string,
    @Query('format') format: string | undefined,
    @Query('templateId') templateId: string | undefined,
  ) {
    if (!token) throw new ForbiddenException('Missing print token');
    const payload = this.invoiceService.verifyPrintToken(token, id);
    const invoice = await this.invoiceService.getOne(payload.organizationId, id);
    const paper = format ?? invoice.format;
    // Receipts keep their fixed layout unless a design was picked by name.
    const printTemplate =
      DESIGNABLE_FORMATS.includes(paper) || templateId
        ? await this.printTemplates.resolve(payload.organizationId, 'INVOICE', invoice.branchId, [paper], templateId)
        : null;
    return { ...invoice, ...(format && { format }), printTemplate };
  }
}
