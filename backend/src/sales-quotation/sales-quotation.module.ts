import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { SalesQuotationService } from './sales-quotation.service';
import { SalesQuotationController } from './sales-quotation.controller';
import { SalesQuotationPrintController } from './sales-quotation-print.controller';
import { PrintModule } from 'src/common/print/print.module';

@Module({
  imports: [PrismaModule, SharedDocumentsModule, PrintModule],
  controllers: [SalesQuotationController, SalesQuotationPrintController],
  providers: [SalesQuotationService],
  exports: [SalesQuotationService],
})
export class SalesQuotationModule {}