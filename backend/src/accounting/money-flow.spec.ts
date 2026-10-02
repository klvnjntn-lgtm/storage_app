import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DiscountType,
  InvoiceFormat,
  InvoiceStatus,
  JournalEntryStatus,
  JournalSourceType,
  PaymentMethod,
  PaymentStatus,
  SystemAccountKey,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { PaymentsModule } from '../payments/payment.module';
import { PaymentService } from '../payments/payment.service';
import { AccountingModule } from './accounting.module';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';
import { JournalService } from './journal.service';
import { PostingRulesService } from './posting-rules.service';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering, which
// these tests never exercise.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Integration tests for the money path: price → issue → pay → void → return,
// asserting the ledger at every step. Runs against the isolated test DB
// (see test/setup-test-env.ts). Each run creates a fresh org, so nothing is
// shared between runs; the test DB is throwaway and not cleaned up.
describe('Money flow — invoice, payment, journal', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoiceService;
  let payments: PaymentService;
  let journal: JournalService;
  let postingRules: PostingRulesService;
  let pricing: LineItemPricingService;

  let orgId: string;
  let userId: string;
  let locationId: string;
  let productId: string;
  let vatId: string;
  let otherOrgVatId: string;

  const PRICE = 100_000;
  const COST = 60_000;
  const OPENING_STOCK = 10;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, AccountingModule, InvoiceModule, PaymentsModule],
    }).compile();
    prisma = module.get(PrismaService);
    invoices = module.get(InvoiceService);
    payments = module.get(PaymentService);
    journal = module.get(JournalService);
    postingRules = module.get(PostingRulesService);
    pricing = module.get(LineItemPricingService);

    const org = await prisma.organization.create({ data: { name: `Money Test ${randomUUID()}` } });
    orgId = org.id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);

    const user = await prisma.user.create({
      data: { email: `money-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
    });
    userId = user.id;
    const location = await prisma.location.create({ data: { name: 'Main', organizationId: orgId } });
    locationId = location.id;
    const category = await prisma.category.create({ data: { name: 'General', organizationId: orgId } });
    const product = await prisma.product.create({
      data: {
        name: 'Oil Filter',
        sku: `OF-${randomUUID().slice(0, 8)}`,
        categoryId: category.id,
        organizationId: orgId,
        sellingPrice: PRICE,
        costPrice: COST,
      },
    });
    productId = product.id;
    await prisma.stock.create({
      data: { productId, locationId, organizationId: orgId, quantity: OPENING_STOCK },
    });
    const vat = await prisma.organizationTaxRate.create({
      data: { organizationId: orgId, name: 'PPN', percentage: 11 },
    });
    vatId = vat.id;

    const otherOrg = await prisma.organization.create({ data: { name: `Other Org ${randomUUID()}` } });
    const otherVat = await prisma.organizationTaxRate.create({
      data: { organizationId: otherOrg.id, name: 'Foreign', percentage: 5 },
    });
    otherOrgVatId = otherVat.id;
  });

  afterAll(async () => {
    await module?.close();
  });

  // ---- helpers ----------------------------------------------------------

  async function accountBalance(key: SystemAccountKey) {
    const account = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { organizationId_systemKey: { organizationId: orgId, systemKey: key } },
    });
    const sums = await prisma.journalEntryLine.aggregate({
      where: { accountId: account.id, journalEntry: { status: JournalEntryStatus.POSTED } },
      _sum: { debit: true, credit: true },
    });
    return Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0); // debit-positive
  }

  async function ledgerIsBalanced() {
    const sums = await prisma.journalEntryLine.aggregate({
      where: { journalEntry: { organizationId: orgId } },
      _sum: { debit: true, credit: true },
    });
    return Math.abs(Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0)) < 0.005;
  }

  async function stockQty() {
    const s = await prisma.stock.findUniqueOrThrow({
      where: { productId_locationId: { productId, locationId } },
    });
    return Number(s.quantity);
  }

  // 2 × 100,000, 10% line discount, 11% VAT on the discounted amount:
  // gross 200,000 − 20,000 = 180,000 net, + 19,800 tax = 199,800.
  async function issueStandardInvoice() {
    const draft = await invoices.createDraft(orgId, userId, {
      locationId,
      format: InvoiceFormat.A4,
      customerName: 'Walk-in',
      items: [
        {
          productId,
          locationId,
          quantity: 2,
          taxRateIds: [vatId],
          discountType: DiscountType.PERCENTAGE,
          discountValue: 10,
        },
      ],
    } as any);
    await invoices.issue(orgId, draft.id, userId, 'ADMIN');
    return prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } });
  }

  // ---- pricing ------------------------------------------------------------

  describe('LineItemPricingService.priceLines', () => {
    it('applies the line discount before tax', async () => {
      const r = await pricing.priceLines(orgId, [
        { productId, locationId, quantity: 2, taxRateIds: [vatId], discountType: DiscountType.PERCENTAGE, discountValue: 10 },
      ]);
      expect(r.subtotal).toBe(200_000);
      expect(r.discountAmount).toBe(20_000);
      expect(r.taxableAmount).toBe(180_000);
      expect(r.taxAmount).toBe(19_800);
      expect(r.items[0].total).toBe(199_800);
      expect(r.items[0].unitCost).toBe(COST);
      expect(r.taxLines).toEqual([expect.objectContaining({ taxRateId: vatId, amount: 19_800 })]);
    });

    it('caps a FIXED discount at the line amount so a line never goes negative', async () => {
      const r = await pricing.priceLines(orgId, [
        { productId, locationId, quantity: 1, discountType: DiscountType.FIXED, discountValue: 999_999 },
      ]);
      expect(r.items[0].discountAmount).toBe(PRICE);
      expect(r.items[0].netAmount).toBe(0);
    });

    it('rejects a percentage discount over 100', async () => {
      await expect(
        pricing.priceLines(orgId, [
          { productId, locationId, quantity: 1, discountType: DiscountType.PERCENTAGE, discountValue: 101 },
        ]),
      ).rejects.toThrow(/cannot exceed 100/);
    });

    it("rejects another organization's tax rate", async () => {
      await expect(
        pricing.priceLines(orgId, [{ productId, locationId, quantity: 1, taxRateIds: [otherOrgVatId] }]),
      ).rejects.toThrow(/tax rates were not found/);
    });

    it('ignores a client-sent unitPrice when POS pricing is off', async () => {
      const r = await pricing.priceLines(orgId, [{ productId, locationId, quantity: 1, unitPrice: 1 }]);
      expect(r.items[0].unitPrice).toBe(PRICE);
    });
  });

  // ---- issue --------------------------------------------------------------

  describe('InvoiceService.issue', () => {
    it('numbers the invoice, takes stock, and posts balanced revenue/tax/COGS', async () => {
      const stockBefore = await stockQty();
      const arBefore = await accountBalance(SystemAccountKey.ACCOUNTS_RECEIVABLE);
      const revenueBefore = await accountBalance(SystemAccountKey.SALES_REVENUE);
      const taxBefore = await accountBalance(SystemAccountKey.SALES_TAX_PAYABLE);
      const cogsBefore = await accountBalance(SystemAccountKey.COST_OF_GOODS_SOLD);

      const inv = await issueStandardInvoice();

      expect(inv.status).toBe(InvoiceStatus.ISSUED);
      expect(inv.invoiceNumber).toBeTruthy();
      expect(Number(inv.total)).toBe(199_800);
      expect(await stockQty()).toBe(stockBefore - 2);

      expect((await accountBalance(SystemAccountKey.ACCOUNTS_RECEIVABLE)) - arBefore).toBe(199_800);
      expect((await accountBalance(SystemAccountKey.SALES_REVENUE)) - revenueBefore).toBe(-180_000);
      expect((await accountBalance(SystemAccountKey.SALES_TAX_PAYABLE)) - taxBefore).toBe(-19_800);
      expect((await accountBalance(SystemAccountKey.COST_OF_GOODS_SOLD)) - cogsBefore).toBe(2 * COST);
      expect(await ledgerIsBalanced()).toBe(true);
    });

    it('a cart edit racing issue() never leaves stock/ledger out of step with the invoice', async () => {
      // Enough for 5 rounds of up to 2 units each, so fulfillment is never
      // capped by available stock (that's the BLOCK policy, not a race).
      await prisma.stock.update({
        where: { productId_locationId: { productId, locationId } },
        data: { quantity: { increment: 15 } },
      });
      for (let round = 0; round < 5; round++) {
        const draft = await invoices.createDraft(orgId, userId, {
          locationId,
          format: InvoiceFormat.A4,
          items: [{ productId, locationId, quantity: 1 }],
        } as any);
        const stockBefore = await stockQty();

        await Promise.allSettled([
          invoices.issue(orgId, draft.id, userId, 'ADMIN'),
          invoices.updateDraft(orgId, draft.id, { items: [{ productId, locationId, quantity: 2 }] } as any),
        ]);

        const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id }, include: { items: true } });
        expect(inv.status).toBe(InvoiceStatus.ISSUED);
        const qty = inv.items.reduce((sum, i) => sum + Number(i.quantity), 0);
        expect(Number(inv.total)).toBe(qty * PRICE);
        expect(stockBefore - (await stockQty())).toBe(qty);

        const ar = await prisma.journalEntryLine.aggregate({
          where: {
            journalEntry: { organizationId: orgId, sourceId: draft.id, status: JournalEntryStatus.POSTED },
            debit: { gt: 0 },
          },
          _sum: { debit: true },
        });
        expect(Number(ar._sum.debit)).toBe(qty * PRICE);
      }
    });

    it('refuses to issue the same invoice twice', async () => {
      const inv = await issueStandardInvoice();
      await expect(invoices.issue(orgId, inv.id, userId, 'ADMIN')).rejects.toThrow();
      const entries = await prisma.journalEntry.count({
        where: { organizationId: orgId, sourceType: JournalSourceType.INVOICE, sourceId: inv.id },
      });
      expect(entries).toBe(1);
    });
  });

  // ---- payments -----------------------------------------------------------

  describe('PaymentService', () => {
    it('moves PARTIAL → PAID, rejects overpayment, and void restores the balance', async () => {
      const inv = await issueStandardInvoice();
      const arBefore = await accountBalance(SystemAccountKey.ACCOUNTS_RECEIVABLE);

      let r = await payments.recordPayment(orgId, inv.id, { amount: 100_000, method: PaymentMethod.CASH } as any, userId);
      expect(r.paymentStatus).toBe(PaymentStatus.PARTIAL);

      await expect(
        payments.recordPayment(orgId, inv.id, { amount: 99_801, method: PaymentMethod.CASH } as any, userId),
      ).rejects.toThrow(/exceeds balance due/);

      r = await payments.recordPayment(orgId, inv.id, { amount: 99_800, method: PaymentMethod.CASH } as any, userId);
      expect(r.paymentStatus).toBe(PaymentStatus.PAID);
      expect(r.amountPaid).toBe(199_800);
      expect((await accountBalance(SystemAccountKey.ACCOUNTS_RECEIVABLE)) - arBefore).toBe(-199_800);

      const last = r.payments.find((p) => p.amount === 99_800)!;
      r = await payments.voidPayment(orgId, inv.id, last.id, userId, 'duplicate');
      expect(r.paymentStatus).toBe(PaymentStatus.PARTIAL);
      expect(r.amountPaid).toBe(100_000);
      // Soft void: hidden from the invoice, but the row and who voided it stay.
      expect(r.payments.map((p) => p.id)).not.toContain(last.id);
      const voided = await prisma.payment.findUniqueOrThrow({ where: { id: last.id } });
      expect(voided.voidedAt).not.toBeNull();
      expect(voided.voidedById).toBe(userId);
      expect(voided.voidReason).toBe('duplicate');
      await expect(payments.voidPayment(orgId, inv.id, last.id, userId, 'again')).rejects.toThrow(/not found/i);
      expect((await accountBalance(SystemAccountKey.ACCOUNTS_RECEIVABLE)) - arBefore).toBe(-100_000);
      expect(await ledgerIsBalanced()).toBe(true);
    });

    it('rejects payments on a draft', async () => {
      const draft = await invoices.createDraft(orgId, userId, {
        locationId,
        format: InvoiceFormat.A4,
        items: [{ productId, locationId, quantity: 1 }],
      } as any);
      await expect(
        payments.recordPayment(orgId, draft.id, { amount: 1, method: PaymentMethod.CASH } as any, userId),
      ).rejects.toThrow(/issued invoices/);
    });

    it("cannot pay another organization's invoice", async () => {
      const inv = await issueStandardInvoice();
      const stranger = await prisma.organization.create({ data: { name: `Stranger ${randomUUID()}` } });
      await expect(
        payments.recordPayment(stranger.id, inv.id, { amount: 1, method: PaymentMethod.CASH } as any, userId),
      ).rejects.toThrow(/not found/i);
    });
  });

  // ---- returns (creditedAmount) ------------------------------------------

  describe('sales return credit', () => {
    async function returnOneUnit(invoiceId: string) {
      const item = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId } });
      await prisma.$transaction((tx) =>
        postingRules.postSalesReturn(
          orgId,
          {
            sourceId: `${invoiceId}:return:${randomUUID()}`,
            date: new Date(),
            memo: 'test return',
            invoiceId,
            lines: [{ invoiceItemId: item.id, quantity: 1 }],
          },
          tx,
        ),
      );
    }

    it('limits payment to what is still owed after a return', async () => {
      const inv = await issueStandardInvoice();
      await returnOneUnit(inv.id); // credits half: 99,900

      const credited = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      expect(Number(credited.creditedAmount)).toBe(99_900);

      await expect(
        payments.recordPayment(orgId, inv.id, { amount: 199_800, method: PaymentMethod.CASH } as any, userId),
      ).rejects.toThrow(/exceeds balance due/);

      const r = await payments.recordPayment(orgId, inv.id, { amount: 99_900, method: PaymentMethod.CASH } as any, userId);
      expect(r.paymentStatus).toBe(PaymentStatus.PAID);
      expect(await ledgerIsBalanced()).toBe(true);
    });

    it('marks the invoice PAID when a return covers the remaining balance', async () => {
      const inv = await issueStandardInvoice();
      await payments.recordPayment(orgId, inv.id, { amount: 99_900, method: PaymentMethod.CASH } as any, userId);
      await returnOneUnit(inv.id);

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      expect(after.paymentStatus).toBe(PaymentStatus.PAID);
    });
  });

  // ---- journal ------------------------------------------------------------

  describe('JournalService', () => {
    async function twoAccounts() {
      const [cash, revenue] = await Promise.all(
        [SystemAccountKey.CASH, SystemAccountKey.SALES_REVENUE].map((k) =>
          prisma.chartOfAccount.findUniqueOrThrow({
            where: { organizationId_systemKey: { organizationId: orgId, systemKey: k } },
          }),
        ),
      );
      return { cash: cash.id, revenue: revenue.id };
    }

    it('rejects an unbalanced entry', async () => {
      const { cash, revenue } = await twoAccounts();
      await expect(
        journal.postEntry(orgId, {
          date: new Date(),
          sourceType: JournalSourceType.MANUAL,
          lines: [
            { accountId: cash, debit: 100 },
            { accountId: revenue, credit: 99.99 },
          ],
        }),
      ).rejects.toThrow(/does not balance/);
    });

    it('voiding posts a mirror entry and takes both out of the ledger', async () => {
      const { cash, revenue } = await twoAccounts();
      const cashBefore = await accountBalance(SystemAccountKey.CASH);
      const entry = await journal.postEntry(orgId, {
        date: new Date(),
        sourceType: JournalSourceType.MANUAL,
        lines: [
          { accountId: cash, debit: 500 },
          { accountId: revenue, credit: 500 },
        ],
      });
      expect((await accountBalance(SystemAccountKey.CASH)) - cashBefore).toBe(500);

      const reversal = await journal.voidEntry(orgId, entry.id, userId, 'test');
      expect(reversal.reversalOfId).toBe(entry.id);
      expect(await accountBalance(SystemAccountKey.CASH)).toBe(cashBefore);
      await expect(journal.voidEntry(orgId, entry.id, userId)).rejects.toThrow(/already void/);
    });

    it('refuses to post into a closed fiscal period', async () => {
      const { cash, revenue } = await twoAccounts();
      await journal.closePeriod(orgId, 2020, 1);
      await expect(
        journal.postEntry(orgId, {
          date: new Date(Date.UTC(2020, 0, 15)),
          sourceType: JournalSourceType.MANUAL,
          lines: [
            { accountId: cash, debit: 1 },
            { accountId: revenue, credit: 1 },
          ],
        }),
      ).rejects.toThrow(/CLOSED/);
    });
  });
});
