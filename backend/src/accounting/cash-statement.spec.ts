import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceFormat, JournalSourceType, PaymentMethod, PurchaseOrderStatus, SystemAccountKey } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from './chart-of-accounts-seed.service';
import { AccountingModule } from './accounting.module';
import { AccountingReportsService } from './accounting-reports.service';
import { JournalService } from './journal.service';
import { CashStatementService } from './cash-statement.service';
import { SupplierPaymentsModule } from './supplier-payments.module';
import { SupplierPaymentsService } from './supplier-payments.service';
import { GoodsReceiptModule } from '../goods-receipt/goods-receipt.module';
import { GoodsReceiptService } from '../goods-receipt/goods-receipt.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { PaymentsModule } from '../payments/payment.module';
import { PaymentService } from '../payments/payment.service';

jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// The cash & bank statement, built from real payments against the
// isolated test DB (test/setup-test-env.ts).
describe('Cash & bank statement', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let statements: CashStatementService;

  let orgId: string;
  let cashId: string;
  let bcaGlId: string;
  let invoiceNumber: string;
  let poNumber: string | null;

  const today = () => new Date(new Date().toISOString().slice(0, 10));

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, AccountingModule, InvoiceModule, PaymentsModule, SupplierPaymentsModule, GoodsReceiptModule],
    }).compile();
    prisma = module.get(PrismaService);
    statements = module.get(CashStatementService);

    orgId = (await prisma.organization.create({ data: { name: `Statement ${randomUUID()}`, timezone: 'UTC' } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    const userId = (
      await prisma.user.create({
        data: { email: `st-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    const rack = (await prisma.location.create({ data: { name: 'Rack', organizationId: orgId } })).id;
    const categoryId = (await prisma.category.create({ data: { name: 'General', organizationId: orgId } })).id;
    const productId = (
      await prisma.product.create({
        data: { name: 'Tyre', sku: `T-${randomUUID().slice(0, 8)}`, categoryId, organizationId: orgId, sellingPrice: 500_000 },
      })
    ).id;
    await prisma.stock.create({ data: { productId, locationId: rack, organizationId: orgId, quantity: 10 } });
    const customerId = (await prisma.customer.create({ data: { name: 'Budi', organizationId: orgId } })).id;
    const supplierId = (await prisma.supplier.create({ data: { name: 'PT Ban', organizationId: orgId } })).id;
    cashId = (
      await prisma.chartOfAccount.findUniqueOrThrow({
        where: { organizationId_systemKey: { organizationId: orgId, systemKey: SystemAccountKey.CASH } },
      })
    ).id;
    const bca = await prisma.organizationBankAccount.create({
      data: { organizationId: orgId, bankName: 'BCA', accountNumber: '8800123', accountName: 'Toko' },
    });
    bcaGlId = (
      await prisma.chartOfAccount.create({
        data: { organizationId: orgId, code: '1110', name: 'BCA 8800123', type: 'ASSET', normalBalance: 'DEBIT', bankAccountId: bca.id },
      })
    ).id;

    // A sale of Rp 1.000.000: 400k cash, 600k QRIS into BCA.
    const invoices = module.get(InvoiceService);
    const draft = await invoices.createDraft(orgId, userId, {
      locationId: rack,
      format: InvoiceFormat.A4,
      customerId,
      customerName: 'Budi',
      items: [{ productId, locationId: rack, quantity: 2 }],
    } as any);
    await invoices.issue(orgId, draft.id, userId, 'ADMIN');
    invoiceNumber = (await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })).invoiceNumber!;
    await module.get(PaymentService).recordSplit(orgId, draft.id, [
      { amount: 400_000, method: PaymentMethod.CASH },
      { amount: 600_000, method: PaymentMethod.QRIS, bankAccountId: bca.id },
    ]);

    // A supplier bill for 4 tyres, received and paid from BCA.
    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        supplierId,
        locationId: rack,
        poNumber: `PO-${randomUUID().slice(0, 5)}`,
        status: PurchaseOrderStatus.SENT,
        subtotal: 1_200_000,
        total: 1_200_000,
        items: { create: [{ productId, quantity: 4, unitCost: 300_000, lineTotal: 1_200_000 }] },
      },
      include: { items: true },
    });
    poNumber = po.poNumber;
    await module.get(GoodsReceiptService).receive(orgId, userId, po.id, {
      locationId: rack,
      items: [{ purchaseOrderItemId: po.items[0].id, quantity: 4 }],
    });
    await prisma.supplierBill.create({
      data: { organizationId: orgId, purchaseOrderId: po.id, supplierId, billNumber: 'SB-77', billDate: today(), amount: 1_200_000 },
    });
    await module.get(SupplierPaymentsService).create(orgId, userId, {
      purchaseOrderId: po.id,
      amount: 500_000,
      method: PaymentMethod.TRANSFER,
      bankAccountId: bca.id,
    } as any);

    // Owner moves Rp 100.000 of cash into BCA.
    await module.get(JournalService).postEntry(orgId, {
      date: new Date(),
      memo: 'Deposit cash to BCA',
      sourceType: JournalSourceType.MANUAL,
      lines: [
        { accountId: bcaGlId, debit: 100_000 },
        { accountId: cashId, credit: 100_000 },
      ],
    });
  });

  afterAll(async () => {
    await module?.close();
  });

  it('lists each account with what every line was, and balances that add up', async () => {
    const st = await statements.getStatement(orgId, today(), today());
    const cash = st.accounts.find((a) => a.accountId === cashId)!;
    const bca = st.accounts.find((a) => a.accountId === bcaGlId)!;

    expect(bca).toMatchObject({ bankName: 'BCA', accountNumber: '8800123', opening: 0, moneyIn: 700_000, moneyOut: 500_000, closing: 200_000 });
    expect(cash).toMatchObject({ moneyIn: 400_000, moneyOut: 100_000, closing: 300_000 });

    const receipt = bca.lines.find((l) => l.kind === 'CUSTOMER_PAYMENT')!;
    expect(receipt).toMatchObject({ party: 'Budi', reference: invoiceNumber, method: 'QRIS', moneyIn: 600_000 });
    expect(receipt.link?.type).toBe('invoice');

    const paid = bca.lines.find((l) => l.kind === 'SUPPLIER_PAYMENT')!;
    expect(paid).toMatchObject({ party: 'PT Ban', reference: poNumber, detail: 'SB-77', moneyOut: 500_000 });

    const transferIn = bca.lines.find((l) => l.kind === 'TRANSFER')!;
    expect(transferIn.moneyIn).toBe(100_000);
    expect(transferIn.detail).toBe(cash.name);

    // Running balance ends at the closing balance.
    expect(bca.lines[bca.lines.length - 1].balance).toBe(bca.closing);
    expect(st.totals).toMatchObject({ moneyIn: 1_100_000, moneyOut: 600_000, closing: 500_000 });
  });

  it('agrees with the account ledger', async () => {
    const st = await statements.getStatement(orgId, today(), today(), bcaGlId);
    expect(st.accounts).toHaveLength(1);
    const ledger = await module.get(AccountingReportsService).getAccountLedger(orgId, bcaGlId, today(), today());
    expect(st.accounts[0].closing).toBe(ledger.closingBalance);
  });

  it('carries the closing balance into the next period as opening', async () => {
    const tomorrow = new Date(today().getTime() + 86_400_000);
    const st = await statements.getStatement(orgId, tomorrow, tomorrow, bcaGlId);
    expect(st.accounts[0]).toMatchObject({ opening: 200_000, moneyIn: 0, moneyOut: 0, closing: 200_000, lines: [] });
  });

  it('refuses an account that is not cash or bank', async () => {
    const revenue = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { organizationId_systemKey: { organizationId: orgId, systemKey: SystemAccountKey.SALES_REVENUE } },
    });
    await expect(statements.getStatement(orgId, today(), today(), revenue.id)).rejects.toThrow('cash or bank');
  });
});
