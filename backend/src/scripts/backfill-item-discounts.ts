// scripts/backfill-item-discounts.ts
//
// One-off data migration: decomposes legacy document-level discounts
// (Invoice.discount, and later SalesQuotation.discount / SalesOrder.discount)
// into per-item discountAmount, so historical documents render correctly
// under the new per-item discount template.
//
// Usage:
//   ts-node scripts/backfill-item-discounts.ts            # dry run (default)
//   ts-node scripts/backfill-item-discounts.ts --apply    # actually writes
//
// Safety:
//   - Never writes to the document row (Invoice/SalesQuotation/SalesOrder)
//     at all — only InvoiceItem.discountType/discountValue/discountAmount/
//     netAmount. This is what guarantees Grand Total, Tax, Subtotal,
//     payments, and status are untouched: nothing else reads or writes them.
//   - A document is only touched if discount > 0 AND every one of its
//     items currently has discountAmount === 0. Any item already
//     nonzero skips the WHOLE document — no partial backfill.
//   - Naturally idempotent: once backfilled, items have discountAmount > 0,
//     so a re-run's "all items === 0" check fails and the document is
//     skipped as "already has per-item discounts".

import { PrismaClient, DiscountType } from '@prisma/client';

const prisma = new PrismaClient();

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Shared, reusable, pure allocation logic ----------------------------
// No Prisma, no I/O — this is the one algorithm every model reuses.

export interface AllocationInput {
  id: string | number;
  grossAmount: number;
}

export interface AllocationResult {
  id: string | number;
  discountAmount: number;
}

export function allocateProportionalDiscount(
  items: AllocationInput[],
  documentDiscount: number,
): AllocationResult[] {
  if (items.length === 0) {
    throw new Error('Cannot allocate discount across zero items');
  }
  const totalGross = round2(items.reduce((sum, i) => sum + i.grossAmount, 0));
  if (totalGross <= 0) {
    throw new Error('Cannot allocate discount: total gross amount is zero or negative');
  }

  const results: AllocationResult[] = [];
  let allocatedSoFar = 0;

  items.forEach((item, idx) => {
    const isLast = idx === items.length - 1;
    if (isLast) {
      // Remainder absorbs all rounding drift so the sum matches the
      // original document discount exactly, per the spec's rounding
      // requirement — this is intentionally NOT re-proportioned.
      const remainder = round2(documentDiscount - allocatedSoFar);
      results.push({ id: item.id, discountAmount: remainder });
      return;
    }
    const share = item.grossAmount / totalGross;
    const amount = round2(documentDiscount * share);
    allocatedSoFar = round2(allocatedSoFar + amount);
    results.push({ id: item.id, discountAmount: amount });
  });

  return results;
}

// ---- Generic per-model runner --------------------------------------------
// Each model (Invoice, SalesQuotation, SalesOrder) plugs in via this shape.
// Keeping the model-specific bits (field names, Prisma delegate calls) here
// and the allocation math above means the same algorithm is guaranteed to
// run identically for all three — no risk of the logic drifting apart.

interface DocCandidate {
  docId: string;
  discount: number;
}

interface ItemRow {
  itemId: string | number;
  grossAmount: number;
  discountAmount: number;
}

interface ModelConfig {
  label: string; // for reporting, e.g. "Invoice"
  findCandidateDocs: () => Promise<DocCandidate[]>;
  findItemsForDoc: (docId: string) => Promise<ItemRow[]>;
  updateItem: (itemId: string | number, discountAmount: number, netAmount: number, grossAmount: number) => Promise<void>;
}

interface DocReportEntry {
  docId: string;
  documentDiscount: number;
  itemCount: number;
  generatedDiscountTotal: number;
  status: 'would_apply' | 'applied' | 'skipped';
  skipReason?: string;
}

interface RunReport {
  model: string;
  candidatesFound: number;
  documentsAffected: number;
  itemsAffected: number;
  totalOriginalDiscount: number;
  totalGeneratedDiscount: number;
  skipped: DocReportEntry[];
  processed: DocReportEntry[];
}

