import { Prisma } from '@prisma/client';
import { resolveTimezone, todayBusinessDate } from '../accounting/business-date';
import { heldWorkOrderItemsWhere } from './work-order-holds';

// Stock promised to a customer, per product + location, that another sale can't take
// (StockService.fulfill enforces it; the product search shows it). Derived from the documents
// rather than stored, so cancelling or converting one releases its hold with nothing to sync:
//
//  • open work orders — their lines, from approval until cancelled or invoiced (work-order-holds.ts);
//  • ACCEPTED quotations through their valid-until day — what's left of each line once it's on a
//    confirmed sales order, an issued invoice or a work order (which then holds it itself). A
//    CONVERTED one keeps holding, date or not, until its draft order is confirmed / draft invoice
//    issued: converting stamps CONVERTED as soon as the drafts exist, before they hold anything;
//  • confirmed sales orders — what's left of each line once shipped or invoiced. A packed delivery
//    still holds: its stock only leaves the shelf when it ships.
//
// A sent quotation holds nothing (the customer hasn't said yes); offeredStock() reports it instead.
//
// excludeInvoiceId: the invoice being issued, so it can take what its own quotation / order holds.

export const holdKey = (productId: string, locationId: string) => `${productId}|${locationId}`;

type HoldRow = { productId: string; locationId: string; quantity: Prisma.Decimal | string | number };

async function holdContext(client: Prisma.TransactionClient, orgId: string) {
  const org = await client.organization.findUnique({
    where: { id: orgId },
    select: { workOrdersEnabled: true, timezone: true },
  });
  return { workOrdersEnabled: !!org?.workOrdersEnabled, today: todayBusinessDate(resolveTimezone(org)) };
}

// What's left of a quotation line: less the confirmed sales orders and issued invoices made from it.
function quotationLineRemaining(excludeInvoiceId: string) {
  return Prisma.sql`GREATEST(qi."quantity"
    - COALESCE((SELECT SUM(soi."quantity") FROM "SalesOrderItem" soi
        JOIN "SalesOrder" so ON so."id" = soi."salesOrderId"
        WHERE soi."quotationItemId" = qi."id" AND so."status" NOT IN ('DRAFT', 'CANCELLED')), 0)
    - COALESCE((SELECT SUM(ii."quantity") FROM "InvoiceItem" ii
        JOIN "Invoice" i ON i."id" = ii."invoiceId"
        WHERE ii."quotationItemId" = qi."id" AND (i."status" = 'ISSUED' OR i."id" = ${excludeInvoiceId})), 0), 0)`;
}

// 'held': accepted and in date, or converted; 'offered': sent and in date.
function quotationLines(
  orgId: string,
  kind: 'held' | 'offered',
  today: Date,
  productIds: string[],
  locationId: string | undefined,
) {
  const inDate = Prisma.sql`(q."validUntil" IS NULL OR q."validUntil" >= ${today})`;
  return Prisma.sql`
    FROM "SalesQuotationItem" qi
    JOIN "SalesQuotation" q ON q."id" = qi."salesQuotationId"
    WHERE q."organizationId" = ${orgId}
      AND ${
        kind === 'held'
          ? Prisma.sql`((q."status" = 'ACCEPTED' AND ${inDate}) OR q."status" = 'CONVERTED')`
          : Prisma.sql`(q."status" = 'SENT' AND ${inDate})`
      }
      AND q."workOrderId" IS NULL
      AND qi."productId" IN (${Prisma.join(productIds)})
      AND COALESCE(qi."locationId", q."locationId") IS NOT NULL
      ${locationId ? Prisma.sql`AND COALESCE(qi."locationId", q."locationId") = ${locationId}` : Prisma.empty}`;
}

