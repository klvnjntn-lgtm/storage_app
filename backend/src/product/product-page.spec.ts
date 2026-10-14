import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitsModule } from '../billing/plan-limits.module';
import { ProductService } from './product.service';

// The paged, server-sorted product list (admin products page).
describe('ProductService.findPage (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let products: ProductService;
  let orgId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, PlanLimitsModule],
      providers: [ProductService],
    }).compile();
    prisma = module.get(PrismaService);
    products = module.get(ProductService);
    orgId = (
      await prisma.organization.create({
        data: { name: `Page ${randomUUID()}` },
      })
    ).id;
    const category = await prisma.category.create({
      data: { name: 'Parts', organizationId: orgId },
    });
    const loc = await prisma.location.create({
      data: { id: `${orgId}_l`, name: 'L', organizationId: orgId },
    });
    for (let i = 1; i <= 25; i++) {
      const p = await prisma.product.create({
        data: {
          name: `Item ${String(i).padStart(2, '0')}`,
          sku: `SKU-${i}`,
          categoryId: category.id,
          organizationId: orgId,
          costPrice: i,
        },
      });
      await prisma.stock.create({
        data: {
          productId: p.id,
          locationId: loc.id,
          organizationId: orgId,
          quantity: (i * 7) % 25,
        },
      });
    }
    await prisma.product.create({
      data: {
        name: '100%_special',
        sku: 'PCT',
        categoryId: category.id,
        organizationId: orgId,
      },
    });
  });

  afterAll(async () => {
    await module?.close();
  });

  it('pages and counts', async () => {
    const first = await products.findPage(orgId, {
      page: 1,
      pageSize: 10,
      includeCost: false,
    });
    expect(first.total).toBe(26);
    expect(first.data).toHaveLength(10);
    expect(first.data[0].name).toBe('100%_special');
    expect(first.data[0]).not.toHaveProperty('costPrice');
    const third = await products.findPage(orgId, {
      page: 3,
      pageSize: 10,
      includeCost: true,
    });
    expect(third.data).toHaveLength(6);
    expect(third.data[0]).toHaveProperty('costPrice');
  });

  it('sorts by stock total in the database', async () => {
    const { data } = await products.findPage(orgId, {
      page: 1,
      pageSize: 26,
      sort: 'stock',
      dir: 'desc',
      includeCost: false,
    });
    const stocks = data.map((d) => d.totalStock);
    expect(stocks).toEqual([...stocks].sort((a, b) => b - a));
  });

  it('searches literally, so % and _ are not wildcards', async () => {
    expect(
      (
        await products.findPage(orgId, {
          page: 1,
          pageSize: 50,
          q: '%',
          includeCost: false,
        })
      ).total,
    ).toBe(1);
    expect(
      (
        await products.findPage(orgId, {
          page: 1,
          pageSize: 50,
          q: '%',
          sort: 'stock',
          includeCost: false,
        })
      ).data,
    ).toHaveLength(1);
    expect(
      (
        await products.findPage(orgId, {
          page: 1,
          pageSize: 50,
          q: 'sku-1',
          includeCost: false,
        })
      ).total,
    ).toBe(11);
  });

  it('checks SKU availability case-insensitively', async () => {
    expect(await products.isSkuTaken(orgId, 'sku-3')).toEqual({ taken: true });
    expect(await products.isSkuTaken(orgId, 'nope')).toEqual({ taken: false });
  });
});
