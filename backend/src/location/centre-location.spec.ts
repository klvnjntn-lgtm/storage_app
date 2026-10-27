import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { LocationModule } from './location.module';
import { LocationService } from './location.service';
import { StockService, ImportMode } from '../stock/stock.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// Locations are a WAREHOUSE_OPS feature: every other org keeps its stock on
// one CENTRE location, against the isolated test DB.
describe('CENTRE location', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let locations: LocationService;
  let stock: StockService;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, InvoiceModule, LocationModule] }).compile();
    prisma = module.get(PrismaService);
    locations = module.get(LocationService);
    stock = module.get(StockService);
  });

  afterAll(async () => {
    await module?.close();
  });

  async function newOrg(warehouseOps: boolean) {
    const orgId = (await prisma.organization.create({ data: { name: `Loc ${randomUUID()}` } })).id;
    await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true } });
    if (warehouseOps) {
      await prisma.organizationModule.create({ data: { organizationId: orgId, module: 'WAREHOUSE_OPS', enabled: true } });
    }
    const userId = (
      await prisma.user.create({
        data: { email: `loc-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId: orgId },
      })
    ).id;
    return { orgId, userId };
  }

  it('gives an org with no locations its CENTRE, once', async () => {
    const { orgId } = await newOrg(false);
    const first = await locations.findAll(orgId);
    expect(first.map((l) => l.name)).toEqual(['CENTRE']);
    const again = await locations.findAll(orgId);
    expect(again.map((l) => l.id)).toEqual([first[0].id]);
  });

  it('imports into CENTRE without warehouse ops, whatever the file says', async () => {
    const { orgId, userId } = await newOrg(false);
    const sku = `C-${randomUUID().slice(0, 8)}`;
    const result = await stock.import(orgId, userId, ImportMode.INCREMENT, [
      { sku, name: 'Filter', category: 'General', location: 'Gudang Belakang', qty: 4 },
      { sku, name: 'Filter', category: 'General', location: '', qty: 1 },
    ]);
    expect(result.accepted).toHaveLength(2);
    const names = (await prisma.location.findMany({ where: { organizationId: orgId } })).map((l) => l.name);
    expect(names).toEqual(['CENTRE']);
    const rows = await prisma.stock.findMany({ where: { organizationId: orgId } });
    expect(rows.map((r) => Number(r.quantity))).toEqual([5]);
  });

  it('keeps per-location import for warehouse orgs', async () => {
    const { orgId, userId } = await newOrg(true);
    const sku = `W-${randomUUID().slice(0, 8)}`;
    await stock.import(orgId, userId, ImportMode.INCREMENT, [
      { sku, name: 'Filter', category: 'General', location: 'Gudang A', qty: 2 },
      { sku, name: 'Filter', category: 'General', location: 'Gudang B', qty: 3 },
    ]);
    const names = (await prisma.location.findMany({ where: { organizationId: orgId } })).map((l) => l.name).sort();
    expect(names).toEqual(['Gudang A', 'Gudang B']);
  });
});
