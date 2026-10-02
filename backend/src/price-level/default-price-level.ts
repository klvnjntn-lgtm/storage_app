import { Prisma, PrismaClient } from '@prisma/client';

type Client = Pick<PrismaClient, 'priceLevel'> | Prisma.TransactionClient;

export const DEFAULT_PRICE_LEVEL_NAME = 'Retail';

// Every org has exactly one default price level; its product prices are
// Product.sellingPrice. The migration created one for existing orgs; this
// covers orgs registered afterwards, lazily, on first use. Safe to race:
// the (organizationId, name) unique key makes a concurrent second create
// fail, and the retry then finds the winner's row.
export async function ensureDefaultPriceLevel(client: Client, organizationId: string) {
  const existing = await client.priceLevel.findFirst({
    where: { organizationId, isDefault: true },
  });
  if (existing) return existing;
  try {
    return await client.priceLevel.create({
      data: { organizationId, name: DEFAULT_PRICE_LEVEL_NAME, isDefault: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const raced = await client.priceLevel.findFirst({ where: { organizationId, isDefault: true } });
      if (raced) return raced;
      // A non-default level already uses the name — promote it.
      return client.priceLevel.update({
        where: { organizationId_name: { organizationId, name: DEFAULT_PRICE_LEVEL_NAME } },
        data: { isDefault: true, archivedAt: null },
      });
    }
    throw e;
  }
}
