// scripts/backfill-fixed-asset-accounts.ts
//
// Run once with: npx ts-node src/scripts/backfill-fixed-asset-accounts.ts
//
// Seeds the six SystemAccountKeys the fixed-asset feature needs
// (FIXED_ASSETS, ACCUMULATED_DEPRECIATION, FIXED_ASSET_PAYABLE,
// DEPRECIATION_EXPENSE, GAIN_ON_ASSET_DISPOSAL, LOSS_ON_ASSET_DISPOSAL) for
// every organization that already has a Chart of Accounts — i.e. every org
// that was seeded (ChartOfAccountsSeedService.seedDefaults) before this
// feature existed. AccountResolverService.resolve() throws for any org
// missing one of these, so this must run before fixed-asset posting rules
// are exercised against pre-existing orgs.
//
// Safe to run multiple times: skips any systemKey an org already has.
// Code collisions (an org already using code "1500" etc. for a custom
// account) are resolved by appending "-FA", "-FA2", ... until an unused
// code is found, rather than failing the whole run.

import { PrismaClient, AccountType, NormalBalance, SystemAccountKey } from '@prisma/client';

const prisma = new PrismaClient();

const NEW_ACCOUNTS: { code: string; name: string; type: AccountType; normalBalance: NormalBalance; systemKey: SystemAccountKey }[] = [
  { code: '1500', name: 'Fixed Assets', type: AccountType.ASSET, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.FIXED_ASSETS },
  { code: '1510', name: 'Accumulated Depreciation', type: AccountType.ASSET, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.ACCUMULATED_DEPRECIATION },
  { code: '2400', name: 'Fixed Asset Payable', type: AccountType.LIABILITY, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.FIXED_ASSET_PAYABLE },
  { code: '6100', name: 'Depreciation Expense', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.DEPRECIATION_EXPENSE },
  { code: '4900', name: 'Gain on Disposal of Assets', type: AccountType.REVENUE, normalBalance: NormalBalance.CREDIT, systemKey: SystemAccountKey.GAIN_ON_ASSET_DISPOSAL },
  { code: '6910', name: 'Loss on Disposal of Assets', type: AccountType.EXPENSE, normalBalance: NormalBalance.DEBIT, systemKey: SystemAccountKey.LOSS_ON_ASSET_DISPOSAL },
];

async function backfillFixedAssetAccounts() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log(`Checking ${orgs.length} organization(s)...`);

  for (const org of orgs) {
    const existingAccounts = await prisma.chartOfAccount.findMany({
      where: { organizationId: org.id },
      select: { code: true, systemKey: true },
    });
    if (existingAccounts.length === 0) {
      console.log(`  [${org.name}] no Chart of Accounts yet — skipping (seedDefaults will cover it)`);
      continue;
    }

    const existingSystemKeys = new Set(existingAccounts.map((a) => a.systemKey).filter(Boolean));
    const usedCodes = new Set(existingAccounts.map((a) => a.code));

    for (const account of NEW_ACCOUNTS) {
      if (existingSystemKeys.has(account.systemKey)) continue;

      let code = account.code;
      let suffix = 1;
      while (usedCodes.has(code)) {
        code = suffix === 1 ? `${account.code}-FA` : `${account.code}-FA${suffix}`;
        suffix += 1;
      }
      usedCodes.add(code);

      await prisma.chartOfAccount.create({
        data: {
          organizationId: org.id,
          code,
          name: account.name,
          type: account.type,
          normalBalance: account.normalBalance,
          systemKey: account.systemKey,
        },
      });
      console.log(`  [${org.name}] created ${account.systemKey} as code "${code}"`);
    }
  }

  console.log('Done.');
}

backfillFixedAssetAccounts()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
