import { CostChangeSource, Prisma } from '@prisma/client';

// Weighted-average inventory costing.
//
// Product.costPrice is the average cost of the stock on hand (all locations
// together). Sales book COGS at whatever it is when the stock leaves; it is
// never rewritten for past sales. It moves only when stock comes in at a
// cost that can differ from the current average:
//
//   - a goods receipt (the authoritative event)
//   - goods coming back (customer returns, voided or edited sales), at the
//     cost they left at
//   - an opening-stock import, when there was no stock or no cost before
//
// Every change is logged in ProductCostHistory, so the current cost can be
// traced back to what produced it.
//
// Plain functions taking the caller's transaction (like
// recomputeInvoiceFulfillmentStatus) rather than an injectable service:
// they're called from stock, invoice, delivery-order, session and
// goods-receipt code, several of which already depend on each other.

type Tx = Prisma.TransactionClient;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Locks the product row (so two receipts can't both average against the
// same starting point) and reads its cost plus the stock on hand.
async function lockCostState(tx: Tx, organizationId: string, productId: string) {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`;
  const product = await tx.product.findFirst({
    where: { id: productId, organizationId },
    select: { costPrice: true },
  });
  if (!product) return null;
  const stock = await tx.stock.aggregate({
    where: { productId, organizationId },
    _sum: { quantity: true },
  });
  return {
    previousCost: product.costPrice != null ? Number(product.costPrice) : null,
    onHand: Number(stock._sum.quantity ?? 0),
  };
}

// Blends incoming stock into the product's average cost. Call BEFORE the
// stock row is incremented — the on-hand quantity it averages against must
// not already include the incoming units.
//
// With nothing on hand (or stock that has gone negative through
// overselling), or no cost recorded yet, the incoming cost simply becomes
// the cost: there is no existing value to average against.
//
// An unknown incoming cost (null) leaves the average alone.
export async function receiveAtCost(
  tx: Tx,
  params: {
    organizationId: string;
    productId: string;
    quantity: number;
    unitCost: number | null;
    source: CostChangeSource;
    sourceId?: string;
    userId?: string | null;
  },
): Promise<number | null> {
  const { organizationId, productId, quantity, unitCost } = params;
  if (unitCost == null || !(quantity > 0)) return null;

  const state = await lockCostState(tx, organizationId, productId);
  if (!state) return null;
  const { previousCost, onHand } = state;

  const newCost =
    previousCost == null || onHand <= 0
      ? round2(unitCost)
      : round2((onHand * previousCost + quantity * unitCost) / (onHand + quantity));

  const changed = newCost !== previousCost;
  if (changed) {
    await tx.product.update({ where: { id: productId }, data: { costPrice: newCost } });
  }
  // Receipts are always logged, even when the average didn't move, so the
  // history shows every purchase that fed it. Other inflows only when they
  // changed something.
  if (changed || params.source === CostChangeSource.GOODS_RECEIPT) {
    await tx.productCostHistory.create({
      data: {
        organizationId,
        productId,
        source: params.source,
        sourceId: params.sourceId,
        previousCost,
        newCost,
        quantityBefore: onHand,
        quantityIn: quantity,
        unitCostIn: unitCost,
        userId: params.userId ?? null,
      },
    });
  }
  return newCost;
}

// Imported cost: sets the opening cost, but only while the product has no
// cost yet or nothing on hand. A routine import (more stock, a stock-take)
// must not overwrite the average built from real receipts. Returns whether
// the cost was applied.
export async function applyOpeningCost(
  tx: Tx,
  params: { organizationId: string; productId: string; unitCost: number; sourceId?: string; userId?: string | null },
): Promise<boolean> {
  const state = await lockCostState(tx, params.organizationId, params.productId);
  if (!state) return false;
  if (state.previousCost != null && state.onHand > 0) return false;

  const newCost = round2(params.unitCost);
  if (newCost !== state.previousCost) {
    await tx.product.update({ where: { id: params.productId }, data: { costPrice: newCost } });
    await tx.productCostHistory.create({
      data: {
        organizationId: params.organizationId,
        productId: params.productId,
        source: CostChangeSource.OPENING_IMPORT,
        sourceId: params.sourceId,
        previousCost: state.previousCost,
        newCost,
        quantityBefore: state.onHand,
        userId: params.userId ?? null,
      },
    });
  }
  return true;
}

// Logs a hand-edited cost (product create/edit). The edit itself is the
// caller's; this only records it.
export async function recordManualCost(
  tx: Tx | Prisma.TransactionClient,
  params: { organizationId: string; productId: string; previousCost: number | null; newCost: number | null; userId?: string | null },
) {
  if (params.previousCost === params.newCost) return;
  const stock = await tx.stock.aggregate({
    where: { productId: params.productId, organizationId: params.organizationId },
    _sum: { quantity: true },
  });
  await tx.productCostHistory.create({
    data: {
      organizationId: params.organizationId,
      productId: params.productId,
      source: CostChangeSource.MANUAL,
      previousCost: params.previousCost,
      newCost: params.newCost,
      quantityBefore: Number(stock._sum.quantity ?? 0),
      userId: params.userId ?? null,
    },
  });
}

// Current cost of each product, read inside the caller's transaction — what
// a sale books COGS at when its stock leaves.
export async function currentCosts(tx: Tx, organizationId: string, productIds: string[]) {
  const products = productIds.length
    ? await tx.product.findMany({
        where: { id: { in: Array.from(new Set(productIds)) }, organizationId },
        select: { id: true, costPrice: true },
      })
    : [];
  return new Map(products.map((p) => [p.id, p.costPrice != null ? Number(p.costPrice) : null]));
}

// Average of two cost layers on one document line: what was already booked
// for `qtyA` units at `costA`, plus `qtyB` more at `costB`. Keeps a line's
// unitCost equal to what its fulfilled units were actually costed at, so a
// later return reverses exactly that.
export function blendLineCost(qtyA: number, costA: number | null, qtyB: number, costB: number | null) {
  if (costB == null || qtyB <= 0) return costA;
  if (costA == null || qtyA <= 0) return costB;
  return round2((qtyA * costA + qtyB * costB) / (qtyA + qtyB));
}
