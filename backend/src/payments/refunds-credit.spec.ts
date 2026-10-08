import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  InvoiceFormat,
  JournalEntryStatus,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  SessionType,
  SystemAccountKey,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { PaymentsModule } from './payment.module';
import { PaymentService } from './payment.service';
import { SessionsService } from '../sessions/sessions.service';
import { AccountingReportsService } from '../accounting/accounting-reports.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Customer credit (a return against a paid invoice) being refunded or
// applied to another invoice, against the isolated test DB.
describe('Refunds and customer credit', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoiceService;
  let payments: PaymentService;
  let sessions: SessionsService;
  let reports: AccountingReportsService;

  let orgId: string;
  let userId: string;
  let locationId: string;
  let categoryId: string;

  const PRICE = 500_000;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, InvoiceModule, PaymentsModule],
    }).compile();
    prisma = module.get(PrismaService);
    invoices = module.get(InvoiceService);
    payments = module.get(PaymentService);
    sessions = module.get(SessionsService);
    reports = module.get(AccountingReportsService);

    orgId = (await prisma.organization.create({ data: { name: `Credit ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    userId = (
      await prisma.user.create({
        data: { email: `credit-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    locationId = (await prisma.location.create({ data: { name: 'Main', organizationId: orgId } })).id;
    categoryId = (await prisma.category.create({ data: { name: 'General', organizationId: orgId } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  async function customer() {
    return (await prisma.customer.create({ data: { name: `Bengkel ${randomUUID().slice(0, 6)}`, organizationId: orgId } })).id;
  }

  async function product() {
    const p = await prisma.product.create({
      data: {
        name: `Part ${randomUUID().slice(0, 6)}`,
        sku: `P-${randomUUID().slice(0, 8)}`,
        categoryId,
        organizationId: orgId,
        sellingPrice: PRICE,
        costPrice: 300_000,
      },
    });
    await prisma.stock.create({ data: { productId: p.id, locationId, organizationId: orgId, quantity: 50 } });
    return p.id;
  }

  async function issued(customerId: string, productId: string, quantity: number) {
    const draft = await invoices.createDraft(orgId, userId, {
      locationId,
      format: InvoiceFormat.A4,
      customerId,
      items: [{ productId, locationId, quantity }],
    } as any);
    await invoices.issue(orgId, draft.id, userId, 'ADMIN');
    return draft.id;
  }

  async function pay(invoiceId: string, amount: number) {
    return payments.recordPayment(orgId, invoiceId, { amount, method: PaymentMethod.CASH } as any, userId);
  }

  async function returnUnits(invoiceId: string, productId: string, qty: number) {
    const session = await sessions.create(orgId, SessionType.RETURNS, undefined, undefined, { returnInvoiceId: invoiceId });
    await sessions.addItem(orgId, session.id, productId, qty, undefined, locationId, 'CHANGED_MIND', userId);
  }

  async function balance(key: SystemAccountKey) {
    const account = await prisma.chartOfAccount.findFirstOrThrow({ where: { organizationId: orgId, systemKey: key } });
    const agg = await prisma.journalEntryLine.aggregate({
      where: { accountId: account.id, journalEntry: { organizationId: orgId, status: JournalEntryStatus.POSTED } },
      _sum: { debit: true, credit: true },
    });
    return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
  }

  // A paid invoice for 2 units with one returned: the customer has PRICE of credit.
  async function invoiceWithCredit(customerId: string) {
    const productId = await product();
    const id = await issued(customerId, productId, 2);
    await pay(id, 2 * PRICE);
    await returnUnits(id, productId, 1);
    return id;
  }

  it('refunds part of the credit, then refuses more than is left', async () => {
    const id = await invoiceWithCredit(await customer());
    expect((await payments.getCreditInfo(orgId, id)).credit).toBe(PRICE);
    const ar = await balance(SystemAccountKey.ACCOUNTS_RECEIVABLE);
    const cash = await balance(SystemAccountKey.CASH);

    const after = await payments.refund(orgId, id, { amount: 300_000, method: PaymentMethod.CASH } as any, userId);
    expect(after.amountPaid).toBe(2 * PRICE - 300_000);
    expect((await payments.getCreditInfo(orgId, id)).credit).toBe(200_000);
    expect(await balance(SystemAccountKey.ACCOUNTS_RECEIVABLE)).toBeCloseTo(ar + 300_000, 2);
    expect(await balance(SystemAccountKey.CASH)).toBeCloseTo(cash - 300_000, 2);

    await expect(
      payments.refund(orgId, id, { amount: 200_001, method: PaymentMethod.CASH } as any, userId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a refund on an invoice with no credit', async () => {
    const id = await issued(await customer(), await product(), 1);
    await pay(id, PRICE);
    await expect(
      payments.refund(orgId, id, { amount: 1, method: PaymentMethod.CASH } as any, userId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies credit to the next invoice so the customer only pays the rest', async () => {
    const customerId = await customer();
    const source = await invoiceWithCredit(customerId); // PRICE of credit
    const target = await issued(customerId, await product(), 3); // owes 3 × PRICE
    const ar = await balance(SystemAccountKey.ACCOUNTS_RECEIVABLE);

    expect((await payments.getCreditInfo(orgId, target)).customerCredit).toBe(PRICE);
    const after = await payments.applyCredit(orgId, target, {}, userId);
    expect(after.amountPaid).toBe(PRICE);
    expect(after.paymentStatus).toBe(PaymentStatus.PARTIAL);
    expect((await payments.getCreditInfo(orgId, source)).credit).toBe(0);
    // Moving credit between invoices leaves AR as it was.
    expect(await balance(SystemAccountKey.ACCOUNTS_RECEIVABLE)).toBeCloseTo(ar, 2);

    const paid = await pay(target, 2 * PRICE);
    expect(paid.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it('undoes a credit application on both invoices when either leg is voided', async () => {
    const customerId = await customer();
    const source = await invoiceWithCredit(customerId);
    const target = await issued(customerId, await product(), 2);
    await payments.applyCredit(orgId, target, { sourceInvoiceId: source, amount: 100_000 }, userId);

    const leg = await prisma.payment.findFirstOrThrow({ where: { invoiceId: target, kind: PaymentKind.CREDIT_IN } });
    const after = await payments.voidPayment(orgId, target, leg.id, userId, 'wrong invoice');
    expect(after.amountPaid).toBe(0);
    expect((await payments.getCreditInfo(orgId, source)).credit).toBe(PRICE);
  });

  it("won't apply credit across customers", async () => {
    const source = await invoiceWithCredit(await customer());
    const target = await issued(await customer(), await product(), 1);
    await expect(
      payments.applyCredit(orgId, target, { sourceInvoiceId: source }, userId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks voiding a payment whose money was since refunded', async () => {
    const id = await invoiceWithCredit(await customer());
    await payments.refund(orgId, id, { amount: PRICE, method: PaymentMethod.CASH } as any, userId);
    const original = await prisma.payment.findFirstOrThrow({ where: { invoiceId: id, kind: PaymentKind.PAYMENT } });
    await expect(payments.voidPayment(orgId, id, original.id, userId, 'x')).rejects.toBeInstanceOf(BadRequestException);

    // Voiding the refund first restores the credit.
    const refund = await prisma.payment.findFirstOrThrow({ where: { invoiceId: id, kind: PaymentKind.REFUND } });
    await payments.voidPayment(orgId, id, refund.id, userId, 'refund not sent');
    expect((await payments.getCreditInfo(orgId, id)).credit).toBe(PRICE);
  });

  it('keeps AR aging reconciled while customers hold credit', async () => {
    await invoiceWithCredit(await customer());
    const aging = await reports.getARAging(orgId, new Date());
    expect(aging.customerCredits).toBeGreaterThan(0);
    expect(aging.reconciliation.matches).toBe(true);
  });

  it('shows refunds and credit movements on the customer statement', async () => {
    const customerId = await customer();
    const source = await invoiceWithCredit(customerId);
    const target = await issued(customerId, await product(), 1);
    await payments.applyCredit(orgId, target, { amount: 200_000 }, userId);
    await payments.refund(orgId, source, { amount: 100_000, method: PaymentMethod.CASH } as any, userId);

    const from = new Date(Date.now() - 60_000);
    const statement = await invoices.getCustomerStatement(orgId, customerId, from, new Date());
    expect(statement.creditActivity.map((a) => [a.kind, a.amount])).toEqual([
      [PaymentKind.CREDIT_OUT, 200_000],
      [PaymentKind.CREDIT_IN, 200_000],
      [PaymentKind.REFUND, 100_000],
    ]);
    expect(statement.availableCredit).toBe(PRICE - 300_000);
  });
});
