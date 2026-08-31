import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, EventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from '../product/product.service'; // adjust path if different
import { AdjustStockDto } from './dto/adjust-stock.dto';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export enum ImportMode {
  REPLACE = 'REPLACE',
  INCREMENT = 'INCREMENT',
}

// A SALE stock movement must be caused by exactly one document: either an
// Invoice or a Sales Order, never both, never neither. An ADJUSTMENT (as
// used by InvoiceService.voidInvoice's stock reversal) is tied to an
// invoice. The `never` fields are what enforce the mutual exclusion —
// `type` alone doesn't discriminate InvoiceSaleContext from
// SalesOrderSaleContext, since both carry EventType.SALE.
type InvoiceSaleContext = {
  type: typeof EventType.SALE;
  invoiceId: string;
  salesOrderId?: never;
  metadata?: Prisma.InputJsonObject;
};

type SalesOrderSaleContext = {
  type: typeof EventType.SALE;
  salesOrderId: string;
  invoiceId?: never;
  metadata?: Prisma.InputJsonObject;
};

type InvoiceAdjustmentContext = {
  type: typeof EventType.ADJUSTMENT;
  invoiceId: string;
  salesOrderId?: never;
  metadata?: Prisma.InputJsonObject;
};
type SalesOrderAdjustmentContext = {
  type: typeof EventType.ADJUSTMENT;
  salesOrderId: string;
  invoiceId?: never;
  metadata?: Prisma.InputJsonObject;
};

type PurchaseOrderReceiptContext = {
  type: typeof EventType.RECEIVE;
  invoiceId?: never;
  salesOrderId?: never;
  metadata?: Prisma.InputJsonObject;
};

// A RETURNS stock movement — customer goods coming back after a
// DeliveryOrder has shipped (DeliveryOrderService.recordReturn). Only
// ties to a SalesOrder today, since Delivery Orders are sales-order-
// scoped; add an InvoiceReturnContext alongside this, same shape, if an
// invoice-side returns flow is ever built.
type SalesOrderReturnContext = {
  type: typeof EventType.RETURNS;
  salesOrderId: string;
  invoiceId?: never;
  metadata?: Prisma.InputJsonObject;
};