async function runModelBackfill(config: ModelConfig, apply: boolean): Promise<RunReport> {
  const report: RunReport = {
    model: config.label,
    candidatesFound: 0,
    documentsAffected: 0,
    itemsAffected: 0,
    totalOriginalDiscount: 0,
    totalGeneratedDiscount: 0,
    skipped: [],
    processed: [],
  };

  const candidates = await config.findCandidateDocs();
  report.candidatesFound = candidates.length;

  for (const doc of candidates) {
    const items = await config.findItemsForDoc(doc.docId);

    if (items.length === 0) {
      report.skipped.push({
        docId: doc.docId,
        documentDiscount: doc.discount,
        itemCount: 0,
        generatedDiscountTotal: 0,
        status: 'skipped',
        skipReason: 'no items on document',
      });
      continue;
    }

    // Required condition: ALL items must currently be un-backfilled.
    // A single nonzero item means real per-item discounts already exist
    // (or a prior partial run happened) — skip the entire document rather
    // than guess which items are "real" vs "legacy".
    const alreadyHasItemDiscounts = items.some((i) => i.discountAmount !== 0);
    if (alreadyHasItemDiscounts) {
      report.skipped.push({
        docId: doc.docId,
        documentDiscount: doc.discount,
        itemCount: items.length,
        generatedDiscountTotal: 0,
        status: 'skipped',
        skipReason: 'one or more items already have a nonzero discountAmount',
      });
      continue;
    }

    let allocation: AllocationResult[];
    try {
      allocation = allocateProportionalDiscount(
        items.map((i) => ({ id: i.itemId, grossAmount: i.grossAmount })),
        doc.discount,
      );
    } catch (e) {
      report.skipped.push({
        docId: doc.docId,
        documentDiscount: doc.discount,
        itemCount: items.length,
        generatedDiscountTotal: 0,
        status: 'skipped',
        skipReason: e instanceof Error ? e.message : 'allocation failed',
      });
      continue;
    }

    const generatedTotal = round2(allocation.reduce((sum, a) => sum + a.discountAmount, 0));

    // Sanity check — must match exactly, per the spec's hard requirement.
    // If it doesn't (shouldn't happen given the algorithm above, but this
    // is a data migration touching money, so verify rather than trust),
    // skip and flag it as problematic instead of writing anything.
    if (Math.abs(generatedTotal - doc.discount) > 0.001) {
      report.skipped.push({
        docId: doc.docId,
        documentDiscount: doc.discount,
        itemCount: items.length,
        generatedDiscountTotal: generatedTotal,
        status: 'skipped',
        skipReason: `allocation mismatch: generated ${generatedTotal} != document discount ${doc.discount}`,
      });
      continue;
    }

    const entry: DocReportEntry = {
      docId: doc.docId,
      documentDiscount: doc.discount,
      itemCount: items.length,
      generatedDiscountTotal: generatedTotal,
      status: apply ? 'applied' : 'would_apply',
    };
    report.processed.push(entry);
    report.documentsAffected += 1;
    report.itemsAffected += items.length;
    report.totalOriginalDiscount = round2(report.totalOriginalDiscount + doc.discount);
    report.totalGeneratedDiscount = round2(report.totalGeneratedDiscount + generatedTotal);

    if (apply) {
      const grossById = new Map(items.map((i) => [i.itemId, i.grossAmount]));
      for (const a of allocation) {
        const gross = grossById.get(a.id)!;
        const netAmount = round2(gross - a.discountAmount);
        // NOTE: taxAmount and total on the item, and Invoice's own
        // subtotal/taxAmount/total, are deliberately NEVER touched here —
        // only discountType/discountValue/discountAmount/netAmount are
        // written. Historical tax was computed on gross lineTotal under
        // the old logic; recomputing it now would change a number the
        // spec explicitly says must not change.
        await config.updateItem(a.id, a.discountAmount, netAmount, gross);
      }
    }
  }

  return report;
}

// ---- Model-specific configs -----------------------------------------------

const invoiceConfig: ModelConfig = {
  label: 'Invoice',
  findCandidateDocs: async () => {
    const invoices = await prisma.invoice.findMany({
      where: { discount: { gt: 0 } },
      select: { id: true, discount: true },
      orderBy: { id: 'asc' },
    });
    return invoices.map((inv) => ({ docId: inv.id, discount: Number(inv.discount) }));
  },
  findItemsForDoc: async (invoiceId) => {
    const items = await prisma.invoiceItem.findMany({
      where: { invoiceId },
      select: { id: true, lineTotal: true, discountAmount: true },
      orderBy: { id: 'asc' },
    });
    return items.map((i) => ({
      itemId: i.id,
      grossAmount: Number(i.lineTotal),
      discountAmount: Number(i.discountAmount),
    }));
  },
  updateItem: async (itemId, discountAmount, netAmount) => {
    await prisma.invoiceItem.update({
      where: { id: itemId as number },
      data: {
        discountType: DiscountType.FIXED,
        discountValue: discountAmount,
        discountAmount,
        netAmount,
      },
    });
  },
};

