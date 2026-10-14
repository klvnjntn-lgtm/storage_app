import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  InvoiceFormat,
  PurchaseOrderStatus,
  SerialStatus,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { AccountingModule } from '../accounting/accounting.module';
import { GoodsReceiptModule } from '../goods-receipt/goods-receipt.module';
import { GoodsReceiptService } from '../goods-receipt/goods-receipt.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { PurchaseReturnModule } from '../purchase-return/purchase-return.module';
import { PurchaseReturnService } from '../purchase-return/purchase-return.service';
import { StockTransferModule } from '../stock-transfer/stock-transfer.module';
import { StockTransferService } from '../stock-transfer/stock-transfer.service';
import { SerialsModule } from './serials.module';
import { SerialsService } from './serials.service';
import { normalizeSerials } from './serial-moves';

process.env.PRINT_TOKEN_SECRET ??= 'test-print-secret';
// Puppeteer is ESM-only and never used here (no PDFs rendered).
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

describe('normalizeSerials', () => {
  it('trims, drops blanks and refuses duplicates', () => {
    expect(normalizeSerials([' A1 ', '', 'B2'])).toEqual(['A1', 'B2']);
    expect(() => normalizeSerials(['A1', 'A1'])).toThrow(/listed twice/);
  });
});

// One serial-tracked product through every document that moves units.
// Isolated test DB, fresh org without WAREHOUSE_OPS (invoices take stock).
describe('Serial numbers (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let receipts: GoodsReceiptService;
  let invoices: InvoiceService;
  let returns: PurchaseReturnService;
  let transfers: StockTransferService;
  let serials: SerialsService;

  let orgId: string;
  let adminId: string;
  let mainId: string;
  let branchId: string;
  let productId: string;
  let poItemId: string;
  let poId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AccountingModule,
        GoodsReceiptModule,
        InvoiceModule,
        PurchaseReturnModule,
        StockTransferModule,
        SerialsModule,
      ],
    }).compile();
    prisma = module.get(PrismaService);
    receipts = module.get(GoodsReceiptService);
    invoices = module.get(InvoiceService);
    returns = module.get(PurchaseReturnService);
    transfers = module.get(StockTransferService);
    serials = module.get(SerialsService);

    orgId = (
      await prisma.organization.create({
        data: { name: `Serials ${randomUUID()}` },
      })
    ).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({
      data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true },
    });
    adminId = (
      await prisma.user.create({
        data: {
          email: `ser-${randomUUID()}@example.com`,
          password: 'x',
          role: 'ADMIN',
          organizationId: orgId,
        },
      })
    ).id;
    mainId = (
      await prisma.location.create({
        data: { id: `${orgId}_main`, name: 'Main', organizationId: orgId },
      })
    ).id;
    branchId = (
      await prisma.location.create({
        data: { id: `${orgId}_branch`, name: 'Branch', organizationId: orgId },
      })
    ).id;
    const category = await prisma.category.create({
      data: { name: 'Phones', organizationId: orgId },
    });
    productId = (
      await prisma.product.create({
        data: {
          name: 'Phone X',
          sku: `PX-${randomUUID().slice(0, 6)}`,
          categoryId: category.id,
          organizationId: orgId,
          sellingPrice: 3_000_000,
          trackSerials: true,
        },
      })
    ).id;
    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        locationId: mainId,
        status: PurchaseOrderStatus.SENT,
        subtotal: 10_000_000,
        total: 10_000_000,
        items: {
          create: [
            {
              productId,
              quantity: 5,
              unitCost: 2_000_000,
              lineTotal: 10_000_000,
            },
          ],
        },
      },
      include: { items: true },
    });
    poId = po.id;
    poItemId = po.items[0].id;
  });

  afterAll(async () => {
    await module?.close();
  });

  const status = async (serial: string) =>
    prisma.productSerial.findUniqueOrThrow({
      where: { productId_serialNumber: { productId, serialNumber: serial } },
    });

  it('needs one serial per unit received, and refuses one already in stock', async () => {
    await expect(
      receipts.receive(orgId, adminId, poId, {
        locationId: mainId,
        items: [
          { purchaseOrderItemId: poItemId, quantity: 2, serialNumbers: ['S1'] },
        ],
      }),
    ).rejects.toThrow(/need 2 serial/);

    await receipts.receive(orgId, adminId, poId, {
      locationId: mainId,
      items: [
        {
          purchaseOrderItemId: poItemId,
          quantity: 4,
          serialNumbers: ['S1', 'S2', 'S3', 'S4'],
        },
      ],
    });
    expect(await status('S1')).toMatchObject({
      status: SerialStatus.IN_STOCK,
      locationId: mainId,
    });

    await expect(
      receipts.receive(orgId, adminId, poId, {
        locationId: mainId,
        items: [
          { purchaseOrderItemId: poItemId, quantity: 1, serialNumbers: ['S2'] },
        ],
      }),
    ).rejects.toThrow(/Already in stock: S2/);
  });

  it('sells the named units on issue, puts them back on void, and blocks edits', async () => {
    const draft = (serialNumbers?: string[]) =>
      invoices.createDraft(orgId, adminId, {
        locationId: mainId,
        format: InvoiceFormat.A4,
        items: [
          {
            productId,
            locationId: mainId,
            quantity: 1,
            ...(serialNumbers && { serialNumbers }),
          },
        ],
      } as any);

    const withoutSerial = await draft();
    await expect(
      invoices.issue(orgId, withoutSerial.id, adminId, 'ADMIN'),
    ).rejects.toThrow(/need 1 serial/);

    const wrongPlace = await draft(['NOPE']);
    await expect(
      invoices.issue(orgId, wrongPlace.id, adminId, 'ADMIN'),
    ).rejects.toThrow(/Not in stock at this location: NOPE/);

    const sale = await draft(['S1']);
    await invoices.issue(orgId, sale.id, adminId, 'ADMIN');
    expect(await status('S1')).toMatchObject({
      status: SerialStatus.SOLD,
      invoiceId: sale.id,
    });

    await expect(
      invoices.editIssuedInvoice(orgId, sale.id, { items: [] } as any, adminId),
    ).rejects.toThrow(/void it and issue a new one/);

    await invoices.voidInvoice(orgId, sale.id, 'Wrong customer', adminId);
    expect(await status('S1')).toMatchObject({
      status: SerialStatus.IN_STOCK,
      invoiceId: null,
    });

    const history = await serials.history(orgId, (await status('S2')).id);
    expect(history.receipt?.purchaseOrder.id).toBe(poId);
  });

  it('sends named units back to the supplier', async () => {
    await expect(
      returns.create(orgId, adminId, poId, {
        locationId: mainId,
        items: [{ purchaseOrderItemId: poItemId, quantity: 1 }],
      }),
    ).rejects.toThrow(/need 1 serial/);
    const ret = await returns.create(orgId, adminId, poId, {
      locationId: mainId,
      items: [
        { purchaseOrderItemId: poItemId, quantity: 1, serialNumbers: ['S4'] },
      ],
    });
    expect(await status('S4')).toMatchObject({
      status: SerialStatus.RETURNED_TO_SUPPLIER,
      purchaseReturnId: ret.id,
    });
  });

  it('moves units between locations and writes off the ones that never arrive', async () => {
    const tr = await transfers.create(orgId, adminId, {
      fromLocationId: mainId,
      toLocationId: branchId,
      items: [{ productId, quantity: 2, serialNumbers: ['S2', 'S3'] }],
    });
    await transfers.ship(orgId, tr.id, adminId);
    expect(await status('S2')).toMatchObject({
      status: SerialStatus.IN_TRANSIT,
      locationId: null,
    });

    await expect(
      transfers.receive(orgId, tr.id, adminId, {
        items: [{ itemId: tr.items[0].id, receivedQuantity: 1 }],
      }),
    ).rejects.toThrow(/List the 1 serial/);
    await transfers.receive(orgId, tr.id, adminId, {
      items: [
        { itemId: tr.items[0].id, receivedQuantity: 1, missingSerials: ['S3'] },
      ],
    });
    expect(await status('S2')).toMatchObject({
      status: SerialStatus.IN_STOCK,
      locationId: branchId,
    });
    expect((await status('S3')).status).toBe(SerialStatus.WRITTEN_OFF);
  });

  it('registers units already on the shelf and finds them by serial', async () => {
    await serials.register(orgId, productId, mainId, ['OLD-1', 'OLD-2']);
    await expect(
      serials.register(orgId, productId, mainId, ['OLD-1']),
    ).rejects.toThrow(/Already registered/);
    const found = await serials.search(orgId, { q: 'old-' });
    expect(found.map((f) => f.serialNumber).sort()).toEqual(['OLD-1', 'OLD-2']);
    expect(
      (await serials.available(orgId, productId, mainId)).map(
        (s) => s.serialNumber,
      ),
    ).toEqual(['OLD-1', 'OLD-2', 'S1']);
  });
});
