import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, NormalBalance } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './dto/expense.dto';

// The usual Indonesian small-business expense heads, each with its own ledger account so the
// profit & loss shows them line by line. Codes 6000–6899 are operating expenses (beban
// operasional); 6900 and up are other expenses (beban lain-lain) — the same split the expenses
// page groups its categories by.
export const STANDARD_EXPENSE_CATEGORIES: { code: string; name: string }[] = [
  { code: '6200', name: 'Beban Sewa' },
  { code: '6210', name: 'Beban Listrik, Air & Telepon' },
  { code: '6220', name: 'Beban Internet' },
  { code: '6230', name: 'Beban Transportasi & BBM' },
  { code: '6240', name: 'Beban Perlengkapan & ATK' },
  { code: '6250', name: 'Beban Perbaikan & Pemeliharaan' },
  { code: '6260', name: 'Beban Iklan & Promosi' },
  { code: '6270', name: 'Beban Konsumsi' },
  { code: '6280', name: 'Beban Asuransi' },
  { code: '6290', name: 'Beban Ongkos Kirim' },
  { code: '6300', name: 'Beban Kebersihan & Keamanan' },
  { code: '6310', name: 'Beban Perizinan & Administrasi' },
  { code: '6320', name: 'Beban Operasional Lainnya' },
  { code: '6920', name: 'Beban Administrasi Bank' },
  { code: '6930', name: 'Beban Bunga' },
  { code: '6940', name: 'Beban Pajak & Retribusi' },
  { code: '6950', name: 'Beban Lain-lain' },
];

@Injectable()
export class ExpenseCategoriesService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.expenseCategory.findMany({
      where: { organizationId },
      include: { account: { select: { id: true, code: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async get(organizationId: string, id: string) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id, organizationId },
      include: { account: { select: { id: true, code: true, name: true } } },
    });
    if (!category) throw new NotFoundException('Expense category not found');
    return category;
  }

  async create(organizationId: string, dto: CreateExpenseCategoryDto) {
    if (dto.accountId) await this.assertAccountBelongsToOrg(organizationId, dto.accountId);

    const existing = await this.prisma.expenseCategory.findUnique({
      where: { organizationId_name: { organizationId, name: dto.name.trim() } },
    });
    if (existing) throw new BadRequestException(`An expense category named "${dto.name}" already exists`);

    return this.prisma.expenseCategory.create({
      data: { organizationId, name: dto.name.trim(), accountId: dto.accountId },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateExpenseCategoryDto) {
    await this.get(organizationId, id);
    if (dto.accountId) await this.assertAccountBelongsToOrg(organizationId, dto.accountId);

    return this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.accountId !== undefined && { accountId: dto.accountId }),
      },
    });
  }

  // Adds the standard categories (and their expense accounts) that aren't there yet. Safe to run
  // again: an existing category name or account code is reused, never duplicated. A code the
  // business already uses for a non-expense account is skipped rather than repurposed.
  async installStandard(organizationId: string) {
    const hasBooks = await this.prisma.chartOfAccount.count({ where: { organizationId } });
    if (!hasBooks) throw new BadRequestException('Set up the chart of accounts first (Accounting → Setup)');

    return this.prisma.$transaction(async (tx) => {
      let created = 0;
      const skipped: string[] = [];
      for (const std of STANDARD_EXPENSE_CATEGORIES) {
        const existingCategory = await tx.expenseCategory.findUnique({
          where: { organizationId_name: { organizationId, name: std.name } },
        });
        if (existingCategory) continue;
        let account = await tx.chartOfAccount.findUnique({
          where: { organizationId_code: { organizationId, code: std.code } },
        });
        if (account && account.type !== AccountType.EXPENSE) {
          skipped.push(std.name);
          continue;
        }
        if (!account) {
          account = await tx.chartOfAccount.create({
            data: {
              organizationId,
              code: std.code,
              name: std.name,
              type: AccountType.EXPENSE,
              normalBalance: NormalBalance.DEBIT,
            },
          });
        }
        await tx.expenseCategory.create({ data: { organizationId, name: std.name, accountId: account.id } });
        created++;
      }
      return { created, skipped };
    });
  }

  private async assertAccountBelongsToOrg(organizationId: string, accountId: string) {
    const account = await this.prisma.chartOfAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) throw new BadRequestException('accountId does not refer to a valid account for this organization');
    if (account.type !== AccountType.EXPENSE) {
      throw new BadRequestException(
        `Account "${account.name}" is type ${account.type}, not EXPENSE — an expense category must post to an expense account`,
      );
    }
  }
}