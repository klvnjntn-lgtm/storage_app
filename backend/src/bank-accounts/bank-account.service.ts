import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-accounts.dto';
import { BankAccountGLLinkService } from '../accounting/bank-account-gl-link.service';

@Injectable()
export class BankAccountService {
  constructor(
    private prisma: PrismaService,
    private bankAccountGLLink: BankAccountGLLinkService,
  ) {}

  list(organizationId: string, includeArchived = false) {
    return this.prisma.organizationBankAccount.findMany({
      where: {
        organizationId,
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Every new bank account needs a linked ChartOfAccount to post to —
  // without this, the first Payment/Expense/SupplierPayment/Payroll
  // against it fails at PostingRulesService's resolution step with a "no
  // linked GL account" error, with no way to fix it short of a direct DB
  // write (CreateBankAccountDto has no bankAccountId field for accounts).
  create(organizationId: string, dto: CreateBankAccountDto) {
    return this.prisma.$transaction(async (tx) => {
      const bankAccount = await tx.organizationBankAccount.create({
        data: {
          organizationId,
          bankName: dto.bankName.trim(),
          accountNumber: dto.accountNumber.trim(),
          accountName: dto.accountName.trim(),
        },
      });
      await this.bankAccountGLLink.ensureLinkedAccount(organizationId, bankAccount, tx);
      return bankAccount;
    });
  }

  async update(organizationId: string, id: string, dto: UpdateBankAccountDto) {
    await this.assertOwned(organizationId, id);

    if (dto.isDefault) {
      // Only one default at a time — unset any other default first,
      // same pattern as TaxRateService.update.
      return this.prisma.$transaction(async (tx) => {
        await tx.organizationBankAccount.updateMany({
          where: { organizationId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
        return tx.organizationBankAccount.update({
          where: { id },
          data: {
            ...(dto.bankName !== undefined && { bankName: dto.bankName.trim() }),
            ...(dto.accountNumber !== undefined && { accountNumber: dto.accountNumber.trim() }),
            ...(dto.accountName !== undefined && { accountName: dto.accountName.trim() }),
            isDefault: true,
          },
        });
      });
    }

    return this.prisma.organizationBankAccount.update({
      where: { id },
      data: {
        ...(dto.bankName !== undefined && { bankName: dto.bankName.trim() }),
        ...(dto.accountNumber !== undefined && { accountNumber: dto.accountNumber.trim() }),
        ...(dto.accountName !== undefined && { accountName: dto.accountName.trim() }),
        ...(dto.isDefault === false && { isDefault: false }),
      },
    });
  }

  // Archive rather than delete — nothing references a bank account by FK
  // yet, but this keeps the door open (e.g. if a document ever snapshots
  // which account was quoted) without risking a dangling reference later.
  // Also clears isDefault, same fix TaxRateService.archive applies.
  async archive(organizationId: string, id: string) {
    await this.assertOwned(organizationId, id);
    return this.prisma.organizationBankAccount.update({
      where: { id },
      data: { archivedAt: new Date(), isDefault: false },
    });
  }

  private async assertOwned(organizationId: string, id: string) {
    const account = await this.prisma.organizationBankAccount.findFirst({
      where: { id, organizationId },
    });
    if (!account) throw new NotFoundException('Bank account not found');
    return account;
  }
}