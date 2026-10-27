// scripts/merge-locations-into-centre.ts
//
// ONE-TIME: locations became a WAREHOUSE_OPS feature, so every org without
// it is brought down to its single CENTRE location — see
// src/location/merge-into-centre.ts for exactly what moves. Dry run by
// default: prints each org's plan and changes nothing. Orgs with stock
// transfers still open are skipped and listed.
//
// Usage:
//   npx ts-node src/scripts/merge-locations-into-centre.ts            # dry run, every org
//   npx ts-node src/scripts/merge-locations-into-centre.ts --apply    # do it
//   npx ts-node src/scripts/merge-locations-into-centre.ts --apply <organizationId>

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mergeOrgIntoCentre, orgsWithoutWarehouseOps } from '../location/merge-into-centre';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const only = args.find((a) => !a.startsWith('--'));

  const prisma = new PrismaClient();
  try {
    const orgIds = only ? [only] : await orgsWithoutWarehouseOps(prisma);
    let changed = 0;
    for (const orgId of orgIds) {
      const plan = await mergeOrgIntoCentre(prisma, orgId, { apply });
      const nothing = plan.centre.action === 'existing' && plan.sources.length === 0;
      if (nothing) continue;
      changed++;
      const sources = plan.sources.map((s) => `${s.name} (${s.stockRows} stock rows)`).join(', ') || '—';
      console.log(
        `${plan.skipped ? 'SKIPPED' : apply ? 'MERGED ' : 'WOULD  '} ${orgId}: CENTRE ${plan.centre.action}` +
          `${plan.centre.action === 'rename' ? ` from "${plan.centre.name}"` : ''}; merge in: ${sources}` +
          `${plan.skipped ? ` — ${plan.skipped}` : ''}`,
      );
    }
    console.log(`${orgIds.length} org(s) without WAREHOUSE_OPS checked, ${changed} needing changes.${apply ? '' : ' Dry run — rerun with --apply.'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
