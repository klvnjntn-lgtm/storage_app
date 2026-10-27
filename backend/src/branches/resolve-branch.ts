import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Client = Pick<Prisma.TransactionClient, 'branch' | 'location' | 'organization'>;

// Every org has at least one branch; this makes it on first need, named
// after the business.
export async function ensureDefaultBranch(client: Client, organizationId: string) {
  const first = await client.branch.findFirst({
    where: { organizationId, archivedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (first) return first;
  const org = await client.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  return client.branch.create({ data: { organizationId, name: org?.name ?? 'Main' } });
}

// The branch a document is booked to: the one chosen (must be this org's
// and active), else the stock location's branch, else the org's first.
export async function resolveBranchId(
  client: Client,
  organizationId: string,
  opts: { branchId?: string | null; locationId?: string | null },
): Promise<string> {
  if (opts.branchId) {
    const branch = await client.branch.findFirst({
      where: { id: opts.branchId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('Branch not found');
    return branch.id;
  }
  if (opts.locationId) {
    const location = await client.location.findFirst({
      where: { id: opts.locationId, organizationId },
      select: { branchId: true },
    });
    if (location?.branchId) return location.branchId;
  }
  return (await ensureDefaultBranch(client, organizationId)).id;
}
