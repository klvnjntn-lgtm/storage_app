import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceFormat, InvoiceStatus, JournalEntryStatus, JournalSourceType, PaymentStatus, PurchaseOrderStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingModule } from './accounting.module';
import { AccountingReportsService } from './accounting-reports.service';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';
import { OpeningBalanceService } from './opening-balance.service';

jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Documents shaped like the Accurate import's — issued, never posted — get
// opening AR/AP that make both aging reports reconcile with the ledger.
describe('Opening balances for unposted documents', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let openings: OpeningBalanceService;
  let reports: AccountingReportsService;
  let orgId: string;
  let openInvoiceId: string;

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const endOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`);
  const postedOpenings = () =>
    prisma.journalEntry.findMany({
      where: { organizationId: orgId, sourceType: JournalSourceType.OPENING_BALANCE, status: JournalEntryStatus.POSTED },
    });

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, AccountingModule] }).compile();
    prisma = module.get(PrismaService);
    openings = module.get(OpeningBalanceService);
    reports = module.get(AccountingReportsService);

    orgId = (await prisma.organization.create({ data: { name: `Opening ${randomUUID()}`, timezone: 'UTC' } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);

    const issued = { organizationId: orgId, status: InvoiceStatus.ISSUED, format: InvoiceFormat.A4 };
    // Half paid in Accurate: 700k still owed.
    openInvoiceId = (
      await prisma.invoice.create({
        data: { ...issued, total: 1_000_000, amountPaid: 300_000, paymentStatus: PaymentStatus.PARTIAL, issuedAt: daysAgo(40) },
      })
    ).id;
    // Paid off, with a rounding remainder the aging ignores.
    await prisma.invoice.create({
      data: { ...issued, total: 500_000.9, amountPaid: 500_000, paymentStatus: PaymentStatus.PAID, issuedAt: daysAgo(20) },
    });
    // Mistyped into the future: left out until its date arrives.
    await prisma.invoice.create({
      data: { ...issued, total: 200_000, paymentStatus: PaymentStatus.UNPAID, issuedAt: new Date(Date.now() + 30 * 86_400_000) },
    });

    const supplierId = (await prisma.supplier.create({ data: { name: 'PT Imported', organizationId: orgId } })).id;
    const poId = (
      await prisma.purchaseOrder.create({
        data: { organizationId: orgId, supplierId, status: PurchaseOrderStatus.FULLY_RECEIVED, poNumber: `PO-${randomUUID().slice(0, 6)}` },
      })
    ).id;
    await prisma.supplierBill.create({
      data: { organizationId: orgId, purchaseOrderId: poId, billNumber: 'B-1', billDate: daysAgo(30), amount: 2_000_000, externalId: `t-${randomUUID()}` },
    });
    await prisma.supplierPayment.create({
      data: { organizationId: orgId, purchaseOrderId: poId, amount: 500_000, paidAt: daysAgo(10), externalId: `t-${randomUUID()}` },
    });
  });

  afterAll(async () => {
    await module?.close();
  });

  it('posts AR and AP so both aging reports reconcile', async () => {
    const result = await openings.sync(orgId);
    expect(result.AR).toMatchObject({ amount: 700_000, action: 'posted', futureDated: 1 });
    expect(result.AP).toMatchObject({ amount: 1_500_000, action: 'posted', futureDated: 0 });
    expect(result.AR.date).toBe(daysAgo(20).toISOString().slice(0, 10));

    const ar = await reports.getARAging(orgId, endOfToday());
    const ap = await reports.getAPAging(orgId, endOfToday());
    expect(ar.reconciliation).toMatchObject({ arLedgerBalance: 700_000, matches: true });
    expect(ap.reconciliation).toMatchObject({ apLedgerBalance: 1_500_000, matches: true });
  });

  it('leaves the entries alone when nothing changed, and replaces them when a re-import does', async () => {
    expect((await openings.sync(orgId)).AR.action).toBe('unchanged');

    // A re-import brought a later Accurate payment in.
    await prisma.invoice.update({ where: { id: openInvoiceId }, data: { amountPaid: 600_000 } });
    const result = await openings.sync(orgId);
    expect(result.AR).toMatchObject({ amount: 400_000, action: 'replaced' });
    expect(result.AP.action).toBe('unchanged');

    expect(await postedOpenings()).toHaveLength(2); // one per side, the old AR one voided
    const ar = await reports.getARAging(orgId, endOfToday());
    expect(ar.reconciliation).toMatchObject({ arLedgerBalance: 400_000, matches: true });
  });
});
