import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ChartOfAccountsSeedService } from '../../accounting/chart-of-accounts-seed.service';
import { InvoiceModule } from '../../invoice/invoice.module';
import { InvoiceService } from '../../invoice/invoice.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// The invoice list's one search box: plate typed any way, the salesperson,
// a product on the invoice. Against the isolated test DB.
describe('Invoice list search', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoiceService;
  let orgId: string;
  let invoiceId: string;
  let budiId: string;
  let vehicleId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, InvoiceModule] }).compile();
    prisma = module.get(PrismaService);
    invoices = module.get(InvoiceService);
    orgId = (await prisma.organization.create({ data: { name: `Search ${randomUUID().slice(0, 6)}` } })).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.createMany({
      data: ['INVOICE_POS', 'WORKSHOP_RMS'].map((m) => ({ organizationId: orgId, module: m as never, enabled: true })),
    });
    const userId = (
      await prisma.user.create({
        data: { email: `s-${randomUUID()}@example.com`, password: 'x', role: 'MASTER', organizationId: orgId },
      })
    ).id;
    const customerId = (await prisma.customer.create({ data: { organizationId: orgId, name: 'Pak Andi' } })).id;
    vehicleId = (
      await prisma.vehicle.create({
        data: { organizationId: orgId, customerId, plateNumber: 'B 1234 XY', plateNormalized: 'B1234XY', vehicleModel: 'Avanza' },
      })
    ).id;
    budiId = (await prisma.employee.create({ data: { organizationId: orgId, name: 'Budi Santoso', baseSalary: 0 } })).id;
    invoiceId = (
      await invoices.createDraft(orgId, userId, {
        format: 'A4',
        customerId,
        customerName: 'Pak Andi',
        vehicleId,
        employeeId: budiId,
        items: [{ description: 'Ganti kampas rem depan', quantity: 1, unitPrice: 150_000 }],
      } as never)
    ).id;
    // Noise: another invoice that matches none of the searches.
    await invoices.createDraft(orgId, userId, {
      format: 'A4',
      customerName: 'Walk-in',
      items: [{ description: 'Cuci mobil', quantity: 1, unitPrice: 50_000 }],
    } as never);
  });

  afterAll(async () => {
    await module?.close();
  });

  const found = async (search: string) => (await invoices.list(orgId, { search })).data.map((i) => i.id);

  it.each(['B1234XY', 'b 1234 xy', 'B-1234', '1234 XY'])('finds the car by plate typed as %s', async (term) => {
    expect(await found(term)).toEqual([invoiceId]);
  });

  it('finds it by salesperson and by what was on it', async () => {
    expect(await found('budi')).toEqual([invoiceId]);
    expect(await found('kampas rem')).toEqual([invoiceId]);
  });

  it('filters by salesperson', async () => {
    expect((await invoices.list(orgId, { employeeId: budiId })).data.map((i) => i.id)).toEqual([invoiceId]);
  });

  // Not search, but the same invoice: a draft keeps its reading after the car came back higher.
  it('saves an old draft with its unchanged odometer, and still refuses a lower new one', async () => {
    await invoices.updateDraft(orgId, invoiceId, { odometer: 60_000 } as never);
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { odometer: 61_000 } });
    await expect(invoices.updateDraft(orgId, invoiceId, { odometer: 60_000, notes: 'x' } as never)).resolves.toBeTruthy();
    await expect(invoices.updateDraft(orgId, invoiceId, { odometer: 59_000 } as never)).rejects.toThrow('cannot be lower');
  });
});
