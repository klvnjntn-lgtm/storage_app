import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// The MECHANIC account is the workshop's one shop-PC login (its mechanics are Employees, listed on it), so
// a business has at most one. exceptUserId: the member being changed into it.
export async function assertNoOtherMechanicAccount(
  db: Pick<Prisma.TransactionClient, 'user'>,
  organizationId: string,
  exceptUserId?: string,
) {
  const other = await db.user.findFirst({
    where: { organizationId, role: 'MECHANIC', removedAt: null, ...(exceptUserId && { id: { not: exceptUserId } }) },
    select: { id: true },
  });
  if (other) throw new BadRequestException('This business already has its mechanic account — one is shared by the workshop');
}
