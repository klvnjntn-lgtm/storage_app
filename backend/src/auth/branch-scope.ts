import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ensureDefaultBranch } from '../branches/resolve-branch';

// Branch isolation. An ADMIN or USER works at one branch (User.branchId)
// and only sees and books records there; MASTER sees every branch. The
// request user carries the result as `branchId` — null means unrestricted.

export type BranchScopedUser = { role?: string; branchId?: string | null } | null | undefined;

type Client = Pick<Prisma.TransactionClient, 'branch' | 'location' | 'organization'>;

// The branch a member is held to: their own while it's active, else the
// org's first. DRIVERs have no branch records to see.
export async function effectiveBranchId(
  client: Client,
  user: { role: string; organizationId: string; branchId: string | null; branch?: { archivedAt: Date | null } | null },
): Promise<string | null> {
  if (user.role !== 'ADMIN' && user.role !== 'USER') return null;
  if (user.branchId && user.branch && !user.branch.archivedAt) return user.branchId;
  return (await ensureDefaultBranch(client, user.organizationId)).id;
}

export function scopedBranchId(user: BranchScopedUser): string | null {
  return user?.branchId ?? null;
}

// A `where` fragment limiting a branch-tagged model to the user's branch.
export function branchWhere(user: BranchScopedUser): { branchId?: string } {
  const branchId = scopedBranchId(user);
  return branchId ? { branchId } : {};
}

// A record from another branch reads as missing, the same as another org's.
export function assertBranchAccess(user: BranchScopedUser, recordBranchId: string | null | undefined, what = 'Record') {
  const branchId = scopedBranchId(user);
  if (branchId && recordBranchId !== branchId) throw new NotFoundException(`${what} not found`);
}

// The branch a new or edited record is booked to: a restricted user's own
// (asking for another is refused), else whatever was asked for.
export function bookingBranchId<T extends string | null | undefined>(user: BranchScopedUser, requested: T): T | string {
  const branchId = scopedBranchId(user);
  if (!branchId) return requested;
  if (requested && requested !== branchId) throw new ForbiddenException('You can only work in your own branch');
  return branchId;
}

// A branch filter from a query string: restricted users always get theirs,
// MASTER gets what they asked for (or everything).
export function filterBranchId(user: BranchScopedUser, requested?: string | null): string | undefined {
  return scopedBranchId(user) ?? (requested || undefined);
}
