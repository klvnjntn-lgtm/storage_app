import { CostChangeSource, EventType, Prisma, SessionType, StockTransferStatus } from '@prisma/client';

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

// Row-locks the products a document is about to cost, in id order.
//
// Everything that reads or moves a product's average cost while stock moves
// takes this lock first — receipts and returns (through lockCostState) and
// sales (through lockCosts). Without it a sale read the cost, a receipt
// then changed it, and the sale booked COGS at a cost the receipt had
// already averaged away; or the receipt averaged against a quantity a sale
// was in the middle of taking. Either way the Inventory account stopped
// matching quantity x cost.
//
// Id order, and before any Stock row is locked: two documents listing the
// same products in opposite order used to be able to deadlock.
export async function lockProducts(tx: Tx, organizationId: string, productIds: (string | null | undefined)[]) {
  const ids = [...new Set(productIds.filter((id): id is string => !!id))].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM "Product"
    WHERE id IN (${Prisma.join(ids)}) AND "organizationId" = ${organizationId}
    ORDER BY id
    FOR UPDATE`;
}

// Stock that belongs to the business but sits in no Stock row right now:
// on a transfer that has left its source and not yet arrived, or picked in
// an open move session and not yet put away. Still on hand, at the current
// cost, for averaging and for valuing the stock.
export async function stockInHand(tx: Tx, organizationId: string, productId?: string) {
  const [inTransit, moving] = await Promise.all([
    tx.stockTransferItem.groupBy({
      by: ['productId'],
      where: { ...(productId && { productId }), transfer: { organizationId, status: StockTransferStatus.IN_TRANSIT } },
      _sum: { quantity: true },
    }),
    // PICK rows are negative and MOVE rows positive, so what's still in
    // hand is minus their sum.
    tx.event.groupBy({
      by: ['productId'],
      where: {
        organizationId,
        ...(productId && { productId }),
        type: { in: [EventType.PICK, EventType.MOVE] },
        session: { type: SessionType.MOVE, status: 'OPEN' },
      },
      _sum: { quantity: true },
    }),
  ]);
  const byProduct = new Map<string, number>();
  for (const row of inTransit) {
    byProduct.set(row.productId, (byProduct.get(row.productId) ?? 0) + Number(row._sum.quantity ?? 0));
  }
  for (const row of moving) {
    const held = -Number(row._sum.quantity ?? 0);
    if (held > 0) byProduct.set(row.productId, (byProduct.get(row.productId) ?? 0) + held);
  }
  return byProduct;
}

// Locks the product row (so two receipts can't both average against the
// same starting point) and reads its cost plus the stock on hand, counting
// what's in hand outside the Stock rows (see stockInHand).
async function lockCostState(tx: Tx, organizationId: string, productId: string) {
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`;
  const product = await tx.product.findFirst({
    where: { id: productId, organizationId },
    select: { costPrice: true },
  });
  if (!product) return null;
  const [stock, inHand] = await Promise.all([
    tx.stock.aggregate({
      where: { productId, organizationId },
      _sum: { quantity: true },
    }),
    stockInHand(tx, organizationId, productId),
  ]);
  return {
    previousCost: product.costPrice != null ? Number(product.costPrice) : null,
    onHand: Number(stock._sum.quantity ?? 0) + (inHand.get(productId) ?? 0),
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

// The reverse of receiveAtCost: units leave at a known cost (goods sent
// back to the supplier at what they were bought for), and the average of
// what stays is recomputed without them. Call BEFORE the stock decrease.
//
// When nothing would remain, or the remaining value would come out
// negative (the returned units cost more than everything on hand is
// worth — possible after overselling), the average is left alone: there
// is no meaningful remaining value to average.
export async function issueAtCost(
  tx: Tx,
  params: {
    organizationId: string;
    productId: string;
    quantity: number;
    unitCost: number;
    source: CostChangeSource;
    sourceId?: string;
    userId?: string | null;
  },
): Promise<number | null> {
  const { organizationId, productId, quantity, unitCost } = params;
  if (!(quantity > 0)) return null;
  const state = await lockCostState(tx, organizationId, productId);
  if (!state || state.previousCost == null) return null;
  const { previousCost, onHand } = state;

  const remaining = onHand - quantity;
  const remainingValue = onHand * previousCost - quantity * unitCost;
  if (remaining <= 0 || remainingValue < 0) return previousCost;

  const newCost = round2(remainingValue / remaining);
  if (newCost !== previousCost) {
    await tx.product.update({ where: { id: productId }, data: { costPrice: newCost } });
    await tx.productCostHistory.create({
      data: {
        organizationId,
        productId,
        source: params.source,
        sourceId: params.sourceId,
        previousCost,
        newCost,
        quantityBefore: onHand,
        quantityIn: -quantity,
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
// caller's; this records it and returns the stock on hand it applies to, so
// the caller can book the change in value (PostingRulesService.
// postInventoryRevaluation) — re-pricing stock that's on the shelf moves
// what the Inventory account should hold.
export async function recordManualCost(
  tx: Tx | Prisma.TransactionClient,
  params: { organizationId: string; productId: string; previousCost: number | null; newCost: number | null; userId?: string | null },
): Promise<{ onHand: number } | null> {
  if (params.previousCost === params.newCost) return null;
  const [stock, inHand] = await Promise.all([
    tx.stock.aggregate({
      where: { productId: params.productId, organizationId: params.organizationId },
      _sum: { quantity: true },
    }),
    stockInHand(tx, params.organizationId, params.productId),
  ]);
  const onHand = Number(stock._sum.quantity ?? 0) + (inHand.get(params.productId) ?? 0);
  await tx.productCostHistory.create({
    data: {
      organizationId: params.organizationId,
      productId: params.productId,
      source: CostChangeSource.MANUAL,
      previousCost: params.previousCost,
      newCost: params.newCost,
      quantityBefore: onHand,
      userId: params.userId ?? null,
    },
  });
  return { onHand };
}

// The cost a sale books COGS at as its stock leaves: locks the products
// (see lockProducts), then reads their current cost. Use this, not
// currentCosts, wherever stock is about to move.
export async function lockCosts(tx: Tx, organizationId: string, productIds: (string | null | undefined)[]) {
  await lockProducts(tx, organizationId, productIds);
  return currentCosts(tx, organizationId, productIds.filter((id): id is string => !!id));
}

// Current cost of each product, read inside the caller's transaction without
// locking — for planning and display. A document that moves stock uses
// lockCosts.
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
