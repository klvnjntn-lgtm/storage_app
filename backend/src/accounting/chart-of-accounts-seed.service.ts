import { ConflictException, Injectable } from '@nestjs/common';
import { AccountType, NormalBalance, Prisma, SystemAccountKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type SeedAccount = {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  systemKey: SystemAccountKey;
};

// A minimal, sane starting Chart of Accounts. Every SystemAccountKey the
// posting rules can reference gets a row here, so a brand-new org can post
// documents immediately. Orgs can rename/reorganize codes freely afterward
// — posting rules follow systemKey, not code or name.
const DEFAULT_ACCOUNTS: SeedAccount[] = [
  { code: '1000', name: 'Cash on Hand', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.CASH },
  { code: '1010', name: 'Bank', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.BANK },
  { code: '1100', name: 'Accounts Receivable', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.ACCOUNTS_RECEIVABLE },
  { code: '1200', name: 'Inventory', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.INVENTORY },
  { code: '1300', name: 'Input VAT Receivable', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.PURCHASE_TAX_RECEIVABLE },
  { code: '2000', name: 'Accounts Payable', type: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.ACCOUNTS_PAYABLE },
  { code: '2100', name: 'Output VAT Payable', type: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.SALES_TAX_PAYABLE },
  { code: '2200', name: 'Payroll Payable', type: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.PAYROLL_PAYABLE },
  { code: '2210', name: 'Payroll Deductions Payable', type: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.PAYROLL_DEDUCTIONS_PAYABLE },
  { code: '2300', name: 'Expense Payable', type: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.EXPENSE_PAYABLE },
  { code: '3900', name: 'Retained Earnings', type: AccountType.EQUITY, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.RETAINED_EARNINGS },
  { code: '4000', name: 'Sales Revenue', type: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.SALES_REVENUE },
  { code: '5000', name: 'Cost of Goods Sold', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.COST_OF_GOODS_SOLD },
  { code: '6000', name: 'Salary Expense', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.SALARY_EXPENSE },
  { code: '6900', name: 'Uncategorized Expense', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.UNCATEGORIZED_EXPENSE },
  { code: '3100', name: 'Opening Balance Equity', type: AccountType.EQUITY, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.OPENING_BALANCE_EQUITY },
{ code: '5900', name: 'Inventory Adjustments', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.INVENTORY_ADJUSTMENT },
  { code: '1500', name: 'Fixed Assets', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.FIXED_ASSETS },
  { code: '1510', name: 'Accumulated Depreciation', type: AccountType.ASSET, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.ACCUMULATED_DEPRECIATION },
  { code: '2400', name: 'Fixed Asset Payable', type: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.FIXED_ASSET_PAYABLE },
  { code: '6100', name: 'Depreciation Expense', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.DEPRECIATION_EXPENSE },
  { code: '4900', name: 'Gain on Disposal of Assets', type: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.GAIN_ON_ASSET_DISPOSAL },
  { code: '6910', name: 'Loss on Disposal of Assets', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.LOSS_ON_ASSET_DISPOSAL },
];

@Injectable()
export class ChartOfAccountsSeedService {
  constructor(private prisma: PrismaService) {}

  async seedDefaults(organizationId: string) {
    const existing = await this.prisma.chartOfAccount.count({ where: { organizationId } });
    if (existing > 0) {
      throw new ConflictException('This organization already has a Chart of Accounts — seed only runs once');
    }

    try {
      return await this.prisma.chartOfAccount.createMany({
        data: DEFAULT_ACCOUNTS.map((a) => ({ ...a, organizationId })),
      });
    } catch (err) {
      // Two concurrent seed calls both passing the count()===0 check above
      // is unlikely for a one-time onboarding action, but not impossible —
      // fail with the same friendly message rather than a raw P2002.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This organization already has a Chart of Accounts — seed only runs once');
      }
      throw err;
    }
  }
}