import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Brand } from '@prisma/client';
import { AdjustStockDto } from './dto/adjust-stock.dto';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  // -----------------------------
  // INCREASE
  // -----------------------------
  async increase(
    orgId: string,
    productId: string,
    locationId: string,
    qty: number,
  ) {
    await this.assertProductOwnership(orgId, productId);
    await this.assertLocationOwnership(orgId, locationId);

    return this.prisma.stock.upsert({
      where: {
        productId_locationId: { productId, locationId },
      },
      update: {
        quantity: { increment: qty },
      },
      create: {
        productId,
        locationId,
        quantity: qty,
        organizationId: orgId,                              // 🔒
      },
    });
  }

  // -----------------------------
  // DECREASE
  // -----------------------------
  async decrease(
    orgId: string,
    productId: string,
    locationId: string,
    qty: number,
  ) {
    if (qty <= 0) throw new BadRequestException('Invalid qty');

    await this.assertProductOwnership(orgId, productId);
    await this.assertLocationOwnership(orgId, locationId);

    // Re-check stock inside a transaction to prevent concurrent over-decrement
    return this.prisma.$transaction(async (tx) => {
      const stock = await tx.stock.findUnique({
        where: {
          productId_locationId: { productId, locationId },
        },
      });

      if (!stock || stock.quantity < qty) {
        throw new BadRequestException('Insufficient stock');
      }

      return tx.stock.update({
        where: { productId_locationId: { productId, locationId } },
        data: { quantity: { decrement: qty } },
      });
    });
  }

  // -----------------------------
  // ADJUST
  // -----------------------------
  async adjust(orgId: string, userId: string, data: AdjustStockDto) {
    const { productId, locationId, qtyDelta, reason } = data;

    if (
      qtyDelta === undefined ||
      qtyDelta === null ||
      Number.isNaN(qtyDelta) ||
      qtyDelta === 0
    ) {
      throw new BadRequestException('Invalid quantity');
    }

    await this.assertProductOwnership(orgId, productId);
    await this.assertLocationOwnership(orgId, locationId);

    return this.prisma.$transaction(async (tx) => {
      // For negative deltas, verify we have enough stock first
      if (qtyDelta < 0) {
        const stock = await tx.stock.findUnique({
          where: { productId_locationId: { productId, locationId } },
        });

        if (!stock || stock.quantity + qtyDelta < 0) {
          throw new BadRequestException('Adjustment would result in negative stock');
        }
      }

      const stock = await tx.stock.upsert({
        where: { productId_locationId: { productId, locationId } },
        update: { quantity: { increment: qtyDelta } },
        create: {
          productId,
          locationId,
          quantity: qtyDelta,
          organizationId: orgId,                            // 🔒
        },
      });

      await tx.event.create({
        data: {
          type: 'ADJUSTMENT',
          productId,
          toLocationId: locationId,
          quantity: qtyDelta,
          userId, 
          organizationId: orgId,                            // 🔒
          metadata: { reason },
        },
      });

      return {
        success: true,
        productId,
        locationId,
        qtyDelta,
        newQuantity: stock.quantity,
      };
    });
  }

  // -----------------------------
  // IMPORT
  // -----------------------------
  async import(
    orgId: string,
    userId: string,
    rows: {
      sku: string;
      name: string;
      category: string;
      brand?: string;
      location: string;
      qty: number;
    }[],
  ) {
    const accepted: any[] = [];
    const rejected: any[] = [];

    for (const row of rows) {
      try {
        if (
          !row.sku?.trim() ||
          !row.name?.trim() ||
          !row.location?.trim() ||
          row.qty == null
        ) {
          rejected.push({ ...row, reason: 'missing fields' });
          continue;
        }

        const result = await this.prisma.$transaction(async (tx) => {
          // 1. CATEGORY — scoped to org, unique per org
          const categoryId = slugify(row.category);

          let category = await tx.category.findFirst({
            where: { id: categoryId, organizationId: orgId },   // 🔒
          });

          if (!category) {
            category = await tx.category.create({
              data: {
                id: categoryId,
                name: row.category,
                organizationId: orgId,                           // 🔒
              },
            });
          }

          // 2. BRAND — scoped to org
          let brand: Brand | null = null;

          if (row.brand?.trim()) {
            const brandId = slugify(row.brand);

            brand = await tx.brand.findFirst({
              where: { id: brandId, organizationId: orgId },     // 🔒
            });

            if (!brand) {
              brand = await tx.brand.create({
                data: {
                  id: brandId,
                  name: row.brand,
                  organizationId: orgId,                         // 🔒
                },
              });
            }
          }

          // 3. PRODUCT — scoped to org
          let product = await tx.product.findFirst({
            where: { sku: row.sku, organizationId: orgId },      // 🔒
          });

          if (!product) {
            product = await tx.product.create({
              data: {
                sku: row.sku,
                name: row.name,
                categoryId: category.id,
                brandId: brand?.id ?? null,
                organizationId: orgId,                           // 🔒
              },
            });
          } else {
            product = await tx.product.update({
              where: { id: product.id },
              data: {
                name: row.name,
                categoryId: category.id,
                brandId: brand?.id ?? null,
              },
            });
          }

          // 4. LOCATION — scoped to org
          const locationId = slugify(row.location);

          let location = await tx.location.findFirst({
            where: { id: locationId, organizationId: orgId },    // 🔒
          });

          if (!location) {
            location = await tx.location.create({
              data: {
                id: locationId,
                name: row.location,
                organizationId: orgId,                           // 🔒
              },
            });
          }

          // 5. STOCK UPSERT
          await tx.stock.upsert({
            where: {
              productId_locationId: {
                productId: product.id,
                locationId: location.id,
              },
            },
            update: { quantity: { increment: row.qty } },
            create: {
              productId: product.id,
              locationId: location.id,
              quantity: row.qty,
              organizationId: orgId,                             // 🔒
            },
          });

          // 6. EVENT
          await tx.event.create({
            data: {
              type: 'IMPORT',
              productId: product.id,
              toLocationId: location.id,
              quantity: row.qty,
              userId,
              organizationId: orgId,                             // 🔒
              metadata: {
                sku: row.sku,
                category: row.category,
                brand: row.brand ?? null,
              },
            },
          });

          return { product, location };
        });

        accepted.push({
          sku: row.sku,
          productId: result.product.id,
          location: result.location.name,
          qty: row.qty,
        });
      } catch (err) {
        console.error('Stock import row failed:', row, err);
        rejected.push({
          ...row,
          reason: err instanceof Error ? err.message : 'system error',
        });
      }
    }

    return { accepted, rejected };
  }

  // -----------------------------
  // GET
  // -----------------------------
  async get(orgId: string, productId: string) {
    await this.assertProductOwnership(orgId, productId);
    return this.prisma.stock.findMany({
      where: { productId, organizationId: orgId },               // 🔒
      include: { location: true },
    });
  }

  // -----------------------------
  // PRIVATE HELPERS
  // -----------------------------
  private async assertProductOwnership(orgId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Product not found');
  }

  private async assertLocationOwnership(orgId: string, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, organizationId: orgId },
      select: { id: true },
    });
    if (!location) throw new BadRequestException('Location not found');
  }
}