export type StockMovementContext =
  | InvoiceSaleContext
  | SalesOrderSaleContext
  | InvoiceAdjustmentContext
  | SalesOrderAdjustmentContext
  | PurchaseOrderReceiptContext
  | SalesOrderReturnContext; // NEW

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    private productService: ProductService,
  ) {}

  // -----------------------------
  // INCREASE
  // -----------------------------
  async increase(
    orgId: string,
    productId: string,
    locationId: string,
    qty: number,
    userId?: string,
    context?: StockMovementContext,
    tx?: Prisma.TransactionClient,
  ) {
    if (qty <= 0) throw new BadRequestException('Invalid qty');

    const run = async (client: Prisma.TransactionClient) => {
      await this.assertProductActive(orgId, productId, client);
      await this.assertLocationOwnership(orgId, locationId, client);

      const updated = await client.stock.upsert({
        where: { productId_locationId: { productId, locationId } },
        update: { quantity: { increment: qty } },
        create: {
          productId,
          locationId,
          quantity: qty,
          organizationId: orgId,                              // 🔒
        },
      });

      if (context?.type) {
        await client.event.create({
          data: {
            type: context.type,
            productId,
            toLocationId: locationId,
            quantity: qty,
            userId: userId ?? null,
            organizationId: orgId,                            // 🔒
            invoiceId: context.invoiceId,
            salesOrderId: context.salesOrderId,
            metadata: context.metadata ?? {},
          },
        });
      }

      return updated;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  // -----------------------------
  // DECREASE
  // -----------------------------
  async decrease(
    orgId: string,
    productId: string,
    locationId: string,
    qty: number,
    userId: string,
    context: StockMovementContext,
    tx?: Prisma.TransactionClient,
  ) {
    if (qty <= 0) throw new BadRequestException('Invalid qty');

    const run = async (client: Prisma.TransactionClient) => {
      await this.assertProductActive(orgId, productId, client);
      await this.assertLocationOwnership(orgId, locationId, client);

      // Re-check stock inside the transaction to prevent concurrent
      // over-decrement, regardless of whose transaction this is.
      const stock = await client.stock.findUnique({
        where: {
          productId_locationId: { productId, locationId },
        },
      });

      if (!stock || stock.quantity < qty) {
        throw new BadRequestException('Insufficient stock');
      }

      const updated = await client.stock.update({
        where: { productId_locationId: { productId, locationId } },
        data: { quantity: { decrement: qty } },
      });

      await client.event.create({
        data: {
          type: context.type,
          productId,
          fromLocationId: locationId,
          quantity: -qty,
          userId,
          organizationId: orgId,                            // 🔒
          invoiceId: context.invoiceId,
          salesOrderId: context.salesOrderId,
          metadata: context.metadata ?? {},
        },
      });

      return updated;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
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

    if (!reason?.trim()) {
      throw new BadRequestException('Reason is required');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assertProductActive(orgId, productId, tx);
      await this.assertLocationOwnership(orgId, locationId, tx);

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
          metadata: { reason: reason.trim() },
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
    mode: ImportMode,
    rows: {
      sku: string;
      name: string;
      category: string;
      brand?: string;
      location: string;
      qty: number;
      sellingPrice?: number;
      costPrice?: number;
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
          const { product } = await this.productService.resolveForImport(
            orgId,
            row,
            tx,
          );

          // Import creates products/locations on the fly, so there's no
          // pre-existing product/location to assert against here — the
          // active/ownership checks apply to increase/decrease/adjust,
          // where the product and location must already exist.

          const locationId = `${orgId}_${slugify(row.location)}`;

          let location = await tx.location.findFirst({
            where: { id: locationId, organizationId: orgId },    // 🔒
          });

          if (!location) {
            location = await tx.location.create({
              data: {
                id: locationId,
                name: row.location,
                organizationId: orgId,                            // 🔒
              },
            });
          }

          const existingStock = await tx.stock.findUnique({
            where: {
              productId_locationId: {
                productId: product.id,
                locationId: location.id,
              },
            },
          });
          const beforeQty = existingStock?.quantity ?? 0;
          const afterQty = mode === ImportMode.REPLACE ? row.qty : beforeQty + row.qty;

          await tx.stock.upsert({
            where: {
              productId_locationId: {
                productId: product.id,
                locationId: location.id,
              },
            },
            update:
              mode === ImportMode.REPLACE
                ? { quantity: row.qty }
                : { quantity: { increment: row.qty } },
            create: {
              productId: product.id,
              locationId: location.id,
              quantity: row.qty,
              organizationId: orgId,                             // 🔒
            },
          });

          await tx.event.create({
            data: {
              type: mode === ImportMode.REPLACE ? 'IMPORT_REPLACE' : 'IMPORT_INCREMENT',
              productId: product.id,
              toLocationId: location.id,
              quantity: afterQty - beforeQty,
              userId,
              organizationId: orgId,                             // 🔒
              metadata: {
                sku: row.sku,
                category: row.category,
                brand: row.brand ?? null,
                beforeQty,
                afterQty,
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

  // Now accepts the active Prisma client (tx or this.prisma), so when a
  // caller passes `tx`, this check runs inside the same transaction
  // instead of on a separate connection outside it.
  private async assertProductActive(
    orgId: string,
    productId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const product = await client.product.findFirst({
      where: { id: productId, organizationId: orgId },
      select: { id: true, active: true },
    });
    if (!product) throw new BadRequestException('Product not found');
    if (!product.active) {
      throw new BadRequestException(
        'Product is archived — restore it before recording stock movements',
      );
    }
  }

  private async assertLocationOwnership(
    orgId: string,
    locationId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const location = await client.location.findFirst({
      where: { id: locationId, organizationId: orgId },
      select: { id: true },
    });
    if (!location) throw new BadRequestException('Location not found');
  }
}