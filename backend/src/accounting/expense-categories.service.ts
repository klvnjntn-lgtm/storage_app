import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './dto/expense.dto';

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