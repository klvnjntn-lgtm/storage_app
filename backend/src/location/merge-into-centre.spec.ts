import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { mergeOrgIntoCentre } from './merge-into-centre';

// Against the isolated test DB (test/setup-test-env.ts).
describe('Merging an org into CENTRE', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function org() {
    const organizationId = (await prisma.organization.create({ data: { name: `Merge ${randomUUID().slice(0, 6)}` } })).id;
    const branchId = (await prisma.branch.create({ data: { organizationId, name: 'Toko A' } })).id;
    const categoryId = (await prisma.category.create({ data: { organizationId, name: 'Parts' } })).id;
    const product = (await prisma.product.create({
      data: { organizationId, categoryId, name: 'Filter', sku: `F-${randomUUID().slice(0, 8)}`, sellingPrice: 10_000 },
    })).id;
    return { organizationId, branchId, product };
  }

  it('renames a lone location to CENTRE and leaves it at that', async () => {
    const { organizationId } = await org();
    const loc = await prisma.location.create({ data: { id: `${organizationId}_toko`, name: 'Toko', organizationId } });
    const dry = await mergeOrgIntoCentre(prisma, organizationId, { apply: false });
    expect(dry.centre).toMatchObject({ id: loc.id, action: 'rename' });
    expect((await prisma.location.findUniqueOrThrow({ where: { id: loc.id } })).name).toBe('Toko');

    await mergeOrgIntoCentre(prisma, organizationId, { apply: true });
    expect((await prisma.location.findUniqueOrThrow({ where: { id: loc.id } })).name).toBe('CENTRE');
  });

  it('sums stock into CENTRE, archives the rest and moves open drafts, keeping history', async () => {
    const { organizationId, branchId, product } = await org();
    const a = await prisma.location.create({ data: { id: `${organizationId}_a`, name: 'Toko A', organizationId, branchId } });
    const b = await prisma.location.create({ data: { id: `${organizationId}_b`, name: 'Toko B', organizationId, branchId } });
    await prisma.stock.create({ data: { organizationId, productId: product, locationId: a.id, quantity: 3 } });
    await prisma.stock.create({ data: { organizationId, productId: product, locationId: b.id, quantity: 4 } });
    const draft = await prisma.invoice.create({
      data: { organizationId, locationId: b.id, status: 'DRAFT', format: 'A4', subtotal: 0, total: 0 },
    });
    const issued = await prisma.invoice.create({
      data: { organizationId, locationId: b.id, status: 'ISSUED', format: 'A4', subtotal: 0, total: 0 },
    });

    const plan = await mergeOrgIntoCentre(prisma, organizationId, { apply: true });
    expect(plan.centre.action).toBe('create');

    const centre = await prisma.location.findFirstOrThrow({ where: { organizationId, name: 'CENTRE', archivedAt: null } });
    const stock = await prisma.stock.findMany({ where: { organizationId } });
    expect(stock.map((s) => [s.locationId, Number(s.quantity)])).toEqual([[centre.id, 7]]);
    const archived = await prisma.location.findMany({ where: { organizationId, archivedAt: { not: null } } });
    expect(archived.map((l) => l.name).sort()).toEqual(['Toko A', 'Toko B']);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })).locationId).toBe(centre.id);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: issued.id } })).locationId).toBe(b.id);
  });

  it('skips an org with a transfer still on the road', async () => {
    const { organizationId, branchId } = await org();
    const a = await prisma.location.create({ data: { id: `${organizationId}_a`, name: 'A', organizationId, branchId } });
    const b = await prisma.location.create({ data: { id: `${organizationId}_b`, name: 'B', organizationId, branchId } });
    const createdById = (
      await prisma.user.create({
        data: { email: `m-${randomUUID()}@example.com`, password: 'x', role: 'ADMIN', organizationId },
      })
    ).id;
    await prisma.stockTransfer.create({
      data: { organizationId, fromLocationId: a.id, toLocationId: b.id, status: 'IN_TRANSIT', createdById },
    });
    const plan = await mergeOrgIntoCentre(prisma, organizationId, { apply: true });
    expect(plan.skipped).toMatch(/transfer/);
    expect(await prisma.location.count({ where: { organizationId, archivedAt: null } })).toBe(2);
  });
});
