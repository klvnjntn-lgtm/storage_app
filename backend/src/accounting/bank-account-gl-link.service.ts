import { Injectable } from '@nestjs/common';
import { AccountType, NormalBalance, Prisma, SystemAccountKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

type BankAccountInput = {
  id: string;
  bankName: string;
  accountNumber: string;
};

// Call ensureLinkedAccount() right after creating an OrganizationBankAccount
// row, in the SAME transaction if the creation is itself transactional —
// e.g.:
//
//   const bankAccount = await tx.organizationBankAccount.create({ data: {...} });
//   await this.bankAccountGLLink.ensureLinkedAccount(organizationId, bankAccount, tx);
//
// Without this call, a new bank account has nowhere to post to — any
// Payment/Expense/SupplierPayment/Payroll naming it will fail at
// PostingRulesService's resolution step with a clear "no linked GL
// account" error rather than silently posting somewhere wrong, but the
// fix is still to call this, not to catch that error after the fact.
@Injectable()
export class BankAccountGLLinkService {
  constructor(private prisma: PrismaService) {}

  async ensureLinkedAccount(organizationId: string, bankAccount: BankAccountInput, tx?: Prisma.TransactionClient) {
    const db: Db = tx ?? this.prisma;

    const existing = await db.chartOfAccount.findUnique({ where: { bankAccountId: bankAccount.id } });
    if (existing) return existing; // idempotent — safe to call more than once for the same bank account

    // Nested under the generic "Bank" (systemKey BANK) account rather than
    // flat in the chart — 1010 becomes a parent grouping ("Bank") once any
    // real bank accounts exist, with 1010.1, 1010.2, ... as the actual
    // postable accounts. If a org never adds a specific bank account, 1010
    // itself stays directly postable (CASH-only orgs, or before any bank
    // account is linked) — this doesn't retroactively block that.
    const parent = await db.chartOfAccount.findUnique({
      where: { organizationId_systemKey: { organizationId, systemKey: SystemAccountKey.BANK } },
    });

    const siblingCount = await db.chartOfAccount.count({
      where: { organizationId, bankAccountId: { not: null } },
    });
    const code = parent ? `${parent.code}.${siblingCount + 1}` : `1010.${siblingCount + 1}`;

    const last4 = bankAccount.accountNumber ? bankAccount.accountNumber.slice(-4) : null;
    const name = last4 ? `${bankAccount.bankName} •••${last4}` : bankAccount.bankName;

    return db.chartOfAccount.create({
      data: {
        organizationId,
        code,
        name,
        type: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        parentId: parent?.id,
        bankAccountId: bankAccount.id,
      },
    });
  }
}