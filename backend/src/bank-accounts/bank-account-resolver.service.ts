import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export type BankAccountSnapshot = {
  bankAccountId: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
};

const EMPTY_SNAPSHOT: BankAccountSnapshot = {
  bankAccountId: null,
  bankName: null,
  bankAccountNumber: null,
  bankAccountName: null,
};

@Injectable()
export class BankAccountResolverService {
  constructor(private prisma: PrismaService) {}

  // - explicitId === undefined: caller didn't touch bank selection —
  //   falls back to the org's current default account, if any.
  // - explicitId === null: caller explicitly wants no bank details on
  //   this document (distinct from "not provided").
  // - explicitId is a string: must be an active account owned by this
  //   org, or this throws — a stale/foreign/archived id should never
  //   silently degrade to "no bank details" on a printed document.
  async resolve(
    organizationId: string,
    explicitId: string | null | undefined,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<BankAccountSnapshot> {
    if (explicitId === null) {
      return EMPTY_SNAPSHOT;
    }

    const account =
      explicitId !== undefined
        ? await tx.organizationBankAccount.findFirst({
            where: { id: explicitId, organizationId, archivedAt: null },
          })
        : await tx.organizationBankAccount.findFirst({
            where: { organizationId, isDefault: true, archivedAt: null },
          });

    if (explicitId !== undefined && !account) {
      throw new BadRequestException('Selected bank account not found or no longer active');
    }

    if (!account) {
      return EMPTY_SNAPSHOT;
    }

    return {
      bankAccountId: account.id,
      bankName: account.bankName,
      bankAccountNumber: account.accountNumber,
      bankAccountName: account.accountName,
    };
  }
}