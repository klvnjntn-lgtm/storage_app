import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, SystemAccountKey } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { PaymentService } from '../payments/payment.service';
import { CustomerDepositsModule } from './customer-deposits.module';
import { CustomerDepositsService } from './customer-deposits.service';

describe('Customer down payments', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let deposits: CustomerDepositsService;
  let payments: PaymentService;
  let orgId: string;
  let customerId: string;
  let otherCustomer: string;
  let branchA: string;
  let branchB: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, AccountingModule, CustomerDepositsModule] }).compile();
    prisma = module.get(PrismaService);
    deposits = module.get(CustomerDepositsService);
    payments = module.get(PaymentService);
    orgId = (await prisma.organization.create({ data: { name: `UM ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    branchA = (await prisma.branch.create({ data: { organizationId: orgId, name: 'Pusat' } })).id;
    branchB = (await prisma.branch.create({ data: { organizationId: orgId, name: 'Timur' } })).id;
    customerId = (await prisma.customer.create({ data: { name: 'PT Beli', organizationId: orgId } })).id;
    otherCustomer = (await prisma.customer.create({ data: { name: 'PT Lain', organizationId: orgId } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  const balanceOf = async (key: SystemAccountKey) => {
    const account = await prisma.chartOfAccount.findFirstOrThrow({ where: { organizationId: orgId, systemKey: key } });
    const sum = await prisma.journalEntryLine.aggregate({
      where: { accountId: account.id, journalEntry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    return Number(sum._sum.debit ?? 0) - Number(sum._sum.credit ?? 0);
  };

  const invoice = (total: number, cust = customerId, branchId = branchA) =>
    prisma.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
        format: 'A4',
        status: InvoiceStatus.ISSUED,
        customerId: cust,
        branchId,
        subtotal: total,
        total,
        invoiceDate: new Date('2026-03-10T00:00:00Z'),
      },
    });

  it('holds money received as a liability, with its own number', async () => {
    const d = await deposits.create(orgId, { customerId, amount: 500_000, date: '2026-03-01', branchId: branchA });
    expect(d.depositNumber).toMatch(/^UM-2026-\d{5}$/);
    expect(d.remaining).toBe(500_000);
    expect(await balanceOf('CASH')).toBe(500_000);
    expect(await balanceOf('CUSTOMER_DEPOSITS')).toBe(-500_000);
  });

  it('creates the account for a business set up before down payments existed', async () => {
    const org = (await prisma.organization.create({ data: { name: `Old ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(org);
    await prisma.chartOfAccount.update({
      where: { organizationId_systemKey: { organizationId: org, systemKey: 'CUSTOMER_DEPOSITS' } },
      data: { systemKey: null, code: '2500' },
    });
    const cust = await prisma.customer.create({ data: { name: 'X', organizationId: org } });
    await deposits.create(org, { customerId: cust.id, amount: 1_000, date: '2026-03-01' });
    const made = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { organizationId_systemKey: { organizationId: org, systemKey: 'CUSTOMER_DEPOSITS' } },
    });
    expect(made.code).toBe('2501');
    expect(made.type).toBe('LIABILITY');
  });

  it('pays an invoice from it without moving cash, up to what both sides allow', async () => {
    const d = (await deposits.list(orgId, { customerId, open: true })).data[0];
    const inv = await invoice(300_000);
    const cashBefore = await balanceOf('CASH');
    const paid = await payments.applyDeposit(orgId, inv.id, d.id, undefined, undefined);
    expect(paid.amountPaid).toBe(300_000);
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.payments[0].kind).toBe('DEPOSIT_IN');
    // AR falls by exactly what the invoice shows as paid.
    expect(await balanceOf('ACCOUNTS_RECEIVABLE')).toBe(-300_000);
    expect(await balanceOf('CASH')).toBe(cashBefore);
    expect(await balanceOf('CUSTOMER_DEPOSITS')).toBe(-200_000);
    const after = (await deposits.list(orgId, { customerId, open: true })).data[0];
    expect(after).toMatchObject({ appliedAmount: 300_000, remaining: 200_000 });
    // Fully paid now.
    await expect(payments.applyDeposit(orgId, inv.id, d.id, 1, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses another customer, too much, and another branch', async () => {
    const d = (await deposits.list(orgId, { customerId, open: true })).data[0];
    const theirs = await invoice(50_000, otherCustomer);
    await expect(payments.applyDeposit(orgId, theirs.id, d.id, 1_000, undefined)).rejects.toBeInstanceOf(BadRequestException);
    const big = await invoice(900_000);
    await expect(payments.applyDeposit(orgId, big.id, d.id, 250_000, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(payments.applyDeposit(orgId, big.id, d.id, 1_000, undefined, branchB)).rejects.toBeInstanceOf(NotFoundException);
    const inB = await invoice(10_000, customerId, branchB);
    await expect(payments.applyDeposit(orgId, inB.id, d.id, 1_000, undefined, branchB)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('offers open down payments on the invoice, within the branch asked for', async () => {
    const inv = await invoice(10_000);
    const info = await payments.getCreditInfo(orgId, inv.id);
    expect(info.deposits).toEqual([expect.objectContaining({ remaining: 200_000 })]);
    expect((await payments.getCreditInfo(orgId, inv.id, branchB)).deposits).toEqual([]);
  });

  it('puts the money back when the payment is voided', async () => {
    const d = (await deposits.list(orgId, { customerId, open: true })).data[0];
    const inv = await invoice(100_000);
    const paid = await payments.applyDeposit(orgId, inv.id, d.id, 100_000, undefined);
    expect(await balanceOf('CUSTOMER_DEPOSITS')).toBe(-100_000);
    const voided = await payments.voidPayment(orgId, inv.id, paid.payments[0].id, undefined, 'salah');
    expect(voided.amountPaid).toBe(0);
    expect(await balanceOf('CUSTOMER_DEPOSITS')).toBe(-200_000);
    const after = (await deposits.list(orgId, { customerId, open: true })).data[0];
    expect(after.remaining).toBe(200_000);
  });

  it('refunds what is left, and only that', async () => {
    const d = (await deposits.list(orgId, { customerId, open: true })).data[0];
    const cashBefore = await balanceOf('CASH');
    await expect(deposits.refund(orgId, d.id, { amount: 999_999 })).rejects.toBeInstanceOf(BadRequestException);
    const r = await deposits.refund(orgId, d.id, { amount: 50_000 });
    expect(r.remaining).toBe(150_000);
    expect(await balanceOf('CASH')).toBe(cashBefore - 50_000);
    expect(await balanceOf('CUSTOMER_DEPOSITS')).toBe(-150_000);
  });

  it('voids only an untouched down payment', async () => {
    const used = (await deposits.list(orgId, { customerId, open: true })).data[0];
    await expect(deposits.voidDeposit(orgId, used.id, 'x')).rejects.toBeInstanceOf(BadRequestException);

    const fresh = await deposits.create(orgId, { customerId, amount: 77_000, date: '2026-03-05', branchId: branchB });
    const before = await balanceOf('CUSTOMER_DEPOSITS');
    await expect(deposits.voidDeposit(orgId, fresh.id, 'x', undefined, branchA)).rejects.toBeInstanceOf(NotFoundException);
    const voided = await deposits.voidDeposit(orgId, fresh.id, 'salah input');
    expect(voided.voidedAt).toBeTruthy();
    expect(await balanceOf('CUSTOMER_DEPOSITS')).toBe(before + 77_000);
    const open = await deposits.list(orgId, { customerId, open: true });
    expect(open.data.some((x) => x.id === fresh.id)).toBe(false);
    const all = await deposits.list(orgId, { customerId });
    expect(all.data.some((x) => x.id === fresh.id)).toBe(true);
    const inB = await deposits.list(orgId, { branchId: branchB });
    expect(inB.data.map((x) => x.id)).toEqual([fresh.id]);
  });

  it('requires a bank account unless paid in cash', async () => {
    await expect(deposits.create(orgId, { customerId, amount: 1, method: 'TRANSFER' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
