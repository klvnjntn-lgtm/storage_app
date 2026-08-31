// scripts/cleanup-stale-location-stock.ts
//
// ONE-TIME FIX: run once to remove stale Stock rows left at the old
// default Location after GdbImportService's default-location resolution
// switched to targeting "CENTRE" by name. Safe to delete this file after
// running it successfully.
//
// Usage:
//   npx ts-node scripts/cleanup-stale-location-stock.ts <organizationId> <staleLocationId>

import { PrismaClient } from '@prisma/client';

async function main() {
  const [organizationId, staleLocationId] = process.argv.slice(2);
  if (!organizationId || !staleLocationId) {
    console.error('Usage: ts-node cleanup-stale-location-stock.ts <organizationId> <staleLocationId>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const before = await prisma.stock.aggregate({
      where: { organizationId, locationId: staleLocationId },
      _count: true,
      _sum: { quantity: true },
    });
    console.log('About to delete:', before);

    const deleted = await prisma.stock.deleteMany({
      where: { organizationId, locationId: staleLocationId },
    });
    console.log('Removed stale stock rows:', deleted.count);
  } finally {
    await prisma.$disconnect();
  }
}

main();