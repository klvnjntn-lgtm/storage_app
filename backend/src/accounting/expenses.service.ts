import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { JournalService } from '../accounting/journal.service';
import { CreateExpenseDto, MarkExpensePaidDto } from './dto/expense.dto';
import { ExpenseStatus, JournalEntryStatus, JournalSourceType, PaymentMethod } from '@prisma/client';
@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private postingRules: PostingRulesService,
    private journal: JournalService,
  ) {}

  async list(
    organizationId: string,
    filters: { status?: ExpenseStatus; categoryId?: string; from?: Date; to?: Date; page?: number; pageSize?: number },
  ) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;

    const where = {
      organizationId,
      status: filters.status,
      categoryId: filters.categoryId,
      ...((filters.from || filters.to) && {
        expenseDate: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lte: filters.to }) },
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.expense.findMany({
        where,
        include: { category: true, location: { select: { name: true } } },
        orderBy: { expenseDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async get(organizationId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, organizationId },
      include: { category: true, location: { select: { name: true } } },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  // Posts Expense (debit) + Expense Payable (credit) in the SAME
  // transaction as the row write — never create an Expense row without a
  // matching journal entry existing by the time this call returns. If
  // postingRules throws (e.g. no Chart of Accounts configured yet), the
  // whole transaction rolls back and no orphaned Expense row is left
  // behind for someone to find later with no ledger trail.
  async create(organizationId: string, dto: CreateExpenseDto) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: dto.categoryId, organizationId },
    });
    if (!category) throw new BadRequestException('categoryId does not refer to a valid category for this organization');

    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({ where: { id: dto.locationId, organizationId } });
      if (!location) throw new BadRequestException('locationId does not refer to a valid location for this organization');
    }

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          organizationId,
          categoryId: dto.categoryId,
          locationId: dto.locationId,
          description: dto.description?.trim(),
          amount: dto.amount,
          expenseDate: new Date(dto.expenseDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          status: ExpenseStatus.UNPAID,
        },
        include: { category: true },
      });

      await this.postingRules.postExpenseRecorded(organizationId, expense.id, tx);

      return expense;
    });
  }

  // Only description/dueDate/locationId are editable once recorded — the
  // amount, category, and date drove what was already posted to the
  // ledger, and this doesn't attempt to re-post a corrected amount (that
  // needs a void-and-recreate, same policy as Invoice's issued-edit
  // restrictions). Keeping this narrow on purpose rather than silently
  // letting the ledger drift from the document.
async update(
  organizationId: string,
  id: string,
  dto: { description?: string; dueDate?: string; locationId?: string },
) {
  const expense = await this.get(organizationId, id);
  if (expense.status === ExpenseStatus.PAID) {
    throw new BadRequestException('Cannot edit an expense that has already been paid');
  }

  if (dto.locationId) {
    const location = await this.prisma.location.findFirst({ where: { id: dto.locationId, organizationId } });
    if (!location) throw new BadRequestException('locationId does not refer to a valid location for this organization');
  }

  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.expense.update({
      where: { id },
      data: {
        ...(dto.description !== undefined && { description: dto.description.trim() }),
        ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
        ...(dto.locationId !== undefined && { locationId: dto.locationId || null }),
      },
    });

    // Keep the ledger's location tag in step. Only the expense (debit) line
    // carries a location; the payable line is untagged. This changes a
    // dimension tag, not an amount, so it doesn't need void-and-repost.
    if (dto.locationId !== undefined) {
      await tx.journalEntryLine.updateMany({
        where: {
          debit: { gt: 0 },
          journalEntry: {
            organizationId,
            sourceType: JournalSourceType.EXPENSE,
            sourceId: id,
            status: JournalEntryStatus.POSTED,
          },
        },
        data: { locationId: dto.locationId || null },
      });
    }

    return updated;
  });
}  // Posts Expense Payable (debit) + Cash/Bank (credit) in the same
  // transaction as the status flip to PAID.
  async markPaid(organizationId: string, id: string, dto: MarkExpensePaidDto) {
    if (dto.paymentMethod !== PaymentMethod.CASH) {
      if (!dto.bankAccountId) {
        throw new BadRequestException(`bankAccountId is required for payment method ${dto.paymentMethod}`);
      }
      const bankAccount = await this.prisma.organizationBankAccount.findFirst({
        where: { id: dto.bankAccountId, organizationId, archivedAt: null },
      });
      if (!bankAccount) {
        throw new BadRequestException('bankAccountId does not refer to an active bank account for this organization');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.expense.updateMany({
        where: { id, organizationId, status: ExpenseStatus.UNPAID },
        data: {
          status: ExpenseStatus.PAID,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          paymentMethod: dto.paymentMethod,
          bankAccountId: dto.paymentMethod === PaymentMethod.CASH ? null : dto.bankAccountId,
        },
      });
      if (claim.count === 0) {
        throw new BadRequestException('Expense is not UNPAID — it may already be paid, or does not exist');
      }

      await this.postingRules.postExpensePaid(organizationId, id, tx);

      return tx.expense.findUniqueOrThrow({ where: { id }, include: { category: true } });
    });
  }

  // Reverses both postings (the "recorded" and, if it happened, the "paid"
  // leg) and deletes the row. Only allowed before payment — an already-paid
  // expense should be corrected via a manual adjusting entry, not deleted,
  // since cash has genuinely left by that point.
  async voidUnpaid(organizationId: string, id: string, userId?: string, reason?: string) {
    const expense = await this.get(organizationId, id);
    if (expense.status !== ExpenseStatus.UNPAID) {
      throw new BadRequestException('Only an UNPAID expense can be voided — a paid one needs a manual adjusting entry instead');
    }

    return this.prisma.$transaction(async (tx) => {
      const entry = await this.journal.findPostedBySource(organizationId, JournalSourceType.EXPENSE, expense.id, tx);
      if (entry) {
        await this.journal.voidEntry(organizationId, entry.id, userId, reason, tx);
      }
      return tx.expense.delete({ where: { id } });
    });
  }
}