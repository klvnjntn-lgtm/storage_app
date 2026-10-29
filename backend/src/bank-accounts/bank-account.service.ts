import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopedUser, bookingBranchId, scopedBranchId } from '../auth/branch-scope';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-accounts.dto';
import { BankAccountGLLinkService } from '../accounting/bank-account-gl-link.service';

@Injectable()
export class BankAccountService {
  constructor(
    private prisma: PrismaService,
    private bankAccountGLLink: BankAccountGLLinkService,
  ) {}

  // forBranchId: only the accounts a document of that branch may use
  // (shared + its own). A branch member always gets their own branch's.
  list(organizationId: string, includeArchived = false, user?: BranchScopedUser, forBranchId?: string) {
    const branchId = scopedBranchId(user) ?? forBranchId;
    return this.prisma.organizationBankAccount.findMany({
      where: {
        organizationId,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(branchId && { OR: [{ branchId: null }, { branchId }] }),
      },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Every new bank account needs a linked ChartOfAccount to post to —
  // without this, the first Payment/Expense/SupplierPayment/Payroll
  // against it fails at PostingRulesService's resolution step with a "no
  // linked GL account" error, with no way to fix it short of a direct DB
  // write (CreateBankAccountDto has no bankAccountId field for accounts).
  async create(organizationId: string, dto: CreateBankAccountDto, user?: BranchScopedUser) {
    const branchId = await this.validBranchId(organizationId, bookingBranchId(user, dto.branchId ?? null));
    return this.prisma.$transaction(async (tx) => {
      const bankAccount = await tx.organizationBankAccount.create({
        data: {
          organizationId,
          bankName: dto.bankName.trim(),
          accountNumber: dto.accountNumber.trim(),
          accountName: dto.accountName.trim(),
          branchId,
        },
      });
      await this.bankAccountGLLink.ensureLinkedAccount(organizationId, bankAccount, tx);
      return bankAccount;
    });
  }

  async update(organizationId: string, id: string, dto: UpdateBankAccountDto, user?: BranchScopedUser) {
    await this.assertOwned(organizationId, id, user);
    // Only MASTER moves an account between branches or makes it shared.
    const branchPatch =
      dto.branchId !== undefined && !scopedBranchId(user)
        ? { branchId: await this.validBranchId(organizationId, dto.branchId) }
        : {};
    // The org-wide default is for documents of every branch: MASTER's call.
    if (dto.isDefault && scopedBranchId(user)) {
      throw new BadRequestException('Only a master account can set the default bank account');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        // Only one default at a time — unset any other default first.
        await tx.organizationBankAccount.updateMany({
          where: { organizationId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      const updated = await tx.organizationBankAccount.update({
        where: { id },
        data: {
          ...(dto.bankName !== undefined && { bankName: dto.bankName.trim() }),
          ...(dto.accountNumber !== undefined && { accountNumber: dto.accountNumber.trim() }),
          ...(dto.accountName !== undefined && { accountName: dto.accountName.trim() }),
          ...branchPatch,
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        },
      });
      await this.bankAccountGLLink.syncLinkedAccount(organizationId, updated, tx);
      return updated;
    });
  }

  // Archive rather than delete — nothing references a bank account by FK
  // yet, but this keeps the door open (e.g. if a document ever snapshots
  // which account was quoted) without risking a dangling reference later.
  // Also clears isDefault.
  // Its ledger account goes inactive with it (history stays in the books) and comes back on restore.
  async archive(organizationId: string, id: string, user?: BranchScopedUser) {
    await this.assertOwned(organizationId, id, user);
    return this.prisma.$transaction(async (tx) => {
      const archived = await tx.organizationBankAccount.update({
        where: { id },
        data: { archivedAt: new Date(), isDefault: false },
      });
      await this.bankAccountGLLink.syncLinkedAccount(organizationId, archived, tx);
      return archived;
    });
  }

  async restore(organizationId: string, id: string, user?: BranchScopedUser) {
    await this.assertOwned(organizationId, id, user);
    return this.prisma.$transaction(async (tx) => {
      const restored = await tx.organizationBankAccount.update({
        where: { id },
        data: { archivedAt: null },
      });
      await this.bankAccountGLLink.syncLinkedAccount(organizationId, restored, tx);
      return restored;
    });
  }

  // A branch ADMIN manages their own branch's accounts; shared ones are
  // MASTER's.
  private async assertOwned(organizationId: string, id: string, user?: BranchScopedUser) {
    const account = await this.prisma.organizationBankAccount.findFirst({
      where: { id, organizationId },
    });
    if (!account) throw new NotFoundException('Bank account not found');
    const branchId = scopedBranchId(user);
    if (branchId && account.branchId !== branchId) {
      throw new NotFoundException('Bank account not found');
    }
    return account;
  }

  private async validBranchId(organizationId: string, branchId: string | null): Promise<string | null> {
    if (!branchId) return null;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('Branch not found');
    return branch.id;
  }
}