// NOT YET LIVE — SalesQuotationService doesn't implement per-item discount
// writes yet (pending), so there should be no real candidates here today.
// Wired up now so the same algorithm applies automatically once that
// service exists, without a second migration script needing to be written.
const salesQuotationConfig: ModelConfig = {
  label: 'SalesQuotation',
  findCandidateDocs: async () => {
    const docs = await prisma.salesQuotation.findMany({
      where: { discount: { gt: 0 } },
      select: { id: true, discount: true },
      orderBy: { id: 'asc' },
    });
    return docs.map((d) => ({ docId: d.id, discount: Number(d.discount) }));
  },
  findItemsForDoc: async (quotationId) => {
    const items = await prisma.salesQuotationItem.findMany({
      where: { salesQuotationId: quotationId },
      select: { id: true, lineTotal: true, discountAmount: true },
      orderBy: { id: 'asc' },
    });
    return items.map((i) => ({
      itemId: i.id,
      grossAmount: Number(i.lineTotal),
      discountAmount: Number(i.discountAmount),
    }));
  },
  updateItem: async (itemId, discountAmount, netAmount) => {
    await prisma.salesQuotationItem.update({
      where: { id: itemId as string },
      data: {
        discountType: DiscountType.FIXED,
        discountValue: discountAmount,
        discountAmount,
        netAmount,
      },
    });
  },
};

// Same "not yet live" caveat as salesQuotationConfig above.
const salesOrderConfig: ModelConfig = {
  label: 'SalesOrder',
  findCandidateDocs: async () => {
    const docs = await prisma.salesOrder.findMany({
      where: { discount: { gt: 0 } },
      select: { id: true, discount: true },
      orderBy: { id: 'asc' },
    });
    return docs.map((d) => ({ docId: d.id, discount: Number(d.discount) }));
  },
  findItemsForDoc: async (orderId) => {
    const items = await prisma.salesOrderItem.findMany({
      where: { salesOrderId: orderId },
      select: { id: true, lineTotal: true, discountAmount: true },
      orderBy: { id: 'asc' },
    });
    return items.map((i) => ({
      itemId: i.id,
      grossAmount: Number(i.lineTotal),
      discountAmount: Number(i.discountAmount),
    }));
  },
  updateItem: async (itemId, discountAmount, netAmount) => {
    await prisma.salesOrderItem.update({
      where: { id: itemId as string },
      data: {
        discountType: DiscountType.FIXED,
        discountValue: discountAmount,
        discountAmount,
        netAmount,
      },
    });
  },
};

// ---- Report printing -------------------------------------------------------

function printReport(report: RunReport, apply: boolean) {
  console.log(`\n=== ${report.model} ${apply ? '(APPLIED)' : '(DRY RUN)'} ===`);
  console.log(`Candidates found (discount > 0):     ${report.candidatesFound}`);
  console.log(`Documents ${apply ? 'backfilled' : 'that would be backfilled'}:       ${report.documentsAffected}`);
  console.log(`Items ${apply ? 'updated' : 'that would be updated'}:            ${report.itemsAffected}`);
  console.log(`Total original document discount:    ${report.totalOriginalDiscount}`);
  console.log(`Total generated item discount:        ${report.totalGeneratedDiscount}`);
  console.log(`Skipped documents:                    ${report.skipped.length}`);

  if (report.skipped.length > 0) {
    console.log(`\n-- Skipped --`);
    for (const s of report.skipped) {
      console.log(`  [${s.docId}] discount=${s.documentDiscount} items=${s.itemCount} reason="${s.skipReason}"`);
    }
  }

  if (report.processed.length > 0) {
    console.log(`\n-- ${apply ? 'Applied' : 'Would apply'} --`);
    for (const p of report.processed) {
      console.log(`  [${p.docId}] discount=${p.documentDiscount} items=${p.itemCount} generatedTotal=${p.generatedDiscountTotal}`);
    }
  }
}

// ---- Entry point ------------------------------------------------------------

async function main() {
  const apply = process.argv.includes('--apply');

  if (!apply) {
    console.log('Running in DRY-RUN mode. No data will be modified. Pass --apply to write changes.');
  } else {
    console.log('Running in APPLY mode. This WILL modify InvoiceItem/SalesQuotationItem/SalesOrderItem rows.');
  }

  const invoiceReport = await runModelBackfill(invoiceConfig, apply);
  printReport(invoiceReport, apply);

  const quotationReport = await runModelBackfill(salesQuotationConfig, apply);
  printReport(quotationReport, apply);

  const orderReport = await runModelBackfill(salesOrderConfig, apply);
  printReport(orderReport, apply);

  const totalSkipped =
    invoiceReport.skipped.length + quotationReport.skipped.length + orderReport.skipped.length;
  if (totalSkipped > 0) {
    console.log(`\n⚠ ${totalSkipped} document(s) were skipped — review the "Skipped" sections above before re-running.`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Backfill script failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});