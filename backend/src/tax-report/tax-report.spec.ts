import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, JournalSourceType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { TaxReportModule } from './tax-report.module';
import { TaxReportService } from './tax-report.service';

describe('Laporan Pajak', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: TaxReportService;
  let orgId: string;
  let userId: string;
  let branchA: string;
  let branchB: string;
  let locationA: string;
  let customerWithNpwp: string;
  let customerNoNpwp: string;
  let supplierId: string;
  let supplierNoNpwp: string;
  let categoryId: string;

  const MONTH = '2026-10';

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, TaxReportModule] }).compile();
    prisma = module.get(PrismaService);
    service = module.get(TaxReportService);
    orgId = (await prisma.organization.create({ data: { name: `Lapor ${randomUUID()}`, timezone: 'Asia/Jakarta' } })).id;
    userId = (
      await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, password: 'x', organizationId: orgId } })
    ).id;
    branchA = (await prisma.branch.create({ data: { organizationId: orgId, name: 'Pusat' } })).id;
    branchB = (await prisma.branch.create({ data: { organizationId: orgId, name: 'Cabang' } })).id;
    locationA = (await prisma.location.create({ data: { organizationId: orgId, name: 'Gudang', branchId: branchA } })).id;
    customerWithNpwp = (
      await prisma.customer.create({ data: { name: 'PT Beli', organizationId: orgId, npwp: '3171012345678901', address: 'Jl. A' } })
    ).id;
    customerNoNpwp = (await prisma.customer.create({ data: { name: 'Budi', organizationId: orgId } })).id;
    supplierId = (await prisma.supplier.create({ data: { organizationId: orgId, name: 'PT Pasok', npwp: '3171099999999999' } })).id;
    supplierNoNpwp = (await prisma.supplier.create({ data: { organizationId: orgId, name: 'Toko Pasok' } })).id;
    categoryId = (await prisma.expenseCategory.create({ data: { organizationId: orgId, name: 'Listrik' } })).id;

    // --- October sales ---
    await invoice({ number: 'A-1', customerId: customerWithNpwp, branchId: branchA, total: 100_000, date: '2026-10-05' });
    await invoice({ number: 'A-2', customerId: customerNoNpwp, branchId: branchB, total: 50_000, date: '2026-10-06' });
    await invoice({ number: 'A-3', customerId: null, branchId: branchA, total: 30_000, date: '2026-10-07' });
    await invoice({ number: 'A-4', customerId: customerNoNpwp, branchId: branchA, total: 70_000, date: '2026-10-08', status: InvoiceStatus.VOID });
    // Accurate-style: no invoiceDate; 31 Oct 20:00 Jakarta is 13:00 UTC.
    await invoice({ number: 'A-5', customerId: null, branchId: branchA, total: 10_000, issuedAt: new Date('2026-10-31T13:00:00Z') });
    await invoice({ number: 'A-6', customerId: null, branchId: null, total: 5_000, date: '2026-10-09' });
    // --- Outside the month ---
    await invoice({ number: 'Z-1', customerId: null, branchId: branchA, total: 999, date: '2026-11-01' });
    // 1 Nov 01:00 Jakarta is still 31 Oct in UTC: belongs to November.
    await invoice({ number: 'Z-2', customerId: null, branchId: branchA, total: 999, issuedAt: new Date('2026-10-31T18:00:00Z') });
    await invoice({ number: 'Z-3', customerId: null, branchId: branchA, total: 999, date: '2026-10-10', status: InvoiceStatus.DRAFT });
  });

  afterAll(async () => {
    await module?.close();
  });

  async function invoice(o: {
    number: string;
    customerId: string | null;
    branchId: string | null;
    total: number;
    date?: string;
    issuedAt?: Date;
    status?: InvoiceStatus;
  }) {
    return prisma.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber: `${o.number}-${orgId.slice(0, 6)}`,
        format: 'A4',
        status: o.status ?? InvoiceStatus.ISSUED,
        customerId: o.customerId,
        customerName: o.customerId ? null : 'Umum',
        branchId: o.branchId,
        invoiceDate: o.date ? new Date(`${o.date}T00:00:00Z`) : null,
        issuedAt: o.issuedAt ?? null,
        subtotal: o.total,
        total: o.total,
        items: {
          create: [
            { description: 'Jasa', quantity: 2, unit: 'pcs', unitPrice: o.total / 2, lineTotal: o.total, netAmount: o.total, total: o.total },
          ],
        },
      },
    });
  }

  const number = (s: { invoiceNumber: string | null }) => s.invoiceNumber!.split('-').slice(0, 2).join('-');

  it('lists the month by business date, with voids shown but not totalled', async () => {
    const report = await service.report(orgId, MONTH);
    expect(report.sales.map(number)).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'A-6', 'A-5']);
    expect(report.sales.find((s) => number(s) === 'A-5')!.date).toBe('2026-10-31');
    expect(report.sales.find((s) => number(s) === 'A-4')!.status).toBe('VOID');
    expect(report.summary.sales).toMatchObject({ count: 5, total: 195_000 });
    expect(report.summary.voidedInvoices).toBe(1);
    expect(report.branch).toBeNull();
  });

  it('uses the NPWP on the customer when the invoice has no snapshot, and counts only real customers as missing', async () => {
    const report = await service.report(orgId, MONTH);
    const a1 = report.sales.find((s) => number(s) === 'A-1')!;
    expect(a1.customerNpwp).toBe('3171012345678901');
    expect(a1.customerName).toBe('PT Beli');
    expect(a1.customerAddress).toBe('Jl. A');
    // Budi is missing; walk-ins (no customer) don't count.
    expect(report.notes.customersMissingNpwp).toBe(1);
  });

  it('treats a customer named CASH as a walk-in, not a missing NPWP', async () => {
    const cash = await prisma.customer.create({ data: { name: 'CASH', organizationId: orgId } });
    const inv = await invoice({ number: 'C-1', customerId: cash.id, branchId: branchA, total: 1_000, date: '2026-10-11' });
    const report = await service.report(orgId, MONTH);
    expect(report.notes.customersMissingNpwp).toBe(1);
    expect(report.sales.find((s) => s.id === inv.id)!.needsNpwp).toBe(false);
    expect(report.sales.find((s) => number(s) === 'A-2')!.needsNpwp).toBe(true);
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
    await prisma.invoice.delete({ where: { id: inv.id } });
  });

  it('works the item total back from the total when an import stored 0, and flags lines that do not add up', async () => {
    const imported = await prisma.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber: `IMP-${randomUUID().slice(0, 6)}`,
        format: 'A4',
        status: InvoiceStatus.ISSUED,
        branchId: branchA,
        issuedAt: new Date('2026-10-12T05:00:00Z'),
        subtotal: 0,
        total: 90_000,
        items: {
          // netAmount never filled in; the lines come to 100k, the invoice to 90k.
          create: [{ description: 'Oli', quantity: 1, unitPrice: 100_000, lineTotal: 100_000, netAmount: 0, total: 0 }],
        },
      },
    });
    const report = await service.report(orgId, MONTH, undefined, true);
    const row = report.sales.find((s) => s.id === imported.id)!;
    expect(row.subtotal).toBe(90_000);
    expect(row.linesDiffer).toBe(true);
    expect((row as unknown as { items: { net: number }[] }).items[0].net).toBe(100_000);
    expect(report.summary.linesDiffer).toBe(1);
    expect(report.sales.find((s) => number(s) === 'A-1')!.linesDiffer).toBe(false);
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: imported.id } });
    await prisma.invoice.delete({ where: { id: imported.id } });
  });

  it('narrows every section to one branch and reports what could not be placed', async () => {
    const expense = await prisma.expense.create({
      data: { organizationId: orgId, categoryId, amount: 40_000, expenseDate: new Date('2026-10-15T00:00:00Z'), branchId: branchB },
    });
    const looseExpense = await prisma.expense.create({
      data: { organizationId: orgId, categoryId, amount: 7_000, expenseDate: new Date('2026-10-16T00:00:00Z') },
    });
    const report = await service.report(orgId, MONTH, branchB);
    expect(report.branch).toEqual({ id: branchB, name: 'Cabang' });
    expect(report.sales.map(number)).toEqual(['A-2']);
    expect(report.summary.sales.total).toBe(50_000);
    expect(report.expenses.map((e) => e.id)).toEqual([expense.id]);
    expect(report.notes.unassigned.sales).toEqual({ count: 1, total: 5_000 });
    expect(report.notes.unassigned.expenses).toEqual({ count: 1, total: 7_000 });

    const whole = await service.report(orgId, MONTH);
    expect(whole.expenses.map((e) => e.id)).toEqual(expect.arrayContaining([expense.id, looseExpense.id]));
    expect(whole.notes.unassigned.expenses).toEqual({ count: 0, total: 0 });
    await prisma.expense.deleteMany({ where: { id: { in: [expense.id, looseExpense.id] } } });
  });

  it('refuses a branch from another business', async () => {
    const other = await prisma.organization.create({ data: { name: `Other ${randomUUID()}` } });
    const foreign = await prisma.branch.create({ data: { organizationId: other.id, name: 'Lain' } });
    await expect(service.report(orgId, MONTH, foreign.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a bad month', async () => {
    await expect(service.report(orgId, '2026-13')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.report(orgId, '')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('places purchases by the PO branch, falling back to its location, and leaves voided bills out of totals', async () => {
    const po = (data: { supplierId: string; branchId?: string; locationId?: string }) =>
      prisma.purchaseOrder.create({ data: { organizationId: orgId, poNumber: `PO-${randomUUID().slice(0, 6)}`, ...data } });
    const inB = await po({ supplierId, branchId: branchB });
    const viaLocation = await po({ supplierId: supplierNoNpwp, locationId: locationA });
    const loose = await po({ supplierId });
    const bill = (purchaseOrderId: string, sid: string, amount: number, voidedAt?: Date) =>
      prisma.supplierBill.create({
        data: {
          organizationId: orgId,
          purchaseOrderId,
          supplierId: sid,
          billNumber: `B-${randomUUID().slice(0, 6)}`,
          billDate: new Date('2026-10-20T00:00:00Z'),
          amount,
          voidedAt,
        },
      });
    await bill(inB.id, supplierId, 111_000);
    await bill(viaLocation.id, supplierNoNpwp, 22_000);
    await bill(loose.id, supplierId, 3_000);
    await bill(inB.id, supplierId, 500_000, new Date());

    const whole = await service.report(orgId, MONTH);
    expect(whole.purchases).toHaveLength(4);
    expect(whole.summary.purchases).toEqual({ count: 3, total: 136_000 });
    expect(whole.notes.suppliersMissingNpwp).toBe(1);

    const a = await service.report(orgId, MONTH, branchA);
    expect(a.purchases.map((p) => p.amount)).toEqual([22_000]);
    expect(a.purchases[0].branch).toBe('Pusat');
    expect(a.notes.unassigned.purchases).toEqual({ count: 1, total: 3_000 });

    const b = await service.report(orgId, MONTH, branchB);
    expect(b.summary.purchases).toEqual({ count: 1, total: 111_000 });
  });

  it('warns about goods received in the month with no bill', async () => {
    const po = await prisma.purchaseOrder.create({
      data: { organizationId: orgId, poNumber: 'PO-UNBILLED', supplierId, branchId: branchA },
    });
    await prisma.goodsReceipt.create({
      data: {
        organizationId: orgId,
        purchaseOrderId: po.id,
        locationId: locationA,
        userId,
        createdAt: new Date('2026-10-22T05:00:00Z'),
      },
    });
    const a = await service.report(orgId, MONTH, branchA);
    expect(a.notes.receivedWithoutBill).toEqual([{ poNumber: 'PO-UNBILLED', supplierName: 'PT Pasok' }]);
    const b = await service.report(orgId, MONTH, branchB);
    expect(b.notes.receivedWithoutBill).toEqual([]);
  });

  it('lists purchase returns in the month they happened', async () => {
    const po = await prisma.purchaseOrder.create({
      data: { organizationId: orgId, poNumber: 'PO-RET', supplierId, branchId: branchB },
    });
    await prisma.purchaseReturn.create({
      data: {
        organizationId: orgId,
        purchaseOrderId: po.id,
        locationId: locationA,
        userId,
        returnNumber: `PR-${randomUUID().slice(0, 6)}`,
        subtotal: 11_000,
        taxAmount: 0,
        total: 11_000,
        createdAt: new Date('2026-10-23T05:00:00Z'),
      },
    });
    const b = await service.report(orgId, MONTH, branchB);
    expect(b.purchaseReturns).toHaveLength(1);
    expect(b.purchaseReturns[0]).toMatchObject({ amount: 11_000, supplierName: 'PT Pasok', date: '2026-10-23' });
    expect(b.summary.purchaseReturns).toEqual({ count: 1, total: 11_000 });
    expect(b.summary.netPurchases).toBe(100_000);
  });

  it('traces sales returns to their invoice through sessions and delivery orders', async () => {
    const period = await prisma.fiscalPeriod.create({ data: { organizationId: orgId, year: 2026, month: 10 } });
    const account = await prisma.chartOfAccount.create({
      data: { organizationId: orgId, code: `1-${randomUUID().slice(0, 5)}`, name: 'AR', type: 'ASSET', normalBalance: 'DEBIT' } as never,
    });
    const sold = await prisma.invoice.findFirstOrThrow({ where: { organizationId: orgId, invoiceNumber: { startsWith: 'A-1-' } } });
    const session = await prisma.session.create({
      data: { organizationId: orgId, type: 'RETURNS', returnInvoiceId: sold.id },
    });
    const deliveryOrder = await prisma.deliveryOrder.create({
      data: { organizationId: orgId, invoiceId: sold.id, branchId: branchA } as never,
    });
    const entry = (sourceId: string, credit: number, memo: string, date = '2026-10-25') =>
      prisma.journalEntry.create({
        data: {
          organizationId: orgId,
          entryDate: new Date(`${date}T00:00:00Z`),
          sourceType: JournalSourceType.INVOICE,
          sourceId,
          memo,
          fiscalPeriodId: period.id,
          lines: { create: [{ accountId: account.id, credit }] },
        },
      });
    await entry(`${session.id}:sales-return:1`, 10_000, 'via session');
    await entry(`${deliveryOrder.id}:sales-return:1`, 5_000, 'via DO');
    await entry(`${randomUUID()}:sales-return:1`, 2_000, 'untraceable');
    // An ordinary invoice posting isn't a return.
    await entry(sold.id, 100_000, 'the sale itself');

    const report = await service.report(orgId, MONTH);
    expect(report.salesReturns).toHaveLength(3);
    const viaSession = report.salesReturns.find((r) => r.memo === 'via session')!;
    expect(viaSession).toMatchObject({ amount: 10_000, customerName: 'PT Beli', customerNpwp: '3171012345678901', branch: 'Pusat' });
    expect(viaSession.invoiceNumber).toBe(sold.invoiceNumber);
    expect(report.salesReturns.find((r) => r.memo === 'via DO')!.invoiceNumber).toBe(sold.invoiceNumber);
    expect(report.salesReturns.find((r) => r.memo === 'untraceable')!.invoiceNumber).toBeNull();
    expect(report.summary.salesReturns.total).toBe(17_000);
    expect(report.summary.netSales).toBe(report.summary.sales.total - 17_000);

    const b = await service.report(orgId, MONTH, branchB);
    expect(b.salesReturns).toHaveLength(0);
  });

  it('flags invoices changed after the month ended, but not payments or changes within it', async () => {
    const find = (n: string) => prisma.invoice.findFirstOrThrow({ where: { organizationId: orgId, invoiceNumber: { startsWith: `${n}-` } } });
    const a2 = await find('A-2');
    const a3 = await find('A-3');
    const a6 = await find('A-6');
    const event = (invoiceId: string, eventType: 'EDITED' | 'PAYMENT_RECORDED', createdAt: string) =>
      prisma.invoiceActivityEvent.create({ data: { invoiceId, organizationId: orgId, eventType, createdAt: new Date(createdAt) } });
    await event(a2.id, 'EDITED', '2026-11-03T05:00:00Z');
    await event(a3.id, 'EDITED', '2026-10-20T05:00:00Z');
    await event(a6.id, 'PAYMENT_RECORDED', '2026-11-03T05:00:00Z');

    const report = await service.report(orgId, MONTH);
    const row = (n: string) => report.sales.find((s) => number(s) === n)!;
    expect(row('A-2').changedAfterPeriod).toBe(true);
    expect(row('A-3').changedAfterPeriod).toBe(false);
    expect(row('A-3').lastChangedAt).not.toBeNull();
    expect(row('A-6').lastChangedAt).toBeNull();
    expect(report.summary.changedAfterPeriod).toBe(1);
  });

  it('adds invoice lines only when asked, and only for issued invoices', async () => {
    const plain = await service.report(orgId, MONTH);
    expect('items' in plain.sales[0]).toBe(false);
    const detailed = await service.report(orgId, MONTH, undefined, true);
    const row = (n: string) => detailed.sales.find((s) => number(s) === n)! as unknown as { items: { name: string; quantity: number; net: number }[] };
    expect(row('A-1').items).toEqual([expect.objectContaining({ name: 'Jasa', quantity: 2, net: 100_000 })]);
    expect(row('A-4').items).toEqual([]);
  });

  it('computes no tax, and prints the business answer on whether prices include PPN', async () => {
    let report = await service.report(orgId, MONTH);
    expect(report.business.pricesIncludePpn).toBeNull();
    expect(report.summary.sales.tax).toBe(0);
    await prisma.organization.update({ where: { id: orgId }, data: { pricesIncludePpn: true } });
    report = await service.report(orgId, MONTH);
    expect(report.business.pricesIncludePpn).toBe(true);
    expect(report.summary.sales.tax).toBe(0);
  });
});
