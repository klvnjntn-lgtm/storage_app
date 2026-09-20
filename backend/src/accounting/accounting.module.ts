import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { AccountResolverService } from './account-resolver.service';
import { JournalService } from './journal.service';
import { PostingRulesService } from './posting-rules.service';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { BankAccountGLLinkService } from './bank-account-gl-link.service';
import { AccountingReportsService } from './accounting-reports.service';
import { AccountingController } from './accounting.controller';
import { CashFlowService } from './cash-flow.service';

@Module({
  imports: [PrismaModule, GuardsModule, OrganizationModulesModule],
  controllers: [AccountingController],
  providers: [
    AccountResolverService,
    JournalService,
    CashFlowService,
    PostingRulesService,
    ChartOfAccountsSeedService,
    ChartOfAccountsService,
    BankAccountGLLinkService,
    AccountingReportsService,
  ],
  // PostingRulesService is what Invoice/Payment/Expense/Payroll modules
  // should import and call from their own services at the right lifecycle
  // point. BankAccountGLLinkService is what your bank-accounts module
  // needs to import to auto-link a new OrganizationBankAccount — it needs
  // its own export here since it lives in this module, not that one.
  exports: [
    JournalService,
    PostingRulesService,
    AccountResolverService,
    AccountingReportsService,
    BankAccountGLLinkService,
  ],
})
export class AccountingModule {}