import { ModuleKey, Prisma } from '@prisma/client';
import { ensureDefaultBranch } from '../branches/resolve-branch';

// For an Organization `modules` include: non-empty only while WAREHOUSE_OPS
// is enabled and unexpired (same rule as OrganizationModulesService).
// Locations are a WAREHOUSE_OPS feature — without it an org's stock all
// sits on a CENTRE location that documents shouldn't name.
export function warehouseOpsActiveInclude(): Prisma.Organization$modulesArgs {
  return {
    where: {
      module: ModuleKey.WAREHOUSE_OPS,
      enabled: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  };
}

// The same check as a query, for code that isn't loading the organization.
export async function isWarehouseOpsActive(
  client: Pick<Prisma.TransactionClient, 'organizationModule'>,
  organizationId: string,
): Promise<boolean> {
  const row = await client.organizationModule.findUnique({
    where: { organizationId_module: { organizationId, module: ModuleKey.WAREHOUSE_OPS } },
    select: { enabled: true, expiresAt: true },
  });
  return !!row?.enabled && (!row.expiresAt || row.expiresAt > new Date());
}

export const CENTRE_LOCATION_NAME = 'CENTRE';

// The org's CENTRE location, created on first need.
export async function findOrCreateCentre(
  client: Pick<Prisma.TransactionClient, 'location' | 'branch' | 'organization'>,
  organizationId: string,
) {
  const existing = await client.location.findFirst({
    where: { organizationId, archivedAt: null, name: { equals: CENTRE_LOCATION_NAME, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;
  // An archived CENTRE (e.g. merged away while the org had WAREHOUSE_OPS)
  // comes back rather than clashing with a new one on the same id.
  const archived = await client.location.findFirst({
    where: { id: `${organizationId}_centre`, organizationId },
  });
  if (archived) return client.location.update({ where: { id: archived.id }, data: { archivedAt: null } });
  const branch = await ensureDefaultBranch(client, organizationId);
  return client.location.create({
    data: { id: `${organizationId}_centre`, name: CENTRE_LOCATION_NAME, organizationId, branchId: branch.id },
  });
}
