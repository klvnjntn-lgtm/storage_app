import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Brand, EventType } from '@prisma/client';

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  // -----------------------------
  // FIND ONE
  // -----------------------------
  async findOne(orgId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId: orgId },                // 🔒
      include: { category: true, brand: true },
    });

    if (!product) throw new BadRequestException('Product not found');
    return product;
  }

  // -----------------------------
  // FIND ALL
  // -----------------------------
  async findAll(orgId: string) {
    const products = await this.prisma.product.findMany({
      where: { organizationId: orgId },                    // 🔒
      include: { category: true, brand: true, stocks: true },
    });

    return products.map((product) => ({
      id: product.id,
      sku: product.sku,
      oem: product.oem,
      name: product.name,
      category: product.category.name,
      brand: product.brand?.name ?? null,
      totalStock: product.stocks.reduce((sum, s) => sum + s.quantity, 0),
      active: product.active,
    }));
  }

  // -----------------------------
  // GET EVENTS
  // -----------------------------
  async getEvents(orgId: string, productId: string) {
    // Confirm product belongs to org before returning its events
    await this.assertProductOwnership(orgId, productId);

const events = await this.prisma.event.findMany({
  where: { productId, organizationId: orgId },
  orderBy: { createdAt: 'desc' },
  include: {
    product: { select: { name: true, sku: true } },
    fromLocation: { select: { name: true } },
    toLocation: { select: { name: true } },
    session: { select: { id: true, type: true, status: true } },
    user: { select: { email: true } },   // ← moved inside include
  },
});

    return events.map((e) => ({
      id: e.id,
      type: e.type,
      quantity: e.quantity,
      createdAt: e.createdAt,
      product: e.product?.name ?? null,
      from: e.fromLocation?.name ?? null,
      to: e.toLocation?.name ?? null,
      reason: (e.metadata as any)?.reason ?? null,
      sessionId: e.session?.id ?? null,
      sessionType: e.session?.type ?? null,
      sessionStatus: e.session?.status ?? null,
      user: e.user ?? null,
    }));
  }

  // -----------------------------
  // CREATE
  // -----------------------------
  async create(
    orgId: string,
    data: {
      name: string;
      sku: string;
      oem?: string;
      category: string;
      brand?: string;
    },
  ) {
    const name = data.name.trim();
    const sku = data.sku.trim();
    const oem = data.oem?.trim() || undefined;
    const categoryName = data.category.trim();
    const brandName = data.brand?.trim();

    if (!name) throw new BadRequestException('Product name is required');
    if (!sku) throw new BadRequestException('SKU is required');
    if (!categoryName) throw new BadRequestException('Category is required');

    const category = await this.findOrCreateCategory(orgId, categoryName);
    const brand = brandName
      ? await this.findOrCreateBrand(orgId, brandName)
      : null;

    try {
      return await this.prisma.product.create({
        data: {
          name,
          sku,
          oem,
          categoryId: category.id,
          brandId: brand?.id ?? null,
          organizationId: orgId,                           // 🔒
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException(`A product with SKU "${sku}" already exists`);
      }
      throw err;
    }
  }

  // -----------------------------
  // SEARCH
  // -----------------------------
  async search(orgId: string, query: string) {
    const q = query.trim();

    if (!q) return { products: [], stocks: [], locations: [], events: [] };

    const eventType = Object.values(EventType).find(
      (v) => v.toLowerCase() === q.toLowerCase(),
    );

    const [products, stocks, locations, events] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          organizationId: orgId,                           // 🔒
          active: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { oem: { contains: q, mode: 'insensitive' } },
          ],
        },
        include: { category: true, brand: true },
        take: 20,
      }),

      this.prisma.stock.findMany({
        where: {
          organizationId: orgId,                           // 🔒
          OR: [
            { location: { name: { contains: q, mode: 'insensitive' } } },
            { product: { name: { contains: q, mode: 'insensitive' } } },
            { product: { sku: { contains: q, mode: 'insensitive' } } },
          ],
        },
        include: { product: true, location: true },
        take: 20,
      }),

      this.prisma.location.findMany({
        where: {
          organizationId: orgId,                           // 🔒
          name: { contains: q, mode: 'insensitive' },
        },
        take: 20,
      }),

      this.prisma.event.findMany({
        where: {
          organizationId: orgId,                           // 🔒
          OR: [
            { product: { name: { contains: q, mode: 'insensitive' } } },
            ...(eventType ? [{ type: eventType }] : []),
          ],
        },
        include: { product: true, fromLocation: true, toLocation: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return { products, stocks, locations, events };
  }

  // -----------------------------
  // UPDATE CATEGORY
  // -----------------------------
  async updateCategory(orgId: string, id: string, categoryId: string) {
    await this.assertProductOwnership(orgId, id);

    // Confirm the target category also belongs to this org
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId: orgId },   // 🔒
    });
    if (!category) throw new BadRequestException('Category not found');

    return this.prisma.product.update({
      where: { id },
      data: { categoryId },
    });
  }

  // -----------------------------
  // ARCHIVE / RESTORE
  // -----------------------------
  async archive(orgId: string, id: string) {
    await this.assertProductOwnership(orgId, id);
    return this.prisma.product.update({
      where: { id },
      data: { active: false },
    });
  }

  async restore(orgId: string, id: string) {
    await this.assertProductOwnership(orgId, id);
    return this.prisma.product.update({
      where: { id },
      data: { active: true },
    });
  }

  // -----------------------------
  // BULK IMPORT
  // -----------------------------
  async bulkImport(
    orgId: string,
    rows: {
      name: string;
      sku: string;
      oem?: string;
      category: string;
      brand?: string;
    }[],
  ) {
    const accepted: any[] = [];
    const rejected: any[] = [];

    for (const row of rows) {
      try {
        if (!row.name?.trim() || !row.category?.trim()) {
          rejected.push({ ...row, reason: 'missing name or category' });
          continue;
        }
        if (!row.sku?.trim()) {
          rejected.push({ ...row, reason: 'missing sku' });
          continue;
        }

        const name = row.name.trim();
        const sku = row.sku.trim();
        const oem = row.oem?.trim() || undefined;
        const categoryName = row.category.trim();
        const brandName = row.brand?.trim();

        const category = await this.findOrCreateCategory(orgId, categoryName);
        const brand: Brand | null = brandName
          ? await this.findOrCreateBrand(orgId, brandName)
          : null;

        // Scope SKU lookup to this org — two orgs can share the same SKU
        let product = await this.prisma.product.findFirst({
          where: { sku, organizationId: orgId },           // 🔒
        });

        if (!product) {
          product = await this.prisma.product.create({
            data: {
              name,
              sku,
              oem,
              categoryId: category.id,
              brandId: brand?.id ?? null,
              active: true,
              organizationId: orgId,                       // 🔒
            },
          });
        } else {
          product = await this.prisma.product.update({
            where: { id: product.id },                     // use id not sku — sku is no longer globally unique
            data: {
              name,
              oem,
              categoryId: category.id,
              brandId: brand?.id ?? null,
            },
          });
        }

        accepted.push({
          productId: product.id,
          name,
          sku,
          oem,
          category: category.name,
          brand: brand?.name ?? null,
        });
      } catch (err) {
        rejected.push({ ...row, reason: 'system error' });
      }
    }

    return { accepted, rejected };
  }

  // -----------------------------
  // PRIVATE HELPERS
  // -----------------------------

  // Matches by name within the org — prevents duplicates across create()
  // and bulkImport() for the same organization.
  private async findOrCreateCategory(orgId: string, name: string) {
    const trimmed = name.trim();

    const existing = await this.prisma.category.findFirst({
      where: {
        name: { equals: trimmed, mode: 'insensitive' },
        organizationId: orgId,                             // 🔒
      },
    });
    if (existing) return existing;

    return this.prisma.category.create({
      data: { name: trimmed, organizationId: orgId },      // 🔒
    });
  }

  private async findOrCreateBrand(orgId: string, name: string) {
    const trimmed = name.trim();

    const existing = await this.prisma.brand.findFirst({
      where: {
        name: { equals: trimmed, mode: 'insensitive' },
        organizationId: orgId,                             // 🔒
      },
    });
    if (existing) return existing;

    const id = `${orgId}_${trimmed.toLowerCase().replace(/\s+/g, '_')}`;
    return this.prisma.brand.create({
      data: { id, name: trimmed, organizationId: orgId },  // 🔒
    });
  }

  private async assertProductOwnership(orgId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Product not found');
  }
// product.service.ts
async findByBarcode(orgId: string, code: string) {
  const product = await this.prisma.product.findFirst({
    where: { sku: code, organizationId: orgId },
  });
  if (!product) throw new NotFoundException('Product not found for this code');
  return product;

}
}