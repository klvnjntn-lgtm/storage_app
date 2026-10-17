import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceFormat, InvoiceStatus, PinSource } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageModule } from '../storage/storage.module';
import { CustomersModule } from './customers.module';
import { CustomersService, CUSTOMER_RECENT_INVOICES } from './customers.service';

type Page = { data: { name: string; phone: string | null }[]; total: number; page: number; pageSize: number };

describe('Customer list and detail (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let customers: CustomersService;
  let orgId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, StorageModule, CustomersModule] }).compile();
    prisma = module.get(PrismaService);
    customers = module.get(CustomersService);
    orgId = (await prisma.organization.create({ data: { name: `Customers ${randomUUID()}` } })).id;

    // Names sort Andi < Budi < Cahya < Dewi < Eka; phones in the reverse order.
    const pins = {
      none: {},
      manual: { latitude: -6.2, longitude: 106.8, pinSource: PinSource.MANUAL },
      gps: { latitude: -6.2, longitude: 106.8, pinSource: PinSource.GPS, pinAccuracy: 12 },
      weak: { latitude: -6.2, longitude: 106.8, pinSource: PinSource.GPS, pinAccuracy: 80 },
    };
    await prisma.customer.createMany({
      data: [
        { name: 'Andi', phone: '0815', ...pins.gps },
        { name: 'Budi', phone: '0814', ...pins.weak },
        { name: 'Cahya', phone: '0813', ...pins.manual },
        { name: 'Dewi', phone: null, ...pins.none },
        { name: 'Eka', phone: '0811', ...pins.gps },
      ].map((c) => ({ ...c, organizationId: orgId })),
    });
  });

  afterAll(async () => {
    await module?.close();
  });

  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it('keeps the plain-array response without page, capped by limit', async () => {
    const all = (await customers.list(orgId)) as { name: string }[];
    expect(names(all)).toEqual(['Andi', 'Budi', 'Cahya', 'Dewi', 'Eka']);
    expect(names((await customers.list(orgId, undefined, { limit: 2 })) as { name: string }[])).toEqual([
      'Andi',
      'Budi',
    ]);
  });

  it('pages on the server with the true total', async () => {
    const p2 = (await customers.list(orgId, undefined, { page: 2, pageSize: 2 })) as Page;
    expect(p2).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(names(p2.data)).toEqual(['Cahya', 'Dewi']);
  });

  it('filters by pin status, and combines it with a search', async () => {
    const byPin = async (pin: string, q?: string) =>
      names(((await customers.list(orgId, q, { page: 1, pin })) as Page).data);
    expect(await byPin('NONE')).toEqual(['Dewi']);
    expect(await byPin('MANUAL')).toEqual(['Cahya']);
    expect(await byPin('GPS')).toEqual(['Andi', 'Eka']);
    expect(await byPin('WEAK_GPS')).toEqual(['Budi']);
    // Search and pin filter each use an OR — both must still apply.
    expect(await byPin('GPS', 'Eka')).toEqual(['Eka']);
    expect(await byPin('GPS', 'Budi')).toEqual([]);
  });

  it('sorts by name or phone, empty phones last either way', async () => {
    const sorted = async (sort: string, dir: string) =>
      names(((await customers.list(orgId, undefined, { page: 1, sort, dir })) as Page).data);
    expect(await sorted('name', 'desc')).toEqual(['Eka', 'Dewi', 'Cahya', 'Budi', 'Andi']);
    expect(await sorted('phone', 'asc')).toEqual(['Eka', 'Cahya', 'Budi', 'Andi', 'Dewi']);
    expect(await sorted('phone', 'desc')).toEqual(['Andi', 'Budi', 'Cahya', 'Eka', 'Dewi']);
  });

  it('returns recent invoices only, with count and totals over all of them', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Loyal', organizationId: orgId } });
    const invoice = (total: number, amountPaid: number, status: InvoiceStatus = InvoiceStatus.ISSUED) => ({
      organizationId: orgId,
      customerId: customer.id,
      format: InvoiceFormat.A4,
      status,
      total,
      amountPaid,
    });
    await prisma.invoice.createMany({
      data: [
        ...Array.from({ length: CUSTOMER_RECENT_INVOICES }, () => invoice(1_000, 1_000)),
        invoice(5_000, 2_000),
        invoice(3_000, 4_000), // overpaid: counts as 0 outstanding, not -1000
        invoice(9_000, 0, InvoiceStatus.VOID), // excluded from totals
      ],
    });

    const detail = await customers.getWithInvoices(orgId, customer.id);
    expect(detail.invoices).toHaveLength(CUSTOMER_RECENT_INVOICES);
    expect(detail.invoiceCount).toBe(CUSTOMER_RECENT_INVOICES + 3);
    expect(detail.invoiceTotals).toEqual({
      total: CUSTOMER_RECENT_INVOICES * 1_000 + 8_000,
      paid: CUSTOMER_RECENT_INVOICES * 1_000 + 6_000,
      outstanding: 3_000,
    });
  });
});
