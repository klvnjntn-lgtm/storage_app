// scripts/backfill-imported-inventory.ts
//
// One-off: brings stock that came in through the Accurate (GDB) import into
// the ledger, for businesses imported before the import did that itself.
//
// Before 2026-11-11 the import set stock counts with no ledger entry, so
// the Inventory account of an imported business is short by the value of
// everything Accurate brought in (the Stock Value Check page shows it as a
// difference). This books that difference once, as opening stock: Dr
// Inventory, Cr Opening Balance Equity — the same entry the import now
// makes itself — dated today.
//
// Only a shortfall is booked. A ledger holding MORE than the stock is
// worth isn't something an import left behind; that's reported and left
// for a person to look into.
//
// Usage (from backend/, or /app in the container):
//   npx ts-node src/scripts/backfill-imported-inventory.ts --org <organizationId>           # dry run
//   npx ts-node src/scripts/backfill-imported-inventory.ts --org <organizationId> --apply   # writes
//
// Run it after the business's stock is otherwise right (any recount done),
// and check the Stock Value Check page afterwards. Running it twice books
// nothing the second time: the difference is gone.

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingReportsService } from '../accounting/accounting-reports.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { orgToday } from '../accounting/business-date';

async function main() {
  const args = process.argv.slice(2);
  const orgId = args[args.indexOf('--org') + 1];
  const apply = args.includes('--apply');
  if (!args.includes('--org') || !orgId || orgId.startsWith('--')) {
    console.error('Usage: backfill-imported-inventory.ts --org <organizationId> [--apply]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    if (!org) throw new Error(`No organization ${orgId}`);

    const check = await app.get(AccountingReportsService).getInventoryReconciliation(orgId);
    const shortfall = Math.round((check.stockValue - check.ledgerBalance) * 100) / 100;
    console.log(`${org.name}`);
    console.log(`  Inventory account: ${check.ledgerBalance.toLocaleString('id-ID')}`);
    console.log(`  Stock value:       ${check.stockValue.toLocaleString('id-ID')}`);
    console.log(`  Products in stock with no cost: ${check.productsWithoutCost.count} (not valued — set their cost first if they matter)`);
    console.log(`  Products below zero: ${check.productsBelowZero.count}`);

    if (shortfall <= 0) {
      console.log(
        shortfall === 0
          ? '  Nothing to book: the ledger already matches.'
          : `  The ledger holds ${(-shortfall).toLocaleString('id-ID')} MORE than the stock is worth. Not an import gap — nothing booked; look into it.`,
      );
      return;
    }

    console.log(`  To book as opening stock: ${shortfall.toLocaleString('id-ID')}`);
    if (!apply) {
      console.log('  Dry run — nothing written. Add --apply to book it.');
      return;
    }
    // One backfill per business: the fixed source id makes a second one fail
    // rather than book again whatever has drifted since.
    const already = await prisma.journalEntry.findFirst({
      where: { organizationId: orgId, sourceId: `accurate-stock-backfill:${orgId}`, status: 'POSTED' },
      select: { entryNumber: true },
    });
    if (already) {
      console.log(`  Already backfilled (${already.entryNumber}). A gap left now has another cause — nothing booked.`);
      return;
    }
    const entry = await prisma.$transaction(async (tx) =>
      app.get(PostingRulesService).postStockValueChange(
        orgId,
        {
          sourceId: `accurate-stock-backfill:${orgId}`,
          date: await orgToday(tx, orgId),
          memo: 'Opening stock from the Accurate import (booked afterwards)',
          amount: shortfall,
          counter: 'OPENING_BALANCE',
        },
        tx,
      ),
    );
    console.log(`  Booked as ${entry?.entryNumber}.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
