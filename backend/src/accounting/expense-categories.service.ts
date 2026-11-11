import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, NormalBalance, Prisma, SystemAccountKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './dto/expense.dto';

// The usual Indonesian small-business expense heads, each with its own ledger account so the
// profit & loss shows them line by line. Every expense sits in the 5000s: 5000–5899 operating
// expenses (beban operasional), 5900 and up other expenses (beban lain-lain) — the same split the
// expenses page groups its categories by. The built-in Penyesuaian Persediaan, Rugi Pelepasan Aset
// and Beban Tanpa Kategori follow the standard groups at 5400, 5500 and 5600. `was` is the code an
// earlier version used.
export const STANDARD_EXPENSE_CATEGORIES: { code: string; was: string; name: string }[] = [
  { code: '5200', was: '6200', name: 'Beban Sewa' },
  { code: '5210', was: '6210', name: 'Beban Listrik, Air & Telepon' },
  { code: '5220', was: '6220', name: 'Beban Internet' },
  { code: '5230', was: '6230', name: 'Beban Transportasi & BBM' },
  { code: '5240', was: '6240', name: 'Beban Perlengkapan & ATK' },
  { code: '5250', was: '6250', name: 'Beban Perbaikan & Pemeliharaan' },
  { code: '5260', was: '6260', name: 'Beban Iklan & Promosi' },
  { code: '5270', was: '6270', name: 'Beban Konsumsi' },
  { code: '5280', was: '6280', name: 'Beban Asuransi' },
  { code: '5290', was: '6290', name: 'Beban Ongkos Kirim' },
  { code: '5300', was: '6300', name: 'Beban Kebersihan & Keamanan' },
  { code: '5310', was: '6310', name: 'Beban Perizinan & Administrasi' },
  { code: '5320', was: '6320', name: 'Beban Operasional Lainnya' },
  { code: '5920', was: '6920', name: 'Beban Administrasi Bank' },
  { code: '5930', was: '6930', name: 'Beban Bunga' },
  { code: '5940', was: '6940', name: 'Beban Pajak & Retribusi' },
  { code: '5950', was: '6950', name: 'Beban Lain-lain' },
];

// The built-in expense accounts' earlier codes: first the 6000s, then (for the last three) 5900,
// 5910 and 5990 before they moved up behind the standard 5200/5300 groups.
const SYSTEM_EXPENSE_RECODE: { systemKey: SystemAccountKey; was: string[]; code: string }[] = [
  { systemKey: SystemAccountKey.SALARY_EXPENSE, was: ['6000'], code: '5100' },
  { systemKey: SystemAccountKey.DEPRECIATION_EXPENSE, was: ['6100'], code: '5110' },
  { systemKey: SystemAccountKey.INVENTORY_ADJUSTMENT, was: ['5900'], code: '5400' },
  { systemKey: SystemAccountKey.LOSS_ON_ASSET_DISPOSAL, was: ['6910', '5910'], code: '5500' },
  { systemKey: SystemAccountKey.UNCATEGORIZED_EXPENSE, was: ['6900', '5990'], code: '5600' },
];

// Moves the built-in and standard expense accounts still on an old code to their current one,
// sub-accounts (6200.1 → 5200.1) with them. Postings follow account ids, not codes, so nothing
// already booked changes. A code the business renamed, or a target code already taken, is left alone.
export async function recodeExpenseAccounts(tx: Prisma.TransactionClient, organizationId: string) {
  const accounts = await tx.chartOfAccount.findMany({
    where: { organizationId, type: AccountType.EXPENSE },
    select: { id: true, code: true, name: true, systemKey: true },
  });
  const taken = new Set(accounts.map((a) => a.code));
  let moved = 0;
  const move = async (from: string, to: string) => {
    if (taken.has(to)) return;
    for (const a of accounts) {
      if (a.code !== from && !a.code.startsWith(`${from}.`)) continue;
      const code = to + a.code.slice(from.length);
      if (taken.has(code)) continue;
      await tx.chartOfAccount.update({ where: { id: a.id }, data: { code } });
      taken.delete(a.code);
      taken.add(code);
      a.code = code;
      moved++;
    }
  };
  for (const r of SYSTEM_EXPENSE_RECODE) {
    const acc = accounts.find((a) => a.systemKey === r.systemKey);
    if (acc && r.was.includes(acc.code)) await move(acc.code, r.code);
  }
  for (const std of STANDARD_EXPENSE_CATEGORIES) {
    const acc = accounts.find((a) => a.code === std.was && a.name === std.name);
    if (acc) await move(std.was, std.code);
  }
  return moved;
}

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
      const recoded = await recodeExpenseAccounts(tx, organizationId);
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
      return { created, skipped, recoded };
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