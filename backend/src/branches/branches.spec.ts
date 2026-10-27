import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { AccountingReportsService } from '../accounting/accounting-reports.service';
import { ExpensesModule } from '../accounting/expenses.module';
import { ExpensesService } from '../accounting/expenses.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { BranchesModule } from './branches.module';
import { BranchesService } from './branches.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Branches are what accounting splits by, independent of stock locations:
// a shop without WAREHOUSE_OPS keeps all its stock on CENTRE but still
// reports each branch's sales and costs. Against the isolated test DB.
describe('Branches', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let branches: BranchesService;
  let invoices: InvoiceService;
  let expenses: ExpensesService;
  let reports: AccountingReportsService;

  let orgId: string;
  let userId: string;
  let centreId: string;
  let productId: string;
  let main: string;
  let east: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, InvoiceModule, ExpensesModule, BranchesModule],
    }).compile();
    prisma = module.get(PrismaService);
    branches = module.get(BranchesService);
    invoices = module.get(InvoiceService);
    expenses = module.get(ExpensesService);
    reports = module.get(AccountingReportsService);

    orgId = (await prisma.organization.create({ data: { name: `Toko ${randomUUID().slice(0, 6)}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    userId = (
      await prisma.user.create({
        data: { email: `br-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;

    // The first listing makes the business's own branch.
    main = (await branches.list(orgId))[0].id;
    east = (await branches.create(orgId, { name: 'Cabang Timur' })).id;

    centreId = (
      await prisma.location.create({ data: { id: `${orgId}_centre`, name: 'CENTRE', organizationId: orgId, branchId: main } })
    ).id;
    const categoryId = (await prisma.category.create({ data: { name: 'Oil', organizationId: orgId } })).id;
    productId = (
      await prisma.product.create({
        data: {
          name: 'Oil 1L',
          sku: `OIL-${randomUUID().slice(0, 8)}`,
          categoryId,
          organizationId: orgId,
          sellingPrice: 100_000,
          costPrice: 60_000,
        },
      })
    ).id;
    await prisma.stock.create({ data: { productId, locationId: centreId, organizationId: orgId, quantity: 50 } });
  });

  afterAll(async () => {
    await module?.close();
  });

  async function sell(branchId: string | undefined, quantity: number) {
    const draft = await invoices.createDraft(orgId, userId, {
      format: 'A4',
      customerName: 'Walk-in',
      ...(branchId && { branchId }),
      items: [{ productId, locationId: centreId, quantity }],
    } as never);
    await invoices.issue(orgId, draft.id, userId, 'ADMIN');
    return draft.id;
  }

  it('gives every org one branch named after the business, and keeps the last one', async () => {
    const list = await branches.list(orgId);
    expect(list.map((b) => b.name)).toEqual([expect.stringMatching(/^Toko /), 'Cabang Timur']);
    const solo = (await prisma.organization.create({ data: { name: 'Solo' } })).id;
    const [only] = await branches.list(solo);
    await expect(branches.archive(solo, only.id)).rejects.toThrow('only branch');
  });

  it('books a sale to the branch that made it, wherever the stock came from', async () => {
    const id = await sell(east, 2);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(invoice.branchId).toBe(east);

    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntry: { organizationId: orgId, sourceId: { startsWith: id } } },
      select: { branchId: true, debit: true, credit: true },
    });
    // Revenue, COGS and the inventory it used: all the selling branch's.
    const tagged = lines.filter((l) => l.branchId != null);
    expect(tagged.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tagged.map((l) => l.branchId))).toEqual(new Set([east]));
  });

  it('defaults a sale to the stock location’s branch', async () => {
    const id = await sell(undefined, 1);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id } })).branchId).toBe(main);
  });

  it('splits the P&L by branch, with untagged costs shown apart', async () => {
    const categoryId = (await prisma.expenseCategory.create({ data: { organizationId: orgId, name: 'Rent' } })).id;
    const today = new Date().toISOString().slice(0, 10);
    await expenses.create(orgId, { categoryId, amount: 30_000, expenseDate: today, branchId: east } as never);
    await expenses.create(orgId, { categoryId, amount: 5_000, expenseDate: today } as never);

    const from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const eastPnl = await reports.getProfitAndLoss(orgId, from, to, east);
    expect(eastPnl.totalRevenue).toBe(200_000);
    expect(eastPnl.totalOperatingExpenses).toBe(30_000);
    expect(eastPnl.unallocated?.totalOperatingExpenses).toBe(5_000);

    const mainPnl = await reports.getProfitAndLoss(orgId, from, to, main);
    expect(mainPnl.totalRevenue).toBe(100_000);
  });

  it('refuses another org’s branch', async () => {
    const other = (await prisma.organization.create({ data: { name: 'Other' } })).id;
    const [foreign] = await branches.list(other);
    await expect(sell(foreign.id, 1)).rejects.toThrow('Branch not found');
  });
});
