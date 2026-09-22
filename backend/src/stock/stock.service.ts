import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, EventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductService } from '../product/product.service'; // adjust path if different
import { PostingRulesService } from '../accounting/posting-rules.service'; // NEW
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
// DeliveryOrder has shipped (DeliveryOrderService.recordReturn).
type SalesOrderReturnContext = {
  type: typeof EventType.RETURNS;
  salesOrderId: string;
  invoiceId?: never;
  metadata?: Prisma.InputJsonObject;
};
type InvoiceReturnContext = {
  type: typeof EventType.RETURNS;
  invoiceId: string;
  salesOrderId?: never;
  metadata?: Prisma.InputJsonObject;
};

export type StockMovementContext =
  | InvoiceSaleContext
  | SalesOrderSaleContext
  | InvoiceAdjustmentContext
  | SalesOrderAdjustmentContext
  | PurchaseOrderReceiptContext
  | SalesOrderReturnContext
  | InvoiceReturnContext;

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    private productService: ProductService,
    private postingRules: PostingRulesService, // NEW
  ) {}

  // -----------------------------
  // Shared row lock
  // -----------------------------
  // SELECT ... FOR UPDATE on the Stock row, inside the current
  // transaction. A concurrent decrease()/fulfill()/adjust()/import() call
  // against the SAME product+location blocks here until the first
  // transaction commits or rolls back, so whatever this call reads next is
  // guaranteed current. Returns 0 (not null) when no Stock row exists yet.
  // Public so callers that need the same row-locked read (e.g.
  // WarehouseService.move(), which decrements a source and increments a
  // destination in one transaction) don't reimplement it with a plain,
  // unlocked read.
  async lockStockRow(
    client: Prisma.TransactionClient,
    orgId: string,
    productId: string,
    locationId: string,
  ): Promise<number> {
    // quantity is DECIMAL, which the pg driver returns as a string, not a
    // number — despite what the generic type param below claims.
    const rows = await client.$queryRaw<{ quantity: string }[]>(Prisma.sql`
      SELECT quantity FROM "Stock"
      WHERE "productId" = ${productId}
        AND "locationId" = ${locationId}
        AND "organizationId" = ${orgId}
      FOR UPDATE
    `);
    return rows[0] ? Number(rows[0].quantity) : 0;
  }

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
  // Locks the Stock row (FOR UPDATE) before checking sufficiency, so two
  // simultaneous decrease() calls against the same product+location can't
  // both pass the check against a stale read.
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

      const available = await this.lockStockRow(client, orgId, productId, locationId);
      if (available < qty) {
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
  // FULFILL
  // -----------------------------
  // Unlike decrease() — strict, throws on insufficient stock — fulfill()
  // takes as much as is physically available and reports back exactly what
  // happened. Stock.quantity can never go below zero as a result. Used by
  // InvoiceService.issue()/editIssuedInvoice() for non-warehouse orgs,
  // where a sale can still succeed even when it oversells.
  async fulfill(
    orgId: string,
    productId: string,
    locationId: string,
    requestedQty: number,
    userId: string,
    context: StockMovementContext,
    tx?: Prisma.TransactionClient,
  ): Promise<{ fulfilledQuantity: number; shortfall: number }> {
    if (requestedQty <= 0) return { fulfilledQuantity: 0, shortfall: 0 };

    const run = async (client: Prisma.TransactionClient) => {
      await this.assertProductActive(orgId, productId, client);
      await this.assertLocationOwnership(orgId, locationId, client);

      const available = await this.lockStockRow(client, orgId, productId, locationId);
      const fulfilledQuantity = Math.min(available, requestedQty);
      const shortfall = requestedQty - fulfilledQuantity;

      if (fulfilledQuantity > 0) {
        await client.stock.update({
          where: { productId_locationId: { productId, locationId } },
          data: { quantity: { decrement: fulfilledQuantity } },
        });

        await client.event.create({
          data: {
            type: context.type,
            productId,
            fromLocationId: locationId,
            quantity: -fulfilledQuantity,
            userId,
            organizationId: orgId,                          // 🔒
            invoiceId: context.invoiceId,
            salesOrderId: context.salesOrderId,
            metadata: context.metadata ?? {},
          },
        });
      }
      // fulfilledQuantity === 0: nothing moved, so no Event is written.
      // The shortfall is read straight off InvoiceItem.quantity -
      // fulfilledQuantity by whoever needs it.

      return { fulfilledQuantity, shortfall };
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  // -----------------------------
  // ADJUST
  // -----------------------------
  // CHANGED — now posts to the ledger in the same transaction as the stock
  // write. qtyDelta < 0 (shrinkage): Dr Inventory Adjustments, Cr Inventory.
  // qtyDelta > 0 (found stock): Dr Inventory, Cr Inventory Adjustments.
  // Valued at Product.costPrice; a product with no costPrice moves stock
  // but posts nothing (same skip policy as postCogs).
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
        const available = await this.lockStockRow(tx, orgId, productId, locationId);
        if (available + qtyDelta < 0) {
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

      const event = await tx.event.create({
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

      // NEW — ledger posting.
      const product = await tx.product.findFirst({
        where: { id: productId, organizationId: orgId },
        select: { costPrice: true },
      });
      await this.postingRules.postStockAdjustment(
        orgId,
        {
          sourceId: `stock-adjust:${event.id}`,
          date: new Date(),
          memo: `Stock adjustment: ${reason.trim()}`,
          qtyDelta,
          unitCost: product?.costPrice != null ? Number(product.costPrice) : null,
          locationId,
          counter: 'ADJUSTMENT',
        },
        tx,
      );

      return {
        success: true,
        productId,
        locationId,
        qtyDelta,
        newQuantity: Number(stock.quantity), // Decimal serializes to a string otherwise
      };
    });
  }

  // -----------------------------
  // IMPORT
  // -----------------------------
  // CHANGED — locks the Stock row before reading beforeQty (so a REPLACE
  // can't overwrite an in-flight sale's decrement), and posts the quantity
  // change to the ledger: net increases against Opening Balance Equity,
  // net decreases against Inventory Adjustments (so a REPLACE that lowers
  // stock actually hits the P&L instead of disappearing into equity). Cost
  // comes from the import row's costPrice, falling back to Product.costPrice;
  // with neither, stock moves but nothing is posted.
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

        if (typeof row.qty !== 'number' || Number.isNaN(row.qty) || row.qty < 0) {
          rejected.push({ ...row, reason: 'qty must be a non-negative number' });
          continue;
        }

        const result = await this.prisma.$transaction(async (tx) => {
          const { product } = await this.productService.resolveForImport(
            orgId,
            row,
            tx,
          );

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

          // CHANGED — locked read instead of plain findUnique.
          const beforeQty = await this.lockStockRow(tx, orgId, product.id, location.id);
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

          const importEvent = await tx.event.create({
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

          // NEW — ledger posting. Read cost from the DB rather than
          // relying on what resolveForImport returns.
          const costRow = await tx.product.findFirst({
            where: { id: product.id, organizationId: orgId },
            select: { costPrice: true },
          });
          const unitCost =
            row.costPrice ?? (costRow?.costPrice != null ? Number(costRow.costPrice) : null);

          // A net increase (bulk-loading/adding stock) is treated as an
          // opening-balance event; a net decrease (a REPLACE that lowers
          // quantity, i.e. shrinkage) must hit the P&L-relevant Inventory
          // Adjustments account instead — same distinction adjust() makes.
          await this.postingRules.postStockAdjustment(
            orgId,
            {
              sourceId: `stock-import:${importEvent.id}`,
              date: new Date(),
              memo: `Stock import (${mode}): ${row.sku}`,
              qtyDelta: afterQty - beforeQty,
              unitCost,
              locationId: location.id,
              counter: afterQty - beforeQty < 0 ? 'ADJUSTMENT' : 'OPENING_BALANCE',
            },
            tx,
          );

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
    const rows = await this.prisma.stock.findMany({
      where: { productId, organizationId: orgId },               // 🔒
      include: { location: true },
    });
    // quantity is Decimal, which serializes to a JSON string otherwise —
    // the frontend stock detail page sums these client-side as numbers.
    return rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
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