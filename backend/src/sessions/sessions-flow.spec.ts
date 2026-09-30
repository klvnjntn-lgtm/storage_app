import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceFormat, ModuleKey, SessionType, SystemAccountKey, JournalEntryStatus, FulfillmentStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsModule } from './sessions.module';
import { SessionsService } from './sessions.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { LineItemPricingService } from '../shared/documents/line-item-pricing.service';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering, which
// these tests never exercise.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Integration tests for warehouse sessions: every session type's stock and
// ledger effect, the MOVE put-away guard, cancellation rules, and the
// paginated stock summary. Runs against the isolated test DB (see
// test/setup-test-env.ts); each run creates a fresh org and never cleans up.
describe('Warehouse sessions', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let sessions: SessionsService;

  let orgId: string;
  let userId: string;
  let categoryId: string;
  let locA: string;
  let locB: string;

  const COST = 40_000;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, AccountingModule, SessionsModule, SharedDocumentsModule, InvoiceModule],
    }).compile();
    prisma = module.get(PrismaService);
    sessions = module.get(SessionsService);

    const org = await prisma.organization.create({ data: { name: `Sessions Test ${randomUUID()}` } });
    orgId = org.id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({
      data: { organizationId: orgId, module: ModuleKey.WAREHOUSE_OPS },
    });

    const user = await prisma.user.create({
      data: { email: `sessions-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
    });
    userId = user.id;
    categoryId = (await prisma.category.create({ data: { name: 'General', organizationId: orgId } })).id;
    locA = (await prisma.location.create({ data: { name: 'Aisle A', organizationId: orgId } })).id;
    locB = (await prisma.location.create({ data: { name: 'Aisle B', organizationId: orgId } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  // ---- helpers ----------------------------------------------------------

  async function makeProduct(opts: { name?: string; stockA?: number; stockB?: number; cost?: number | null } = {}) {
    const product = await prisma.product.create({
      data: {
        name: opts.name ?? `Widget ${randomUUID().slice(0, 6)}`,
        sku: `W-${randomUUID().slice(0, 8)}`,
        categoryId,
        organizationId: orgId,
        sellingPrice: 100_000,
        costPrice: opts.cost === undefined ? COST : opts.cost,
      },
    });
    if (opts.stockA != null) {
      await prisma.stock.create({ data: { productId: product.id, locationId: locA, organizationId: orgId, quantity: opts.stockA } });
    }
    if (opts.stockB != null) {
      await prisma.stock.create({ data: { productId: product.id, locationId: locB, organizationId: orgId, quantity: opts.stockB } });
    }
    return product.id;
  }

  async function qty(productId: string, locationId: string) {
    const s = await prisma.stock.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });
    return s ? Number(s.quantity) : 0;
  }

  async function accountBalance(key: SystemAccountKey) {
    const account = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { organizationId_systemKey: { organizationId: orgId, systemKey: key } },
    });
    const sums = await prisma.journalEntryLine.aggregate({
      where: { accountId: account.id, journalEntry: { status: JournalEntryStatus.POSTED } },
      _sum: { debit: true, credit: true },
    });
    return Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0);
  }

  async function importBatch(mode: 'INCREMENT' | 'REPLACE', lines: { productId: string; qty: number }[] = []) {
    const batch = await prisma.stockImportBatch.create({ data: { organizationId: orgId, mode, userId } });
    for (const l of lines) {
      await prisma.event.create({
        data: {
          type: mode === 'INCREMENT' ? 'IMPORT_INCREMENT' : 'IMPORT_REPLACE',
          productId: l.productId, toLocationId: locA, quantity: l.qty,
          organizationId: orgId, importBatchId: batch.id,
        },
      });
    }
    return batch.id;
  }

  const receiveSession = async () =>
    sessions.create(orgId, SessionType.RECEIVE, undefined, undefined, { importBatchId: await importBatch('INCREMENT') });

  const add = (sessionId: string, productId: string, n: number, extra: { from?: string; to?: string; reason?: string } = {}) =>
    sessions.addItem(orgId, sessionId, productId, n, extra.from, extra.to, extra.reason, userId);

  // ---- MOVE -------------------------------------------------------------

  describe('MOVE', () => {
    it('refuses to complete until everything picked is put away', async () => {
      const productId = await makeProduct({ stockA: 10 });
      const session = await sessions.create(orgId, SessionType.MOVE);

      await add(session.id, productId, 5, { from: locA });
      expect(await qty(productId, locA)).toBe(5);

      await sessions.advanceStage(orgId, session.id);
      await add(session.id, productId, 3, { to: locB });

      const pending = await sessions.pendingPutaway(session.id);
      expect(pending).toEqual([expect.objectContaining({ productId, picked: 5, moved: 3, pending: 2 })]);
      await expect(sessions.complete(orgId, session.id)).rejects.toThrow(/not been put away/);

      await add(session.id, productId, 2, { to: locB });
      const done = await sessions.complete(orgId, session.id);
      expect(done.status).toBe('COMPLETED');
      expect(await qty(productId, locA)).toBe(5);
      expect(await qty(productId, locB)).toBe(5);
    });

    it('refuses to put away more than was picked', async () => {
      const productId = await makeProduct({ stockA: 4 });
      const session = await sessions.create(orgId, SessionType.MOVE);
      await add(session.id, productId, 2, { from: locA });
      await sessions.advanceStage(orgId, session.id);
      await expect(add(session.id, productId, 3, { to: locB })).rejects.toThrow(/only 2 unit/);
    });

    it('refuses a pick larger than the stock at the source', async () => {
      const productId = await makeProduct({ stockA: 1 });
      const session = await sessions.create(orgId, SessionType.MOVE);
      await expect(add(session.id, productId, 2, { from: locA })).rejects.toThrow(/Insufficient stock/);
      expect(await qty(productId, locA)).toBe(1);
    });
  });

  // ---- RECEIVE ----------------------------------------------------------

  describe('RECEIVE (import-first)', () => {
    it('requires an import to count against', async () => {
      await expect(sessions.create(orgId, SessionType.RECEIVE)).rejects.toThrow(/import the delivery first/);
    });

    it('refuses a replace import', async () => {
      const batchId = await importBatch('REPLACE');
      await expect(
        sessions.create(orgId, SessionType.RECEIVE, undefined, undefined, { importBatchId: batchId }),
      ).rejects.toThrow(/replace import/);
    });

    it('refuses another organization’s import', async () => {
      const other = await prisma.organization.create({ data: { name: `Other ${randomUUID()}` } });
      const foreign = await prisma.stockImportBatch.create({ data: { organizationId: other.id, mode: 'INCREMENT' } });
      await expect(
        sessions.create(orgId, SessionType.RECEIVE, undefined, undefined, { importBatchId: foreign.id }),
      ).rejects.toThrow(/Import not found/);
    });

    it('reports expected vs counted, including short and extra items', async () => {
      const short = await makeProduct();
      const exact = await makeProduct();
      const extra = await makeProduct();
      const batchId = await importBatch('INCREMENT', [{ productId: short, qty: 5 }, { productId: exact, qty: 2 }]);
      const session = await sessions.create(orgId, SessionType.RECEIVE, undefined, undefined, { importBatchId: batchId });

      await add(session.id, short, 3);
      await add(session.id, exact, 2);
      await add(session.id, extra, 1);

      const detail = await sessions.findOne(orgId, session.id);
      const byId = new Map(detail.receiveCheck!.map((r) => [r.productId, r]));
      expect(byId.get(short)).toMatchObject({ expected: 5, counted: 3, difference: -2 });
      expect(byId.get(exact)).toMatchObject({ expected: 2, counted: 2, difference: 0 });
      expect(byId.get(extra)).toMatchObject({ expected: 0, counted: 1, difference: 1 });
    });
  });

  // ---- RETURNS ----------------------------------------------------------

  describe('RETURNS', () => {
    it('requires a reason', async () => {
      const productId = await makeProduct();
      const session = await sessions.create(orgId, SessionType.RETURNS);
      await expect(add(session.id, productId, 1, { to: locA })).rejects.toThrow(/valid reason/);
    });

    it('puts stock back and reverses COGS at cost price', async () => {
      const productId = await makeProduct({ stockA: 0 });
      const session = await sessions.create(orgId, SessionType.RETURNS);
      const inventoryBefore = await accountBalance(SystemAccountKey.INVENTORY);
      const cogsBefore = await accountBalance(SystemAccountKey.COST_OF_GOODS_SOLD);

      await add(session.id, productId, 2, { to: locA, reason: 'CHANGED_MIND' });

      expect(await qty(productId, locA)).toBe(2);
      expect(await accountBalance(SystemAccountKey.INVENTORY)).toBeCloseTo(inventoryBefore + 2 * COST);
      expect(await accountBalance(SystemAccountKey.COST_OF_GOODS_SOLD)).toBeCloseTo(cogsBefore - 2 * COST);
    });
  });

  // ---- FULFILLMENT --------------------------------------------------------

  describe('FULFILLMENT without a source document', () => {
    it('decrements stock and posts COGS at the product cost price', async () => {
      const productId = await makeProduct({ stockA: 5 });
      const session = await sessions.create(orgId, SessionType.FULFILLMENT);
      const cogsBefore = await accountBalance(SystemAccountKey.COST_OF_GOODS_SOLD);

      await add(session.id, productId, 2, { from: locA });

      expect(await qty(productId, locA)).toBe(3);
      expect(await accountBalance(SystemAccountKey.COST_OF_GOODS_SOLD)).toBeCloseTo(cogsBefore + 2 * COST);
    });

    it('skips COGS (without failing the pick) when the product has no cost price', async () => {
      const productId = await makeProduct({ stockA: 5, cost: null });
      const session = await sessions.create(orgId, SessionType.FULFILLMENT);
      const cogsBefore = await accountBalance(SystemAccountKey.COST_OF_GOODS_SOLD);

      await add(session.id, productId, 1, { from: locA });

      expect(await qty(productId, locA)).toBe(4);
      expect(await accountBalance(SystemAccountKey.COST_OF_GOODS_SOLD)).toBeCloseTo(cogsBefore);
    });
  });

  // ---- Stage transitions ------------------------------------------------

  describe('stage transitions', () => {
    it('rejects a transition from a stale stage', async () => {
      const session = await sessions.create(orgId, SessionType.FULFILLMENT);
      await sessions.advanceStage(orgId, session.id);
      // Simulate a second client that loaded the session before the advance.
      await expect(
        (sessions as any).guardedSessionUpdate(orgId, session.id, { status: 'OPEN', stage: session.stage }, { stage: 'SHIP' }),
      ).rejects.toThrow(/changed since it was loaded/);
    });

    it('reopen logs exactly one reopen event', async () => {
      const session = await receiveSession();
      await sessions.complete(orgId, session.id);
      await sessions.reopen(orgId, session.id, 'found more', userId);
      await expect(sessions.reopen(orgId, session.id, 'again', userId)).rejects.toThrow(/Only completed/);
      expect(await prisma.sessionReopenEvent.count({ where: { sessionId: session.id } })).toBe(1);
    });
  });

  // ---- Cancel -------------------------------------------------------------

  describe('cancel', () => {
    it('cancels an untouched session, records the reason, and blocks further scans', async () => {
      const productId = await makeProduct({ stockA: 3 });
      const session = await sessions.create(orgId, SessionType.MOVE);

      const cancelled = await sessions.cancel(orgId, session.id, 'opened by mistake', userId);
      expect(cancelled.status).toBe('CANCELLED');

      const notes = await prisma.sessionNote.findMany({ where: { sessionId: session.id } });
      expect(notes.map((n) => n.note)).toEqual(['Session cancelled: opened by mistake']);

      await expect(add(session.id, productId, 1, { from: locA })).rejects.toThrow(/cancelled/);
      await expect(sessions.advanceStage(orgId, session.id)).rejects.toThrow(/cancelled/);
      await expect(sessions.complete(orgId, session.id)).rejects.toThrow(/cancelled/);
      expect(await qty(productId, locA)).toBe(3);
    });

    it('allows cancelling a receive session with count-only scans', async () => {
      const productId = await makeProduct();
      const session = await receiveSession();
      await add(session.id, productId, 4);
      await expect(sessions.cancel(orgId, session.id, 'wrong delivery', userId)).resolves.toMatchObject({ status: 'CANCELLED' });
    });

    it('refuses once stock has moved', async () => {
      const productId = await makeProduct({ stockA: 3 });
      const session = await sessions.create(orgId, SessionType.MOVE);
      await add(session.id, productId, 1, { from: locA });
      await expect(sessions.cancel(orgId, session.id, 'nope', userId)).rejects.toThrow(/Stock has already moved/);
    });

    it('requires a reason and an open session', async () => {
      const session = await receiveSession();
      await expect(sessions.cancel(orgId, session.id, '  ', userId)).rejects.toThrow(/reason is required/);
      await sessions.complete(orgId, session.id);
      await expect(sessions.cancel(orgId, session.id, 'late', userId)).rejects.toThrow(/Only open sessions/);
    });

    it('does not touch another organization’s session', async () => {
      const other = await prisma.organization.create({ data: { name: `Other ${randomUUID()}` } });
      const foreign = await prisma.session.create({ data: { type: SessionType.RECEIVE, organizationId: other.id } });
      await expect(sessions.cancel(orgId, foreign.id, 'x', userId)).rejects.toThrow(/not found/);
    });
  });

  // ---- Stock summary ----------------------------------------------------

  describe('stock summary (paginated)', () => {
    const admin = (): JwtPayload => ({ sub: userId, email: 'a@x', role: 'ADMIN', organizationId: orgId });
    const staff = (): JwtPayload => ({ sub: userId, email: 'u@x', role: 'USER', organizationId: orgId });
    let tag: string;
    let atB: string;
    let negative: string;
    let big: string;

    beforeAll(async () => {
      tag = `Summ${randomUUID().slice(0, 6)}`;
      atB = await makeProduct({ name: `${tag} bin-b`, stockA: 1, stockB: 7 });
      negative = await makeProduct({ name: `${tag} oversold`, stockA: -2 });
      big = await makeProduct({ name: `${tag} big`, stockA: 50 });
      await makeProduct({ name: `${tag} zero-at-b`, stockB: 0 });
    });

    type Page = { data: { productId: string; totalStock: number; costPrice: number | null }[]; total: number };
    const run = (q: Record<string, unknown>, user = admin()) =>
      sessions.summary(orgId, user, { page: 1, pageSize: 50, search: tag, ...q }) as Promise<Page>;

    it('paginates with a correct total', async () => {
      const first = await run({ pageSize: 2 });
      const second = await run({ pageSize: 2, page: 2 });
      expect(first.total).toBe(4);
      expect(first.data).toHaveLength(2);
      expect(second.data).toHaveLength(2);
      expect(new Set([...first.data, ...second.data].map((r) => r.productId)).size).toBe(4);
    });

    it('filters to products with non-zero stock at a location', async () => {
      const res = await run({ locationId: locB });
      expect(res.data.map((r) => r.productId)).toEqual([atB]);
    });

    it('filters to oversold products', async () => {
      const res = await run({ oversold: true });
      expect(res.data.map((r) => r.productId)).toEqual([negative]);
    });

    it('sorts by total stock across all locations', async () => {
      const res = await run({ sort: 'totalStock', dir: 'desc' });
      expect(res.data[0].productId).toBe(big);
      expect(res.data[0].totalStock).toBe(50);
      expect(res.data[res.data.length - 1].productId).toBe(negative);
    });

    it('treats search wildcards literally', async () => {
      const res = await run({ search: `${tag}%` });
      expect(res.total).toBe(0);
    });

    it('hides cost price from non-admins and ignores cost-price sorting for them', async () => {
      const bySku = await run({}, staff());
      const byCost = await run({ sort: 'costPrice', dir: 'desc' }, staff());
      expect(bySku.data.every((r) => r.costPrice === null)).toBe(true);
      expect(byCost.data.map((r) => r.productId)).toEqual(bySku.data.map((r) => r.productId));
    });

    it('still returns the full array when no page is requested', async () => {
      const all = await sessions.summary(orgId, admin());
      expect(Array.isArray(all)).toBe(true);
    });
  });

  // ---- Line item tenant check -------------------------------------------

  it('rejects a line item location from another organization', async () => {
    const productId = await makeProduct();
    const other = await prisma.organization.create({ data: { name: `Other ${randomUUID()}` } });
    const foreignLoc = await prisma.location.create({ data: { name: 'Foreign', organizationId: other.id } });
    const pricing = module.get(LineItemPricingService);
    await expect(
      pricing.priceLines(orgId, [{ productId, locationId: foreignLoc.id, quantity: 1 }]),
    ).rejects.toThrow(/line item locations were not found/);
  });

  // ---- Returns linked to the original sale ------------------------------

  describe('returns linked to an invoice', () => {
    let invOrg: string;
    let invUser: string;
    let invLoc: string;
    let invProduct: string;
    let invoices: InvoiceService;
    const PRICE = 100_000;

    beforeAll(async () => {
      invoices = module.get(InvoiceService);
      const org = await prisma.organization.create({ data: { name: `Returns Test ${randomUUID()}` } });
      invOrg = org.id;
      await module.get(ChartOfAccountsSeedService).seedDefaults(invOrg);
      await prisma.organizationModule.createMany({
        data: [
          { organizationId: invOrg, module: ModuleKey.WAREHOUSE_OPS },
          { organizationId: invOrg, module: ModuleKey.INVOICE_POS },
        ],
      });
      invUser = (await prisma.user.create({
        data: { email: `returns-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: invOrg },
      })).id;
      invLoc = (await prisma.location.create({ data: { name: 'Main', organizationId: invOrg } })).id;
      const cat = await prisma.category.create({ data: { name: 'General', organizationId: invOrg } });
      invProduct = (await prisma.product.create({
        data: {
          name: 'Brake Pad', sku: `BP-${randomUUID().slice(0, 8)}`, categoryId: cat.id,
          organizationId: invOrg, sellingPrice: PRICE, costPrice: COST,
        },
      })).id;
      await prisma.stock.create({ data: { productId: invProduct, locationId: invLoc, organizationId: invOrg, quantity: 10 } });
    });

    async function balance(key: SystemAccountKey) {
      const account = await prisma.chartOfAccount.findUniqueOrThrow({
        where: { organizationId_systemKey: { organizationId: invOrg, systemKey: key } },
      });
      const sums = await prisma.journalEntryLine.aggregate({
        where: { accountId: account.id, journalEntry: { status: JournalEntryStatus.POSTED } },
        _sum: { debit: true, credit: true },
      });
      return Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0);
    }

    // Issue → the invoice's FULFILLMENT session picks `picked` units.
    async function soldAndPicked(quantity: number, picked: number) {
      const draft = await invoices.createDraft(invOrg, invUser, {
        locationId: invLoc, format: InvoiceFormat.A4, customerName: 'Walk-in',
        items: [{ productId: invProduct, locationId: invLoc, quantity }],
      } as any);
      await invoices.issue(invOrg, draft.id, invUser, 'ADMIN');
      const fulfil = await prisma.session.findFirstOrThrow({ where: { invoiceId: draft.id } });
      if (picked > 0) {
        await sessions.addItem(invOrg, fulfil.id, invProduct, picked, invLoc, undefined, undefined, invUser);
      }
      return draft.id;
    }

    const startReturn = (invoiceId: string) =>
      sessions.create(invOrg, SessionType.RETURNS, undefined, undefined, { returnInvoiceId: invoiceId });
    const scanReturn = (sessionId: string, n: number) =>
      sessions.addItem(invOrg, sessionId, invProduct, n, undefined, invLoc, 'DEFECTIVE', invUser);
    const stockNow = async () =>
      Number((await prisma.stock.findUniqueOrThrow({
        where: { productId_locationId: { productId: invProduct, locationId: invLoc } },
      })).quantity);

    it('records warehouse picks as fulfilment on the invoice', async () => {
      const invoiceId = await soldAndPicked(2, 2);
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true } });
      expect(invoice.items[0].fulfilledQuantity).toBe(2);
      expect(invoice.fulfillmentStatus).toBe(FulfillmentStatus.FULFILLED);
    });

    it('requires an invoice when the organization invoices', async () => {
      await expect(sessions.create(invOrg, SessionType.RETURNS)).rejects.toThrow(/Choose the invoice/);
    });

    it('returns stock, reverses revenue and COGS, and caps at what went out', async () => {
      const invoiceId = await soldAndPicked(2, 2);
      const session = await startReturn(invoiceId);
      const stockBefore = await stockNow();
      const revenueBefore = await balance(SystemAccountKey.SALES_REVENUE);
      const cogsBefore = await balance(SystemAccountKey.COST_OF_GOODS_SOLD);

      await scanReturn(session.id, 1);

      expect(await stockNow()).toBe(stockBefore + 1);
      expect(await balance(SystemAccountKey.COST_OF_GOODS_SOLD)).toBeCloseTo(cogsBefore - COST);
      // Revenue is credit-normal, so a reversal moves the debit-positive balance up.
      expect(await balance(SystemAccountKey.SALES_REVENUE)).toBeCloseTo(revenueBefore + PRICE);

      const item = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId } });
      expect(item.fulfilledQuantity).toBe(1);

      await expect(scanReturn(session.id, 2)).rejects.toThrow(/only 1 unit/);

      // A second returns session for the same invoice shares the same ceiling.
      const second = await startReturn(invoiceId);
      await scanReturn(second.id, 1);
      await expect(scanReturn(second.id, 1)).rejects.toThrow(/already been returned/);

      const detail = await sessions.findOne(invOrg, second.id);
      expect(detail.returnLines).toEqual([expect.objectContaining({ sold: 2, returnable: 0, returnedHere: 1 })]);
    });

    it('cannot return what was never picked', async () => {
      const invoiceId = await soldAndPicked(3, 1);
      const session = await startReturn(invoiceId);
      await expect(scanReturn(session.id, 2)).rejects.toThrow(/only 1 unit/);
    });

    it('refuses an unfulfilled or draft invoice, and one from another organization', async () => {
      const unpicked = await soldAndPicked(1, 0);
      // SESSION path claimed at issue, but nothing picked yet.
      const session = await startReturn(unpicked);
      await expect(scanReturn(session.id, 1)).rejects.toThrow(/already been returned|only 0/);

      const draft = await invoices.createDraft(invOrg, invUser, {
        locationId: invLoc, format: InvoiceFormat.A4, customerName: 'Walk-in',
        items: [{ productId: invProduct, locationId: invLoc, quantity: 1 }],
      } as any);
      await expect(startReturn(draft.id)).rejects.toThrow(/not issued/);

      const foreignOrg = await prisma.organization.create({ data: { name: `Other ${randomUUID()}` } });
      await expect(
        sessions.create(foreignOrg.id, SessionType.RETURNS, undefined, undefined, { returnInvoiceId: unpicked }),
      ).rejects.toThrow(/Invoice not found/);
    });

    it('refuses an invoice fulfilled by delivery order', async () => {
      const invoiceId = await soldAndPicked(1, 1);
      await prisma.invoice.update({ where: { id: invoiceId }, data: { fulfillmentPath: 'DELIVERY_ORDER' } });
      await expect(startReturn(invoiceId)).rejects.toThrow(/delivery order/);
    });
  });
});
