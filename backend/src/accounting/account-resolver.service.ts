import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SystemAccountKey } from '@prisma/client';

type Db = Prisma.TransactionClient | PrismaService;

// Posting rules never reference a ChartOfAccount UUID directly — they ask
// for "the AR account" or "the Payroll Payable account" by meaning. This
// keeps posting logic portable across orgs with different chart layouts,
// and makes the one-time COA setup the only place account wiring lives.
//
// Every method takes an optional `tx` — same convention as the rest of
// this codebase (TenantOwnershipService, LineItemPricingService, etc.).
// When called from inside a document service's transaction, pass that
// tx through so this reads/resolves against the same uncommitted data,
// not a separate connection.
@Injectable()
export class AccountResolverService {
  constructor(private prisma: PrismaService) {}

  async resolve(organizationId: string, key: SystemAccountKey, tx: Db = this.prisma): Promise<string> {
    const account = await tx.chartOfAccount.findUnique({
      where: { organizationId_systemKey: { organizationId, systemKey: key } },
      select: { id: true, isActive: true },
    });

    if (!account) {
      throw new InternalServerErrorException(
        `No Chart of Accounts entry is mapped to ${key} for this organization. ` +
          `Set one up in Accounting Settings before posting this document.`,
      );
    }
    if (!account.isActive) {
      throw new InternalServerErrorException(`The account mapped to ${key} is archived/inactive.`);
    }
    return account.id;
  }
}