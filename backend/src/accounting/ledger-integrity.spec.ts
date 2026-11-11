import 'dotenv/config';
import { randomUUID } from 'crypto';
import { of, lastValueFrom, throwError } from 'rxjs';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FiscalPeriodStatus,
  InvoiceFormat,
  JournalEntryStatus,
  JournalSourceType,
  PaymentMethod,
  PurchaseOrderStatus,
  SystemAccountKey,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { GoodsReceiptModule } from '../goods-receipt/goods-receipt.module';
import { GoodsReceiptService } from '../goods-receipt/goods-receipt.service';
import { PaymentsModule } from '../payments/payment.module';
import { PaymentService } from '../payments/payment.service';
import { ProductService } from '../product/product.service';
import { AccountingReportsService } from './accounting-reports.service';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';
import { JournalService } from './journal.service';
import { orgToday } from './business-date';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// The Inventory account has to keep matching quantity x average cost, and a
// closed period's figures must not move. Each case here is a path that used
// to break one of those. Stock always comes in through goods receipts, so
// the ledger starts out right.
describe('Ledger integrity', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoiceService;
  let receipts: GoodsReceiptService;
  let payments: PaymentService;
  let products: ProductService;
  let reports: AccountingReportsService;
  let journal: JournalService;

  let userId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, InvoiceModule, GoodsReceiptModule, PaymentsModule],
    }).compile();
    prisma = module.get(PrismaService);
    invoices = module.get(InvoiceService);
    receipts = module.get(GoodsReceiptService);
    payments = module.get(PaymentService);
    products = module.get(ProductService);
    reports = module.get(AccountingReportsService);
    journal = module.get(JournalService);
  });

  afterAll(async () => {
    await module?.close();
  });

  // A fresh org per case: the reconciliation is org-wide.
  async function org() {
    const orgId = (
      await prisma.organization.create({ data: { name: `Ledger ${randomUUID()}`, stockPolicy: 'ALLOW' } })
    ).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    userId = (
      await prisma.user.create({
        data: { email: `ledger-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    const locationId = (await prisma.location.create({ data: { name: 'Main', organizationId: orgId } })).id;
    const categoryId = (await prisma.category.create({ data: { name: 'General', organizationId: orgId } })).id;
    const product = async (cost: number | null = null) =>
      (
        await prisma.product.create({
          data: {
            name: `Part ${randomUUID().slice(0, 6)}`,
            sku: `P-${randomUUID().slice(0, 8)}`,
            categoryId,
            organizationId: orgId,
            sellingPrice: 500_000,
            costPrice: cost,
          },
        })
      ).id;
    const receive = async (productId: string, quantity: number, unitCost: number) => {
      const lineTotal = quantity * unitCost;
      const po = await prisma.purchaseOrder.create({
        data: {
          organizationId: orgId,
          locationId,
          status: PurchaseOrderStatus.SENT,
          subtotal: lineTotal,
          total: lineTotal,
          items: { create: [{ productId, quantity, unitCost, lineTotal }] },
        },
        include: { items: true },
      });
      return receipts.receive(orgId, userId, po.id, {
        locationId,
        items: [{ purchaseOrderItemId: po.items[0].id, quantity }],
      });
    };
    const sell = async (productId: string, quantity: number) => {
      const draft = await invoices.createDraft(orgId, userId, {
        locationId,
        format: InvoiceFormat.A4,
        items: [{ productId, locationId, quantity }],
      } as any);
      await invoices.issue(orgId, draft.id, userId, 'ADMIN', true);
      return draft.id;
    };
    const cogs = async () => {
      const account = await prisma.chartOfAccount.findFirstOrThrow({
        where: { organizationId: orgId, systemKey: SystemAccountKey.COST_OF_GOODS_SOLD },
      });
      const agg = await prisma.journalEntryLine.aggregate({
        where: { accountId: account.id, journalEntry: { status: JournalEntryStatus.POSTED } },
        _sum: { debit: true, credit: true },
      });
      return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
    };
    return { orgId, locationId, product, receive, sell, cogs };
  }

  describe('cost of units sold below zero', () => {
    it('recosts only the oversold units, leaving the ledger equal to the stock', async () => {
      const { orgId, product, receive, sell, cogs } = await org();
      const productId = await product();
      await receive(productId, 3, 100_000);
      const invoiceId = await sell(productId, 10); // 3 from the shelf, 7 below zero
      const line = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId } });
      expect(line.costProvisional).toBe(true);
      expect(Number(line.provisionalQuantity)).toBe(7);

      await receive(productId, 20, 150_000);
      await invoices.recostInvoiceItem(orgId, invoiceId, line.id, undefined, userId);

      // 3 at 100.000 + 7 at 150.000 — not all 10 at 150.000.
      expect(await cogs()).toBe(3 * 100_000 + 7 * 150_000);
      const after = await prisma.invoiceItem.findUniqueOrThrow({ where: { id: line.id } });
      expect(Number(after.unitCost)).toBe(135_000);
      expect(after.costProvisional).toBe(false);

      const check = await reports.getInventoryReconciliation(orgId);
      expect(check.stockValue).toBe(13 * 150_000);
      expect(check.difference).toBe(0);
    });

    it('takes the correction back out when the invoice is voided', async () => {
      const { orgId, product, receive, sell, cogs } = await org();
      const productId = await product();
      await receive(productId, 3, 100_000);
      const invoiceId = await sell(productId, 10);
      await receive(productId, 20, 150_000);
      const line = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId } });
      await invoices.recostInvoiceItem(orgId, invoiceId, line.id, undefined, userId);

      await invoices.voidInvoice(orgId, invoiceId, 'entered by mistake', userId);

      expect(await cogs()).toBe(0);
      const check = await reports.getInventoryReconciliation(orgId);
      expect(check.ledgerBalance).toBe(3 * 100_000 + 20 * 150_000);
      expect(check.inBalance).toBe(true);
    });

    it('flags a sale of a product with no cost, so it can be costed later', async () => {
      const { orgId, locationId, product, sell, cogs } = await org();
      const productId = await product();
      await prisma.stock.create({ data: { productId, locationId, organizationId: orgId, quantity: 5 } });
      const invoiceId = await sell(productId, 2);
      const line = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId } });
      expect(line.costProvisional).toBe(true);
      expect(Number(line.provisionalQuantity)).toBe(2);

      await invoices.recostInvoiceItem(orgId, invoiceId, line.id, 80_000, userId);
      expect(await cogs()).toBe(160_000);
    });
  });

  it('books the change in stock value when a cost is edited by hand', async () => {
    const { orgId, product, receive } = await org();
    const productId = await product();
    await receive(productId, 10, 100_000);

    await products.update(orgId, productId, { costPrice: 120_000 }, undefined, userId);

    const check = await reports.getInventoryReconciliation(orgId);
    expect(check.ledgerBalance).toBe(1_200_000);
    expect(check.difference).toBe(0);
  });

  it('reports the gap when stock is put in behind the ledger’s back', async () => {
    const { orgId, locationId, product, receive } = await org();
    const productId = await product();
    await receive(productId, 10, 100_000);
    await prisma.stock.update({
      where: { productId_locationId: { productId, locationId } },
      data: { quantity: { increment: 5 } },
    });

    const check = await reports.getInventoryReconciliation(orgId);
    expect(check.inBalance).toBe(false);
    expect(check.difference).toBe(-500_000);
  });

  describe('closed periods', () => {
    async function entryLastMonth(orgId: string) {
      const [ar, equity] = await Promise.all(
        [SystemAccountKey.ACCOUNTS_RECEIVABLE, SystemAccountKey.RETAINED_EARNINGS].map(
          async (systemKey) =>
            (await prisma.chartOfAccount.findFirstOrThrow({ where: { organizationId: orgId, systemKey } })).id,
        ),
      );
      const today = await orgToday(prisma, orgId);
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15));
      const entry = await journal.postEntry(orgId, {
        date,
        sourceType: JournalSourceType.MANUAL,
        sourceId: `manual-${randomUUID()}`,
        lines: [
          { accountId: ar, debit: 250_000 },
          { accountId: equity, credit: 250_000 },
        ],
      });
      return { entry, date, today };
    }

    it('leaves a closed month alone and books the reversal today', async () => {
      const { orgId } = await org();
      const { entry, date, today } = await entryLastMonth(orgId);
      await journal.closePeriod(orgId, date.getUTCFullYear(), date.getUTCMonth() + 1);

      const reversal = await journal.voidEntry(orgId, entry.id, userId, 'wrong amount');

      const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(original.status).toBe(JournalEntryStatus.POSTED);
      expect(reversal.status).toBe(JournalEntryStatus.POSTED);
      expect(reversal.entryDate.toISOString()).toBe(today.toISOString());
      expect(reversal.fiscalPeriodId).not.toBe(original.fiscalPeriodId);
      // The source is free again, and can't be reversed twice.
      expect(await journal.findPostedBySource(orgId, JournalSourceType.MANUAL, entry.sourceId!)).toBeNull();
      await expect(journal.voidEntry(orgId, entry.id, userId, 'again')).rejects.toThrow('already reversed');
    });

    it('still voids in place while the month is open', async () => {
      const { orgId } = await org();
      const { entry } = await entryLastMonth(orgId);
      const reversal = await journal.voidEntry(orgId, entry.id, userId, 'wrong amount');
      const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
      expect(original.status).toBe(JournalEntryStatus.VOID);
      expect(reversal.status).toBe(JournalEntryStatus.VOID);
      expect(reversal.fiscalPeriodId).toBe(original.fiscalPeriodId);
    });

    it('locks a period for good', async () => {
      const { orgId } = await org();
      const { date } = await entryLastMonth(orgId);
      const [y, m] = [date.getUTCFullYear(), date.getUTCMonth() + 1];
      await journal.closePeriod(orgId, y, m);
      expect((await journal.lockPeriod(orgId, y, m)).status).toBe(FiscalPeriodStatus.LOCKED);
      await expect(journal.reopenPeriod(orgId, y, m)).rejects.toThrow('LOCKED periods cannot be reopened');
      await expect(journal.closePeriod(orgId, y, m)).rejects.toThrow('LOCKED periods cannot be changed');
    });
  });

  describe('payment date', () => {
    it('dates the journal entry by the day the money moved', async () => {
      const { orgId, product, receive, sell } = await org();
      const productId = await product();
      await receive(productId, 5, 100_000);
      const invoiceId = await sell(productId, 1);
      const today = await orgToday(prisma, orgId);
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      const paid = await payments.recordPayment(
        orgId,
        invoiceId,
        { amount: 100_000, method: PaymentMethod.CASH, paymentDate: yesterday.toISOString().slice(0, 10) } as any,
        userId,
      );
      const entry = await journal.findPostedBySource(orgId, JournalSourceType.PAYMENT, paid.payments[0].id);
      expect(entry!.entryDate.toISOString()).toBe(yesterday.toISOString());
    });

    it('refuses a date in the future', async () => {
      const { orgId, product, receive, sell } = await org();
      const productId = await product();
      await receive(productId, 5, 100_000);
      const invoiceId = await sell(productId, 1);
      const today = await orgToday(prisma, orgId);
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await expect(
        payments.recordPayment(orgId, invoiceId, { amount: 100_000, method: PaymentMethod.CASH, paymentDate: tomorrow } as any, userId),
      ).rejects.toThrow('Payment date cannot be in the future');
    });
  });

  describe('a write sent twice', () => {
    function request(userKey: string, key: string, body: unknown) {
      const res = { statusCode: 201, headersSent: false, status(code: number) { this.statusCode = code; return this; } };
      const req = {
        method: 'POST',
        originalUrl: '/invoices/x/payments',
        url: '/invoices/x/payments',
        headers: { 'idempotency-key': key, 'content-type': 'application/json' },
        body,
        user: { sub: userKey },
      };
      const context: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
      return { context, res };
    }

    it('runs once and answers the repeat with the first reply', async () => {
      const interceptor = new IdempotencyInterceptor(prisma);
      const user = randomUUID();
      const key = randomUUID();
      let runs = 0;
      const handler = { handle: () => of({ id: `payment-${++runs}` }) };

      const first = request(user, key, { amount: 5 });
      expect(await lastValueFrom(await interceptor.intercept(first.context, handler))).toEqual({ id: 'payment-1' });
      const second = request(user, key, { amount: 5 });
      expect(await lastValueFrom(await interceptor.intercept(second.context, handler))).toEqual({ id: 'payment-1' });
      expect(runs).toBe(1);
      expect(second.res.statusCode).toBe(201);

      // Same key, different request: a client bug, not a retry.
      const other = request(user, key, { amount: 6 });
      await expect(interceptor.intercept(other.context, handler)).rejects.toThrow('different request');
    });

    it('frees the key when the request was refused', async () => {
      const interceptor = new IdempotencyInterceptor(prisma);
      const user = randomUUID();
      const key = randomUUID();
      const failing = { handle: () => throwError(() => new Error('refused')) };
      await expect(lastValueFrom(await interceptor.intercept(request(user, key, {}).context, failing))).rejects.toThrow('refused');
      const ok = { handle: () => of({ ok: true }) };
      expect(await lastValueFrom(await interceptor.intercept(request(user, key, {}).context, ok))).toEqual({ ok: true });
    });
  });
});
