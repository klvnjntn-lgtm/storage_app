import { Prisma, PrismaClient } from '@prisma/client';
import { CENTRE_LOCATION_NAME, findOrCreateCentre, isWarehouseOpsActive } from '../organization-module/warehouse-ops-active';

export type CentreMergePlan = {
  organizationId: string;
  centre: { id: string | null; name: string; action: 'existing' | 'rename' | 'create' };
  sources: { id: string; name: string; stockRows: number }[];
  skipped?: string;
};

// Locations are a WAREHOUSE_OPS feature: every other org keeps its stock on
// one CENTRE location. This brings an org that still has several into that
// shape — stock summed into CENTRE, the others archived (history keeps
// pointing at them, as LocationService.merge does), and anything still open
// (drafts, open orders, unfinished jobs, serials on the shelf) moved to
// CENTRE so nothing tries to take stock from an archived location.
// Accounting is unaffected: it reports by branch, not location.
export async function mergeOrgIntoCentre(
  prisma: PrismaClient,
  organizationId: string,
  opts: { apply: boolean },
): Promise<CentreMergePlan> {
  const active = await prisma.location.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { stocks: true } } },
  });
  const existingCentre = active.find((l) => l.name.trim().toUpperCase() === CENTRE_LOCATION_NAME);
  const lone = !existingCentre && active.length === 1 ? active[0] : null;
  const centre: CentreMergePlan['centre'] = existingCentre
    ? { id: existingCentre.id, name: existingCentre.name, action: 'existing' }
    : lone
      ? { id: lone.id, name: lone.name, action: 'rename' }
      : { id: null, name: CENTRE_LOCATION_NAME, action: 'create' };
  const sources = active
    .filter((l) => l.id !== centre.id)
    .map((l) => ({ id: l.id, name: l.name, stockRows: l._count.stocks }));
  const plan: CentreMergePlan = { organizationId, centre, sources };

  if (sources.length > 0) {
    const sourceIds = sources.map((s) => s.id);
    const openTransfers = await prisma.stockTransfer.count({
      where: {
        organizationId,
        status: { in: ['DRAFT', 'IN_TRANSIT'] },
        OR: [{ fromLocationId: { in: sourceIds } }, { toLocationId: { in: sourceIds } }],
      },
    });
    if (openTransfers > 0) {
      plan.skipped = `${openTransfers} stock transfer(s) still open — receive or cancel them first`;
      return plan;
    }
  }
  if (!opts.apply || (centre.action === 'existing' && sources.length === 0)) return plan;

  await prisma.$transaction(
    async (tx) => {
      let centreId = centre.id;
      if (centre.action === 'rename') {
        await tx.location.update({ where: { id: centreId! }, data: { name: CENTRE_LOCATION_NAME } });
      } else if (centre.action === 'create') {
        centreId = (await findOrCreateCentre(tx, organizationId)).id;
      }
      if (sources.length === 0) return;
      const target = centreId!;
      const sourceIds = sources.map((s) => s.id);
      const inSources = { in: sourceIds };

      // Stock: summed into CENTRE under the same row lock as LocationService.merge.
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM "Stock"
        WHERE "locationId" IN (${Prisma.join(sourceIds)}) AND "organizationId" = ${organizationId}
        FOR UPDATE
      `);
      const rows = await tx.stock.findMany({ where: { organizationId, locationId: inSources } });
      const qtyByProduct = new Map<string, number>();
      for (const r of rows) qtyByProduct.set(r.productId, (qtyByProduct.get(r.productId) ?? 0) + Number(r.quantity));
      for (const [productId, qty] of qtyByProduct) {
        await tx.stock.upsert({
          where: { productId_locationId: { productId, locationId: target } },
          update: { quantity: { increment: qty } },
          create: { productId, locationId: target, quantity: qty, organizationId },
        });
      }
      await tx.stock.deleteMany({ where: { organizationId, locationId: inSources } });

      // Whatever is still open moves to CENTRE; finished history stays put.
      await tx.productSerial.updateMany({
        where: { organizationId, locationId: inSources, status: { in: ['IN_STOCK', 'IN_TRANSIT'] } },
        data: { locationId: target },
      });
      await tx.invoice.updateMany({ where: { organizationId, status: 'DRAFT', locationId: inSources }, data: { locationId: target } });
      await tx.invoiceItem.updateMany({
        where: { locationId: inSources, invoice: { organizationId, status: 'DRAFT' } },
        data: { locationId: target },
      });
      const openQuote = { in: ['DRAFT', 'SENT', 'ACCEPTED'] as ('DRAFT' | 'SENT' | 'ACCEPTED')[] };
      await tx.salesQuotation.updateMany({ where: { organizationId, status: openQuote, locationId: inSources }, data: { locationId: target } });
      await tx.salesQuotationItem.updateMany({
        where: { locationId: inSources, salesQuotation: { organizationId, status: openQuote } },
        data: { locationId: target },
      });
      const openOrder = { in: ['DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED'] as ('DRAFT' | 'CONFIRMED' | 'PARTIALLY_DELIVERED')[] };
      await tx.salesOrder.updateMany({ where: { organizationId, status: openOrder, locationId: inSources }, data: { locationId: target } });
      await tx.salesOrderItem.updateMany({
        where: { locationId: inSources, salesOrder: { organizationId, status: openOrder } },
        data: { locationId: target },
      });
      await tx.deliveryOrder.updateMany({ where: { organizationId, status: 'PACKED', locationId: inSources }, data: { locationId: target } });
      await tx.deliveryOrderItem.updateMany({
        where: { locationId: inSources, deliveryOrder: { organizationId, status: 'PACKED' } },
        data: { locationId: target },
      });
      await tx.purchaseOrder.updateMany({
        where: { organizationId, status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] }, locationId: inSources },
        data: { locationId: target },
      });
      await tx.workOrderItem.updateMany({
        where: {
          locationId: inSources,
          workOrder: { organizationId, status: { not: 'CANCELLED' }, invoices: { none: { status: 'ISSUED' } } },
        },
        data: { locationId: target },
      });

      await tx.location.updateMany({ where: { id: inSources, organizationId }, data: { archivedAt: new Date() } });
    },
    { timeout: 120_000 },
  );
  return plan;
}

// Every org that doesn't (currently) have WAREHOUSE_OPS.
export async function orgsWithoutWarehouseOps(prisma: PrismaClient): Promise<string[]> {
  const orgs = await prisma.organization.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  const result: string[] = [];
  for (const o of orgs) if (!(await isWarehouseOpsActive(prisma, o.id))) result.push(o.id);
  return result;
}
