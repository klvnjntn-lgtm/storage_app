import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoicePrintController } from './invoice-print.controller';
import { InvoiceNumberingController } from './invoice-numbering.controller';
import { InvoiceService } from './invoice.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { StockModule } from 'src/stock/stock.module';
import { OrganizationModulesModule } from 'src/organization-module/organization-modules.module';
import { SessionsModule } from 'src/sessions/sessions.module';
import { SharedDocumentsModule } from 'src/shared/documents/shared-documents.module';
import { SalesQuotationModule } from 'src/sales-quotation/sales-quotation.module';
import { PrintModule } from 'src/common/print/print.module';
import { BankAccountResolverService } from 'src/bank-accounts/bank-account-resolver.service';
import { AccountingModule } from 'src/accounting/accounting.module';
import { PlanLimitsModule } from '../billing/plan-limits.module';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [
    StockModule,
    PrismaModule,
    GuardsModule,
    SalesQuotationModule,
    AccountingModule,
    SharedDocumentsModule,
    OrganizationModulesModule,
    SessionsModule,
    PrintModule,
    PlanLimitsModule,
    ApprovalsModule,
  ],
  controllers: [InvoiceController, InvoicePrintController, InvoiceNumberingController],
  providers: [InvoiceService, BankAccountResolverService],
  exports: [InvoiceService],
})
export class InvoiceModule {}