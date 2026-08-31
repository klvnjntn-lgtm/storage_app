import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoicePrintController } from './invoice-print.controller';
import { InvoiceService } from './invoice.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { StockModule } from 'src/stock/stock.module';
import { OrganizationModulesModule } from 'src/organization-module/organization-modules.module';
import { SessionsModule } from 'src/sessions/sessions.module';
import { SharedDocumentsModule } from 'src/shared/documents/shared-documents.module';
import { SalesQuotationModule } from 'src/sales-quotation/sales-quotation.module';
import { PrintModule } from 'src/common/print/print.module';

@Module({
  imports: [
    StockModule,
    PrismaModule,
    GuardsModule,
    SalesQuotationModule,
    SharedDocumentsModule,
    OrganizationModulesModule,
    SessionsModule,
    PrintModule,
  ],
  controllers: [InvoiceController, InvoicePrintController],
  providers: [InvoiceService],
})
export class InvoiceModule {}