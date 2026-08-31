// src/product/product.service.ts
import { Injectable, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Brand, EventType, Prisma } from '@prisma/client';

type Tx = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  constructor(private prisma: PrismaService) {}

  async findOne(organizationId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
      include: { category: true, brand: true },
    });

    if (!product) throw new BadRequestException('Product not found');
    return product;
  }

  async findAll(organizationId: string) {
    const products = await this.prisma.product.findMany({
      where: { organizationId },
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

  async getEvents(organizationId: string, productId: string) {
    await this.assertProductOwnership(organizationId, productId);

    const events = await this.prisma.event.findMany({
      where: { productId, organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { name: true, sku: true } },
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
        session: { select: { id: true, type: true, status: true } },
        user: { select: { email: true } },
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

  private validateLengths(row: {
    name: string;
    sku: string;
    oem?: string;
    category: string;
    brand?: string;
    barcode?: string;
  }) {
    if (row.sku.length > 100)
      throw new BadRequestException('SKU exceeds 100 characters');

    if (row.name.length > 255)
      throw new BadRequestException('Name exceeds 255 characters');

    if (row.category.length > 100)
      throw new BadRequestException('Category exceeds 100 characters');

    if (row.brand && row.brand.length > 100)
      throw new BadRequestException('Brand exceeds 100 characters');

    if (row.oem && row.oem.length > 100)
      throw new BadRequestException('OEM exceeds 100 characters');

    if (row.barcode && row.barcode.length > 100)
      throw new BadRequestException('Barcode exceeds 100 characters');
  }

async create(
  organizationId: string,
  data: {
    name: string;
    sku: string;
    oem?: string;
    category: string;
    brand?: string;
    barcode?: string;
    sellingPrice?: number;
    costPrice?: number;
  },
  tx: Tx = this.prisma,
) {
  const name = data.name.trim();
  const sku = data.sku.trim();
  const oem = data.oem?.trim() || undefined;
  const categoryName = data.category.trim();
  const brandName = data.brand?.trim();
  const barcode = data.barcode?.trim() || undefined;

  if (!name) throw new BadRequestException('Product name is required');
  if (!sku) throw new BadRequestException('SKU is required');
  if (!categoryName) throw new BadRequestException('Category is required');

  if (data.sellingPrice != null && data.sellingPrice < 0) {
    throw new BadRequestException('Selling price cannot be negative');
  }
  if (data.costPrice != null && data.costPrice < 0) {
    throw new BadRequestException('Cost price cannot be negative');
  }

  this.validateLengths({ name, sku, oem, category: categoryName, brand: brandName, barcode });

  const category = await this.findOrCreateCategory(organizationId, categoryName, tx);
  const brand = brandName ? await this.findOrCreateBrand(organizationId, brandName, tx) : null;

  try {
    return await tx.product.create({
      data: {
        name,
        sku,
        oem,
        barcode,
        sellingPrice: data.sellingPrice ?? null,
        costPrice: data.costPrice ?? null,
        categoryId: category.id,
        brandId: brand?.id ?? null,
        organizationId,
      },
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      throw new ConflictException(
        `A product with SKU "${sku}"${barcode ? ` or barcode "${barcode}"` : ''} already exists`,
      );
    }
    throw err;
  }
}
  async search(organizationId: string, query: string) {
    const q = query.trim();

    if (!q) return { products: [], stocks: [], locations: [], events: [] };

    const eventType = Object.values(EventType).find(
      (v) => v.toLowerCase() === q.toLowerCase(),
    );

    const [products, stocks, locations, events] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          organizationId,
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
          organizationId,
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
          organizationId,
          name: { contains: q, mode: 'insensitive' },
        },
        take: 20,
      }),

      this.prisma.event.findMany({
        where: {
          organizationId,
          OR: [
            { product: { name: { contains: q, mode: 'insensitive' } } },
            ...(eventType ? [{ type: eventType }] : []),
          ],
        },
        include: {
          product: true,
          fromLocation: true,
          toLocation: true,
          session: { select: { id: true, type: true, stage: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      products,
      stocks,
      locations,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        quantity: e.quantity,
        createdAt: e.createdAt,
        productId: e.productId,
        product: e.product,
        from: e.fromLocation?.name ?? null,
        to: e.toLocation?.name ?? null,
        sessionId: e.session?.id ?? null,
        sessionType: e.session?.type ?? null,
        sessionStatus: e.session?.status ?? null,
      })),
    };
  }

  // -----------------------------
  // SEARCH FOR INVOICE (POS) — flat product list w/ stock across ALL locations
  // -----------------------------
  async searchForInvoice(organizationId: string, query: string, locationId?: string) {
    const q = query.trim();

    if (!q && !locationId) return [];

    const products = await this.prisma.product.findMany({
      where: {
        organizationId,
        active: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
                { oem: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(locationId
          ? {
              stocks: {
                some: { organizationId, locationId },
              },
            }
          : {}),
      },
      include: {
        stocks: {
          where: { organizationId },
          include: { location: true },
        },
      },
      take: 20,
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      sellingPrice: p.sellingPrice != null ? Number(p.sellingPrice) : null,
      stockByLocation: p.stocks.map((s) => ({
        locationId: s.locationId,
        locationName: s.location.name,
        quantity: s.quantity,
      })),
    }));
  }

  async updateCategory(organizationId: string, id: string, categoryId: string) {
    await this.assertProductOwnership(organizationId, id);

    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId },
    });
    if (!category) throw new BadRequestException('Category not found');

    return this.prisma.product.update({
      where: { id },
      data: { categoryId },
    });
  }

  async archive(organizationId: string, id: string) {
    await this.assertProductOwnership(organizationId, id);
    return this.prisma.product.update({
      where: { id },
      data: { active: false },
    });
  }

  async restore(organizationId: string, id: string) {
    await this.assertProductOwnership(organizationId, id);
    return this.prisma.product.update({
      where: { id },
      data: { active: true },
    });
  }

  async bulkImport(
    organizationId: string,
    rows: {
      name: string;
      sku: string;
      oem?: string;
      category: string;
      brand?: string;
      sellingPrice?: number;
      costPrice?: number;
    }[],
  ) {
    const accepted: any[] = [];
    const rejected: any[] = [];

    for (const row of rows) {
      try {
        const { product, category, brand } = await this.resolveForImport(organizationId, row);

        accepted.push({
          productId: product.id,
          name: product.name,
          sku: product.sku,
          oem: row.oem?.trim() || undefined,
          category: category.name,
          brand: brand?.name ?? null,
        });
      } catch (err) {
        this.logger.error(
          `Bulk import failed for row sku=${row.sku ?? '?'} org=${organizationId}: ${
            err instanceof Error ? err.message : err
          }`,
          err instanceof Error ? err.stack : undefined,
        );

        rejected.push({
          ...row,
          reason: err instanceof BadRequestException ? err.message : 'system error',
        });
      }
    }

    return { accepted, rejected };
  }

  async resolveForImport(
    organizationId: string,
    row: {
      sku: string;
      name: string;
      category: string;
      brand?: string;
      sellingPrice?: number;
      costPrice?: number;
    },
    tx: Tx = this.prisma,
  ) {
    const name = row.name?.trim();
    const sku = row.sku?.trim();
    const categoryName = row.category?.trim();
    const brandName = row.brand?.trim();

    if (!name || !categoryName) {
      throw new BadRequestException('missing name or category');
    }
    if (!sku) {
      throw new BadRequestException('missing sku');
    }
    if (row.sellingPrice != null && row.sellingPrice < 0) {
      throw new BadRequestException('selling price cannot be negative');
    }
    if (row.costPrice != null && row.costPrice < 0) {
      throw new BadRequestException('cost price cannot be negative');
    }

    this.validateLengths({
      name,
      sku,
      category: categoryName,
      brand: brandName,
    });

    const category = await this.findOrCreateCategory(organizationId, categoryName, tx);
    const brand = brandName
      ? await this.findOrCreateBrand(organizationId, brandName, tx)
      : null;

    let product = await tx.product.findFirst({
      where: { sku, organizationId },
    });

    if (!product) {
      product = await tx.product.create({
        data: {
          name,
          sku,
          categoryId: category.id,
          brandId: brand?.id ?? null,
          organizationId,
          active: true,
          sellingPrice: row.sellingPrice ?? null,
          costPrice: row.costPrice ?? null,
        },
      });
    } else {
      if (!product.active) {
        throw new BadRequestException(
          `Product with SKU "${sku}" is archived — restore it before importing stock for it`,
        );
      }

      product = await tx.product.update({
        where: { id: product.id },
        data: {
          name,
          categoryId: category.id,
          brandId: brand?.id ?? null,
          ...(row.sellingPrice !== undefined ? { sellingPrice: row.sellingPrice } : {}),
          ...(row.costPrice !== undefined ? { costPrice: row.costPrice } : {}),
        },
      });
    }

    return { product, category, brand };
  }

  private async findOrCreateCategory(organizationId: string, name: string, tx: Tx = this.prisma) {
    const trimmed = name.trim();

    const existing = await tx.category.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' }, organizationId },
    });
    if (existing) return existing;

    try {
      return await tx.category.create({
        data: { name: trimmed, organizationId },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        const category = await tx.category.findFirst({
          where: { name: { equals: trimmed, mode: 'insensitive' }, organizationId },
        });
        if (category) return category;
      }
      throw err;
    }
  }

  private async findOrCreateBrand(organizationId: string, name: string, tx: Tx = this.prisma) {
    const trimmed = name.trim();

    const existing = await tx.brand.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' }, organizationId },
    });
    if (existing) return existing;

    const id = `${organizationId}_${trimmed.toLowerCase().replace(/\s+/g, '_')}`;

    try {
      return await tx.brand.create({
        data: { id, name: trimmed, organizationId },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        const brand = await tx.brand.findFirst({
          where: { name: { equals: trimmed, mode: 'insensitive' }, organizationId },
        });
        if (brand) return brand;
      }
      throw err;
    }
  }

  private async assertProductOwnership(organizationId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Product not found');
  }

  async findByBarcode(organizationId: string, code: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        organizationId,
        OR: [{ barcode: code }, { sku: code }],
      },
    });
    if (!product) throw new NotFoundException('Product not found for this code');
    return product;
  }
}