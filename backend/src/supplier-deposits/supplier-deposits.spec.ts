import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SystemAccountKey } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { JournalService } from '../accounting/journal.service';
import { SupplierPaymentsService } from '../accounting/supplier-payments.service';
import { SupplierDepositsModule } from './supplier-deposits.module';
import { SupplierDepositsService } from './supplier-deposits.service';

describe('Supplier down payments', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let deposits: SupplierDepositsService;
  let payments: SupplierPaymentsService;
  let journal: JournalService;
  let orgId: string;
  let supplierId: string;
  let otherSupplier: string;
  let branchA: string;
  let branchB: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, AccountingModule, SupplierDepositsModule] }).compile();
    prisma = module.get(PrismaService);
    deposits = module.get(SupplierDepositsService);
    payments = module.get(SupplierPaymentsService);
    journal = module.get(JournalService);
    orgId = (await prisma.organization.create({ data: { name: `UMB ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    branchA = (await prisma.branch.create({ data: { organizationId: orgId, name: 'Pusat' } })).id;
    branchB = (await prisma.branch.create({ data: { organizationId: orgId, name: 'Timur' } })).id;
    supplierId = (await prisma.supplier.create({ data: { organizationId: orgId, name: 'PT Pasok' } })).id;
    otherSupplier = (await prisma.supplier.create({ data: { organizationId: orgId, name: 'PT Lain' } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  const accountId = async (systemKey: SystemAccountKey) =>
    (await prisma.chartOfAccount.findFirstOrThrow({ where: { organizationId: orgId, systemKey } })).id;
  const balanceOf = async (key: SystemAccountKey) => {
    const sum = await prisma.journalEntryLine.aggregate({
      where: { accountId: await accountId(key), journalEntry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    return Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0);
  };

  // A PO whose goods have arrived: AP credited by a posted receipt.
  async function receivedPo(amount: number, supplier = supplierId) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, password: 'x', organizationId: orgId } });
    const location = await prisma.location.create({ data: { organizationId: orgId, name: `G-${randomUUID().slice(0, 5)}` } });
    const po = await prisma.purchaseOrder.create({ data: { organizationId: orgId, supplierId: supplier, poNumber: `PO-${randomUUID().slice(0, 6)}`, total: amount, subtotal: amount } });
    const receipt = await prisma.goodsReceipt.create({ data: { organizationId: orgId, purchaseOrderId: po.id, locationId: location.id, userId: user.id } });
    await journal.postEntry(orgId, {
      date: new Date(),
      sourceType: 'GOODS_RECEIPT',
      sourceId: receipt.id,
      lines: [
        { accountId: await accountId('INVENTORY'), debit: amount },
        { accountId: await accountId('ACCOUNTS_PAYABLE'), credit: amount },
      ],
    });
    return po;
  }

  it('holds money paid as an asset, without touching AP', async () => {
    const d = await deposits.create(orgId, { supplierId, amount: 500_000, date: '2026-03-01', branchId: branchA, method: 'CASH' });
    expect(d.depositNumber).toMatch(/^UMB-2026-\d{5}$/);
    expect(d.remaining).toBe(500_000);
    expect(await balanceOf('SUPPLIER_ADVANCES')).toBe(500_000);
    expect(await balanceOf('CASH')).toBe(-500_000);
    expect(await balanceOf('ACCOUNTS_PAYABLE')).toBe(0);
  });

  it("can't be set against a PO before anything is owed", async () => {
    const d = (await deposits.list(orgId, { supplierId, open: true })).data[0];
    const po = await prisma.purchaseOrder.create({ data: { organizationId: orgId, supplierId, poNumber: `PO-${randomUUID().slice(0, 6)}` } });
    await expect(deposits.apply(orgId, d.id, po.id, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('settles AP without moving cash, up to what both sides allow, and shows on the PO', async () => {
    const d = (await deposits.list(orgId, { supplierId, open: true })).data[0];
    const po = await receivedPo(300_000);
    expect(await deposits.openForPurchaseOrder(orgId, po.id)).toEqual([expect.objectContaining({ id: d.id, remaining: 500_000 })]);
    const cash = await balanceOf('CASH');
    await deposits.apply(orgId, d.id, po.id, undefined);
    expect(await payments.getOutstanding(orgId, po.id)).toBe(0);
    expect(await balanceOf('CASH')).toBe(cash);
    expect(await balanceOf('SUPPLIER_ADVANCES')).toBe(200_000);
    expect(await balanceOf('ACCOUNTS_PAYABLE')).toBe(0);
    expect((await deposits.list(orgId, { supplierId, open: true })).data[0]).toMatchObject({ appliedAmount: 300_000, remaining: 200_000 });
  });

  it('refuses another supplier, too much, and another branch', async () => {
    const d = (await deposits.list(orgId, { supplierId, open: true })).data[0];
    const theirs = await receivedPo(10_000, otherSupplier);
    await expect(deposits.apply(orgId, d.id, theirs.id, 1_000)).rejects.toBeInstanceOf(BadRequestException);
    const big = await receivedPo(900_000);
    await expect(deposits.apply(orgId, d.id, big.id, 250_000)).rejects.toBeInstanceOf(BadRequestException);
    await expect(deposits.apply(orgId, d.id, big.id, 1_000, undefined, branchB)).rejects.toBeInstanceOf(NotFoundException);
    expect(await deposits.openForPurchaseOrder(orgId, big.id, branchB)).toEqual([]);
  });

  it('puts the money back when that payment is voided', async () => {
    const d = (await deposits.list(orgId, { supplierId, open: true })).data[0];
    const po = await receivedPo(100_000);
    const payment = await deposits.apply(orgId, d.id, po.id, 100_000);
    expect(await balanceOf('SUPPLIER_ADVANCES')).toBe(100_000);
    await payments.void(orgId, payment.id, undefined, 'salah');
    expect(await balanceOf('SUPPLIER_ADVANCES')).toBe(200_000);
    expect(await payments.getOutstanding(orgId, po.id)).toBe(100_000);
    expect((await deposits.list(orgId, { supplierId, open: true })).data[0].remaining).toBe(200_000);
  });

  it('takes a refund of what is left, and only that', async () => {
    const d = (await deposits.list(orgId, { supplierId, open: true })).data[0];
    const cash = await balanceOf('CASH');
    await expect(deposits.refund(orgId, d.id, { amount: 999_999, method: 'CASH' })).rejects.toBeInstanceOf(BadRequestException);
    const r = await deposits.refund(orgId, d.id, { amount: 50_000, method: 'CASH' });
    expect(r.remaining).toBe(150_000);
    expect(await balanceOf('CASH')).toBe(cash + 50_000);
    expect(await balanceOf('SUPPLIER_ADVANCES')).toBe(150_000);
  });

  it('voids only an untouched down payment', async () => {
    const used = (await deposits.list(orgId, { supplierId, open: true })).data[0];
    await expect(deposits.voidDeposit(orgId, used.id, 'x')).rejects.toBeInstanceOf(BadRequestException);
    const fresh = await deposits.create(orgId, { supplierId, amount: 77_000, date: '2026-03-05', branchId: branchB, method: 'CASH' });
    const before = await balanceOf('SUPPLIER_ADVANCES');
    await deposits.voidDeposit(orgId, fresh.id, 'salah input');
    expect(await balanceOf('SUPPLIER_ADVANCES')).toBe(before - 77_000);
    expect((await deposits.list(orgId, { supplierId, open: true })).data.some((x) => x.id === fresh.id)).toBe(false);
  });

  it('requires a bank account unless paid in cash', async () => {
    await expect(deposits.create(orgId, { supplierId, amount: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('makes its account for a business set up before this existed', async () => {
    const org = (await prisma.organization.create({ data: { name: `Old ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(org);
    await prisma.chartOfAccount.update({
      where: { organizationId_systemKey: { organizationId: org, systemKey: 'SUPPLIER_ADVANCES' } },
      data: { systemKey: null },
    });
    const s = await prisma.supplier.create({ data: { organizationId: org, name: 'X' } });
    await deposits.create(org, { supplierId: s.id, amount: 1_000, date: '2026-03-01', method: 'CASH' });
    const made = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { organizationId_systemKey: { organizationId: org, systemKey: 'SUPPLIER_ADVANCES' } },
    });
    expect(made).toMatchObject({ code: '1401', type: 'ASSET', normalBalance: 'DEBIT' });
  });
});
