import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const WHOLE_BUSINESS = '';
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const twelve = () => Array.from({ length: 12 }, () => 0);

// Monthly budgets per revenue and expense account, set against what the ledger
// actually shows. A branch has its own budget, separate from the whole
// business's, and is compared with the ledger lines booked to that branch: the
// same rule as the branch P&L.
@Injectable()
export class BudgetService {
  constructor(private prisma: PrismaService) {}

  private async assertBranch(organizationId: string, branchId?: string) {
    if (!branchId) return;
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId }, select: { id: true } });
    if (!branch) throw new BadRequestException('Branch not found');
  }

  private assertYear(year: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('year is not valid');
  }

  async get(organizationId: string, year: number, branchId?: string) {
    this.assertYear(year);
    await this.assertBranch(organizationId, branchId);

    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { organizationId, type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, type: true, isActive: true },
    });
    const budgets = await this.prisma.accountBudget.findMany({
      where: { organizationId, year, scope: branchId ?? WHOLE_BUSINESS },
      select: { accountId: true, month: true, amount: true },
    });
    const branchFilter = branchId ? Prisma.sql`AND l."branchId" = ${branchId}` : Prisma.empty;
    const actuals = await this.prisma.$queryRaw<{ accountId: string; month: number; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
      SELECT l."accountId", EXTRACT(MONTH FROM e."entryDate")::int AS month,
             SUM(l.debit) AS debit, SUM(l.credit) AS credit
      FROM "JournalEntryLine" l
      JOIN "JournalEntry" e ON e.id = l."journalEntryId"
      WHERE e."organizationId" = ${organizationId}
        AND e.status = 'POSTED'
        AND e."entryDate" >= ${new Date(Date.UTC(year, 0, 1))}
        AND e."entryDate" <= ${new Date(Date.UTC(year, 11, 31))}
        ${branchFilter}
      GROUP BY 1, 2`;

    const budgetBy = new Map(accounts.map((a) => [a.id, twelve()]));
    for (const b of budgets) {
      const row = budgetBy.get(b.accountId);
      if (row) row[b.month - 1] = Number(b.amount);
    }
    const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
    const actualBy = new Map(accounts.map((a) => [a.id, twelve()]));
    for (const a of actuals) {
      const row = actualBy.get(a.accountId);
      if (!row) continue;
      const net = Number(a.debit) - Number(a.credit);
      row[a.month - 1] = round2(typeOf.get(a.accountId) === AccountType.REVENUE ? -net : net);
    }

    return {
      year,
      branchId: branchId ?? null,
      // An archived account stays only if it has figures to show this year.
      accounts: accounts
        .map((a) => ({ ...a, budget: budgetBy.get(a.id)!, actual: actualBy.get(a.id)! }))
        .filter((a) => a.isActive || a.budget.some(Boolean) || a.actual.some(Boolean)),
    };
  }

  async save(
    organizationId: string,
    year: number,
    branchId: string | undefined,
    rows: { accountId: string; budget: number[] }[],
  ) {
    this.assertYear(year);
    await this.assertBranch(organizationId, branchId);
    const scope = branchId ?? WHOLE_BUSINESS;

    const ids = rows.map((r) => r.accountId);
    const valid = await this.prisma.chartOfAccount.count({
      where: { organizationId, id: { in: ids }, type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } },
    });
    if (valid !== new Set(ids).size) throw new BadRequestException('A budget can only be set on a revenue or expense account');
    for (const row of rows) {
      if (row.budget.length !== 12 || row.budget.some((v) => !Number.isFinite(v) || v < 0)) {
        throw new BadRequestException('A budget needs 12 monthly amounts of zero or more');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.accountBudget.deleteMany({ where: { organizationId, year, scope, accountId: { in: ids } } });
      // Zero means no budget, so it isn't stored.
      await tx.accountBudget.createMany({
        data: rows.flatMap((row) =>
          row.budget.flatMap((amount, i) =>
            amount > 0 ? [{ organizationId, accountId: row.accountId, year, month: i + 1, scope, amount: round2(amount) }] : [],
          ),
        ),
      });
    });
    return this.get(organizationId, year, branchId);
  }
}
