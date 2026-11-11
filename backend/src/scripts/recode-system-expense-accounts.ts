// scripts/recode-system-expense-accounts.ts
//
// Run with: npx ts-node src/scripts/recode-system-expense-accounts.ts
//
// Moves every organization's built-in expense accounts to their current codes:
// Penyesuaian Persediaan 5900 → 5400, Rugi Pelepasan Aset 5910 → 5500 and
// Beban Tanpa Kategori 5990 → 5600 (plus any older 6000s codes), sub-accounts
// with them. Postings follow account ids, so booked journals are unchanged.
// A target code that's already taken is skipped. Safe to run more than once.

import { PrismaClient } from '@prisma/client';
import { recodeExpenseAccounts } from '../accounting/expense-categories.service';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const org of orgs) {
    const moved = await prisma.$transaction((tx) => recodeExpenseAccounts(tx, org.id));
    if (moved) console.log(`  [${org.name}] recoded ${moved} account(s)`);
  }
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
