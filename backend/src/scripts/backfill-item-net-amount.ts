// scripts/backfill-item-net-amount.ts
//
// One-off data migration: fixes InvoiceItem/SalesOrderItem/SalesQuotationItem
// rows whose `netAmount` doesn't match `lineTotal - discountAmount`.
//
// Why this is needed: the migration that added the netAmount column
// (20260829121051_add_invoice_odometer_snapshot) defaulted every existing
// row to 0. backfill-item-discounts.ts later populated netAmount, but only
// for documents with a document-level discount > 0 — a document with no
// discount was never touched, so its items are still stuck at
// netAmount = 0 even though they have a real lineTotal. Since the printed
// item "Total" column reads netAmount (see A5Template/A4Template and
// InvoiceService.getOne()'s itemTotal: toNumber(item.netAmount)), those
// rows render "Rp 0" per line while the document's own stored total
// (unaffected by any of this) is correct.
//
// This script is the general fix: for every item, recompute
// netAmount = round2(lineTotal - discountAmount) and write it if it
// differs from what's stored. That covers the discount=0 case
// backfill-item-discounts.ts skipped, is a no-op for rows that script
// already fixed (their netAmount already matches the formula), and is a
// no-op for documents created after line-item-pricing.service.ts started
// computing netAmount correctly on every write.
//
// Deliberately does NOT touch discountAmount, discountType, discountValue,
// taxAmount, or the item's own `total` field, nor anything on the parent
// Invoice/SalesOrder/SalesQuotation row (subtotal/taxAmount/total/etc) —
// same safety invariant as backfill-item-discounts.ts: only the one
// field this bug is actually about gets written.
//
// Usage:
//   ts-node scripts/backfill-item-net-amount.ts            # dry run (default)
//   ts-node scripts/backfill-item-net-amount.ts --apply    # actually writes

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ItemRow {
  id: string | number;
  lineTotal: number;
  discountAmount: number;
  netAmount: number;
}

interface ModelConfig {
  label: string;
  findItems: () => Promise<ItemRow[]>;
  updateItem: (id: string | number, netAmount: number) => Promise<void>;
}

interface RunReport {
  model: string;
  itemsChecked: number;
  itemsMismatched: number;
  samples: { id: string | number; lineTotal: number; discountAmount: number; oldNetAmount: number; newNetAmount: number }[];
}

async function runModelFix(config: ModelConfig, apply: boolean): Promise<RunReport> {
  const items = await config.findItems();
  const report: RunReport = {
    model: config.label,
    itemsChecked: items.length,
    itemsMismatched: 0,
    samples: [],
  };

  for (const item of items) {
    const correct = round2(item.lineTotal - item.discountAmount);
    if (Math.abs(correct - item.netAmount) <= 0.001) continue;

    report.itemsMismatched += 1;
    if (report.samples.length < 10) {
      report.samples.push({
        id: item.id,
        lineTotal: item.lineTotal,
        discountAmount: item.discountAmount,
        oldNetAmount: item.netAmount,
        newNetAmount: correct,
      });
    }
    if (apply) {
      await config.updateItem(item.id, correct);
    }
  }

  return report;
}

const invoiceConfig: ModelConfig = {
  label: 'InvoiceItem',
  findItems: async () => {
    const items = await prisma.invoiceItem.findMany({
      select: { id: true, lineTotal: true, discountAmount: true, netAmount: true },
      orderBy: { id: 'asc' },
    });
    return items.map((i) => ({
      id: i.id,
      lineTotal: Number(i.lineTotal),
      discountAmount: Number(i.discountAmount),
      netAmount: Number(i.netAmount),
    }));
  },
  updateItem: async (id, netAmount) => {
    await prisma.invoiceItem.update({ where: { id: id as number }, data: { netAmount } });
  },
};

const salesOrderConfig: ModelConfig = {
  label: 'SalesOrderItem',
  findItems: async () => {
    const items = await prisma.salesOrderItem.findMany({
      select: { id: true, lineTotal: true, discountAmount: true, netAmount: true },
      orderBy: { id: 'asc' },
    });
    return items.map((i) => ({
      id: i.id,
      lineTotal: Number(i.lineTotal),
      discountAmount: Number(i.discountAmount),
      netAmount: Number(i.netAmount),
    }));
  },
  updateItem: async (id, netAmount) => {
    await prisma.salesOrderItem.update({ where: { id: id as string }, data: { netAmount } });
  },
};

const salesQuotationConfig: ModelConfig = {
  label: 'SalesQuotationItem',
  findItems: async () => {
    const items = await prisma.salesQuotationItem.findMany({
      select: { id: true, lineTotal: true, discountAmount: true, netAmount: true },
      orderBy: { id: 'asc' },
    });
    return items.map((i) => ({
      id: i.id,
      lineTotal: Number(i.lineTotal),
      discountAmount: Number(i.discountAmount),
      netAmount: Number(i.netAmount),
    }));
  },
  updateItem: async (id, netAmount) => {
    await prisma.salesQuotationItem.update({ where: { id: id as string }, data: { netAmount } });
  },
};

function printReport(report: RunReport, apply: boolean) {
  console.log(`\n=== ${report.model} ${apply ? '(APPLIED)' : '(DRY RUN)'} ===`);
  console.log(`Items checked:    ${report.itemsChecked}`);
  console.log(`Items ${apply ? 'fixed' : 'that would be fixed'}: ${report.itemsMismatched}`);
  if (report.samples.length > 0) {
    console.log(`-- Sample ${apply ? 'changes' : 'would-be changes'} (up to 10) --`);
    for (const s of report.samples) {
      console.log(
        `  [${s.id}] lineTotal=${s.lineTotal} discountAmount=${s.discountAmount} netAmount: ${s.oldNetAmount} -> ${s.newNetAmount}`,
      );
    }
  }
}

async function main() {
  const apply = process.argv.includes('--apply');

  if (!apply) {
    console.log('Running in DRY-RUN mode. No data will be modified. Pass --apply to write changes.');
  } else {
    console.log('Running in APPLY mode. This WILL modify InvoiceItem/SalesOrderItem/SalesQuotationItem.netAmount.');
  }

  const invoiceReport = await runModelFix(invoiceConfig, apply);
  printReport(invoiceReport, apply);

  const orderReport = await runModelFix(salesOrderConfig, apply);
  printReport(orderReport, apply);

  const quotationReport = await runModelFix(salesQuotationConfig, apply);
  printReport(quotationReport, apply);

  const totalMismatched = invoiceReport.itemsMismatched + orderReport.itemsMismatched + quotationReport.itemsMismatched;
  console.log(`\nTotal items ${apply ? 'fixed' : 'that would be fixed'} across all models: ${totalMismatched}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Backfill script failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