export async function heldStock(
  client: Prisma.TransactionClient,
  orgId: string,
  productIds: string[],
  opts: { locationId?: string; excludeInvoiceId?: string } = {},
): Promise<Map<string, number>> {
  const held = new Map<string, number>();
  if (productIds.length === 0) return held;
  const add = (productId: string, locationId: string, qty: number) => {
    if (qty > 0) held.set(holdKey(productId, locationId), (held.get(holdKey(productId, locationId)) ?? 0) + qty);
  };
  const { workOrdersEnabled, today } = await holdContext(client, orgId);
  // '' matches no invoice when nothing is being issued.
  const exclude = opts.excludeInvoiceId ?? '';

  if (workOrdersEnabled) {
    const rows = await client.workOrderItem.groupBy({
      by: ['productId', 'locationId'],
      _sum: { quantity: true },
      where: {
        ...heldWorkOrderItemsWhere(orgId, opts.excludeInvoiceId),
        productId: { in: productIds },
        ...(opts.locationId && { locationId: opts.locationId }),
      },
    });
    for (const r of rows) {
      if (r.productId && r.locationId) add(r.productId, r.locationId, Number(r._sum.quantity ?? 0));
    }
  }

  const rows = await client.$queryRaw<HoldRow[]>(Prisma.sql`
    SELECT qi."productId" AS "productId", COALESCE(qi."locationId", q."locationId") AS "locationId",
           ${quotationLineRemaining(exclude)} AS "quantity"
    ${quotationLines(orgId, 'held', today, productIds, opts.locationId)}
    UNION ALL
    SELECT soi."productId", COALESCE(soi."locationId", so."locationId"),
           GREATEST(soi."quantity" - soi."deliveredQuantity"
             + COALESCE((SELECT SUM(doi."quantity") FROM "DeliveryOrderItem" doi
                 JOIN "DeliveryOrder" d ON d."id" = doi."deliveryOrderId"
                 WHERE doi."salesOrderItemId" = soi."id" AND d."status" = 'PACKED'), 0)
             - COALESCE((SELECT SUM(ii."quantity") FROM "InvoiceItem" ii
                 JOIN "Invoice" i ON i."id" = ii."invoiceId"
                 WHERE ii."salesOrderItemId" = soi."id" AND (i."status" = 'ISSUED' OR i."id" = ${exclude})), 0), 0)
    FROM "SalesOrderItem" soi
    JOIN "SalesOrder" so ON so."id" = soi."salesOrderId"
    WHERE so."organizationId" = ${orgId}
      AND so."status" IN ('CONFIRMED', 'PARTIALLY_DELIVERED')
      AND soi."productId" IN (${Prisma.join(productIds)})
      AND COALESCE(soi."locationId", so."locationId") IS NOT NULL
      ${opts.locationId ? Prisma.sql`AND COALESCE(soi."locationId", so."locationId") = ${opts.locationId}` : Prisma.empty}
  `);
  for (const r of rows) add(r.productId, r.locationId, Number(r.quantity));
  return held;
}

// Units on SENT quotations still in date — offered, not held — and which quotations, so quoting
// or selling the same stock again shows a warning.
export async function offeredStock(
  client: Prisma.TransactionClient,
  orgId: string,
  productIds: string[],
): Promise<Map<string, { quantity: number; quotationNumbers: string[] }>> {
  const offered = new Map<string, { quantity: number; quotationNumbers: string[] }>();
  if (productIds.length === 0) return offered;
  const { today } = await holdContext(client, orgId);
  const rows = await client.$queryRaw<(HoldRow & { quotationNumber: string | null })[]>(Prisma.sql`
    SELECT qi."productId" AS "productId", COALESCE(qi."locationId", q."locationId") AS "locationId",
           q."quotationNumber" AS "quotationNumber", ${quotationLineRemaining('')} AS "quantity"
    ${quotationLines(orgId, 'offered', today, productIds, undefined)}
    ORDER BY q."sentAt" ASC
  `);
  for (const r of rows) {
    const qty = Number(r.quantity);
    if (qty <= 0) continue;
    const key = holdKey(r.productId, r.locationId);
    const entry = offered.get(key) ?? { quantity: 0, quotationNumbers: [] };
    entry.quantity += qty;
    if (r.quotationNumber && !entry.quotationNumbers.includes(r.quotationNumber)) entry.quotationNumbers.push(r.quotationNumber);
    offered.set(key, entry);
  }
  return offered;
}
