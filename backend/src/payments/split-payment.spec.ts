import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InvoiceFormat, PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { PaymentsModule } from './payment.module';
import { PaymentService } from './payment.service';

jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// One payment split across methods at checkout, against the isolated
// test DB (test/setup-test-env.ts).
describe('Split payments', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoiceService;
  let payments: PaymentService;

  let orgId: string;
  let adminId: string;
  let rack: string;
  let productId: string;
  let ppnId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, InvoiceModule, PaymentsModule] }).compile();
    prisma = module.get(PrismaService);
    invoices = module.get(InvoiceService);
    payments = module.get(PaymentService);

    orgId = (await prisma.organization.create({ data: { name: `Split ${randomUUID()}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    adminId = (
      await prisma.user.create({
        data: { email: `split-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    rack = (await prisma.location.create({ data: { name: 'Rack', organizationId: orgId } })).id;
    const categoryId = (await prisma.category.create({ data: { name: 'General', organizationId: orgId } })).id;
    productId = (
      await prisma.product.create({
        data: { name: 'Helmet', sku: `H-${randomUUID().slice(0, 8)}`, categoryId, organizationId: orgId, sellingPrice: 100_000 },
      })
    ).id;
    await prisma.stock.create({ data: { productId, locationId: rack, organizationId: orgId, quantity: 100 } });
    ppnId = (await prisma.organizationTaxRate.create({ data: { organizationId: orgId, name: 'PPN', percentage: 11 } })).id;
    bankAccountId = (
      await prisma.organizationBankAccount.create({
        data: { organizationId: orgId, bankName: 'BCA', accountNumber: '123', accountName: 'Toko' },
      })
    ).id;
    await prisma.chartOfAccount.create({
      data: { organizationId: orgId, code: '1110', name: 'BCA', type: 'ASSET', normalBalance: 'DEBIT', bankAccountId },
    });
  });

  afterAll(async () => {
    await module?.close();
  });

  async function issued(quantity: number) {
    const draft = await invoices.createDraft(orgId, adminId, {
      locationId: rack,
      format: InvoiceFormat.A4,
      items: [{ productId, locationId: rack, quantity, taxRateIds: [ppnId] }],
    } as any);
    await invoices.issue(orgId, draft.id, adminId, 'ADMIN');
    return draft.id;
  }

  it('records every part at once, or none when the total is too much', async () => {
    const id = await issued(2); // Rp 222.000
    await expect(
      payments.recordSplit(orgId, id, [
        { amount: 200_000, method: PaymentMethod.CASH },
        { amount: 50_000, method: PaymentMethod.QRIS, bankAccountId },
      ]),
    ).rejects.toThrow(BadRequestException);
    expect(await prisma.payment.count({ where: { invoiceId: id } })).toBe(0);

    const result = await payments.recordSplit(orgId, id, [
      { amount: 100_000, method: PaymentMethod.CASH },
      { amount: 122_000, method: PaymentMethod.QRIS, bankAccountId },
    ]);
    expect(result.paymentStatus).toBe(PaymentStatus.PAID);
    expect(result.payments).toHaveLength(2);
  });

  it('rolls back every part when one is invalid', async () => {
    const id = await issued(1);
    await expect(
      payments.recordSplit(orgId, id, [
        { amount: 50_000, method: PaymentMethod.CASH },
        { amount: 10_000, method: PaymentMethod.TRANSFER },
      ]),
    ).rejects.toThrow('bankAccountId');
    expect(await prisma.payment.count({ where: { invoiceId: id } })).toBe(0);
  });
});
