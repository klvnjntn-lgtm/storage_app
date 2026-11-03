import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceFormat, JournalSourceType, PaymentMethod, SystemAccountKey } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { PaymentsModule } from '../payments/payment.module';
import { PaymentService } from '../payments/payment.service';
import { AccountingModule } from './accounting.module';
import { AccountingReportsService } from './accounting-reports.service';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';
import { JournalService } from './journal.service';
import { orgToday } from './business-date';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering, which
// these tests never exercise.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

describe('orgToday', () => {
  afterEach(() => jest.useRealTimers());

  it("is the business date, not the UTC one, before 07:00 in Jakarta", async () => {
    // 06:30 on 4 Nov in Jakarta is still 3 Nov in UTC.
    jest.useFakeTimers({ now: new Date('2026-11-03T23:30:00Z') });
    const client = { organization: { findUnique: async () => ({ timezone: 'Asia/Jakarta' }) } };
    expect((await orgToday(client, 'org')).toISOString().slice(0, 10)).toBe('2026-11-04');
  });
});

// Runs against the isolated test DB (see test/setup-test-env.ts) in a fresh org.
describe('Sales dates and the ledger (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoiceService;
  let payments: PaymentService;
  let journal: JournalService;
  let reports: AccountingReportsService;

  let orgId: string;
  let userId: string;
  let locationId: string;
  let productId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, AccountingModule, InvoiceModule, PaymentsModule],
    }).compile();
    prisma = module.get(PrismaService);
    invoices = module.get(InvoiceService);
    payments = module.get(PaymentService);
    journal = module.get(JournalService);
    reports = module.get(AccountingReportsService);

    orgId = (await prisma.organization.create({ data: { name: `Dates ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    userId = (
      await prisma.user.create({
        data: { email: `dates-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    locationId = (await prisma.location.create({ data: { name: 'Main', organizationId: orgId } })).id;
    const category = await prisma.category.create({ data: { name: 'General', organizationId: orgId } });
    productId = (
      await prisma.product.create({
        data: {
          name: 'Oil',
          sku: `OIL-${randomUUID().slice(0, 8)}`,
          categoryId: category.id,
          organizationId: orgId,
          sellingPrice: 100_000,
          costPrice: 60_000,
        },
      })
    ).id;
    await prisma.stock.create({ data: { productId, locationId, organizationId: orgId, quantity: 50 } });
  });

  afterAll(async () => {
    await module?.close();
  });

  const draft = (invoiceDate?: string) =>
    invoices.createDraft(orgId, userId, {
      locationId,
      format: InvoiceFormat.A4,
      customerName: 'Walk-in',
      ...(invoiceDate && { invoiceDate }),
      items: [{ productId, locationId, quantity: 1 }],
    } as any);

  const isoDay = (d: Date) => d.toISOString().slice(0, 10);

  it('dates a blank-dated invoice with the business date it is issued on', async () => {
    const d = await draft();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: d.id } })).invoiceDate).toBeNull();
    await invoices.issue(orgId, d.id, userId, 'ADMIN');
    const issued = await prisma.invoice.findUniqueOrThrow({ where: { id: d.id } });
    expect(isoDay(issued.invoiceDate!)).toBe(isoDay(await orgToday(prisma, orgId)));
  });

  it('books the cost of a backdated invoice in the same month as its revenue', async () => {
    const today = await orgToday(prisma, orgId);
    const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15));
    const d = await draft(isoDay(lastMonth));
    await invoices.issue(orgId, d.id, userId, 'ADMIN');

    const [revenue, cogs] = await Promise.all([
      journal.findPostedBySource(orgId, JournalSourceType.INVOICE, d.id),
      journal.findPostedBySource(orgId, JournalSourceType.INVOICE, `${d.id}:cogs:issue`),
    ]);
    expect(isoDay(revenue!.entryDate)).toBe(isoDay(lastMonth));
    expect(isoDay(cogs!.entryDate)).toBe(isoDay(lastMonth));
  });

  it('numbers journal entries posted at the same moment without a clash', async () => {
    const [cash, revenue] = await Promise.all(
      [SystemAccountKey.CASH, SystemAccountKey.SALES_REVENUE].map(async (systemKey) =>
        (
          await prisma.chartOfAccount.findUniqueOrThrow({
            where: { organizationId_systemKey: { organizationId: orgId, systemKey } },
          })
        ).id,
      ),
    );
    const post = () =>
      journal.postEntry(orgId, {
        date: new Date(),
        memo: 'Concurrent',
        sourceType: JournalSourceType.MANUAL,
        lines: [
          { accountId: cash, debit: 1_000 },
          { accountId: revenue, credit: 1_000 },
        ],
      });

    const entries = await Promise.all(Array.from({ length: 6 }, post));
    expect(new Set(entries.map((e) => e.entryNumber)).size).toBe(6);

    // A month numbered before the counter existed carries on from its count.
    await prisma.documentCounter.deleteMany({ where: { organizationId: orgId, documentType: { startsWith: 'JOURNAL_ENTRY_' } } });
    const total = await prisma.journalEntry.count({ where: { organizationId: orgId, fiscalPeriodId: entries[0].fiscalPeriodId } });
    const next = await post();
    expect(next.entryNumber).toMatch(new RegExp(`-${String(total + 1).padStart(4, '0')}$`));
  });

  it('ages an invoice as still owed on a date before it was paid', async () => {
    const d = await draft();
    await invoices.issue(orgId, d.id, userId, 'ADMIN');
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    await prisma.invoice.update({ where: { id: d.id }, data: { issuedAt: tenDaysAgo, invoiceDate: tenDaysAgo } });
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: d.id } });
    await payments.recordPayment(orgId, d.id, { amount: Number(inv.total), method: PaymentMethod.CASH } as any, userId);

    const before = await reports.getARAging(orgId, new Date(Date.now() - 3 * 86_400_000));
    expect(before.lines.find((l) => l.invoiceId === d.id)?.outstanding).toBe(Number(inv.total));

    const now = await reports.getARAging(orgId, new Date());
    expect(now.lines.some((l) => l.invoiceId === d.id)).toBe(false);
  });
});
