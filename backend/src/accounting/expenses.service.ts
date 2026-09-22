import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { JournalService } from '../accounting/journal.service';
import { CreateExpenseDto, MarkExpensePaidDto, RecordExpensePaymentDto } from './dto/expense.dto';
import { ExpenseStatus, JournalEntryStatus, JournalSourceType, PaymentMethod, Prisma } from '@prisma/client';

const EPS = 0.005; // half a cent: amounts are 2dp, so anything smaller is float noise

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function deriveExpenseStatus(amountPaid: number, total: number): ExpenseStatus {
  if (amountPaid <= 0) return ExpenseStatus.UNPAID;
  if (amountPaid >= total - EPS) return ExpenseStatus.PAID;
  return ExpenseStatus.PARTIALLY_PAID;
}

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
}  // CHANGED — now a thin wrapper around recordPayment() that pays off
  // whatever balance remains, in one shot. Kept for backward compatibility
  // with the existing "mark paid" action; a partially-paid expense can
  // still be finished off this way, it just no longer requires the expense
  // to have been UNPAID going in.
  async markPaid(organizationId: string, id: string, dto: MarkExpensePaidDto) {
    const expense = await this.get(organizationId, id);
    const balance = round2(Number(expense.amount) - Number(expense.amountPaid));
    if (balance <= EPS) {
      throw new BadRequestException('Expense is not UNPAID — it may already be paid, or does not exist');
    }

    return this.recordPayment(
      organizationId,
      id,
      {
        amount: balance,
        method: dto.paymentMethod,
        bankAccountId: dto.bankAccountId,
        paidAt: dto.paidAt,
      },
      undefined,
    );
  }

  // FIX — the actual partial-payment path. Mirrors PaymentService.recordPayment()
  // almost exactly: validates the amount doesn't exceed the remaining balance,
  // creates an ExpensePayment row (one per installment, so each gets its own
  // ledger entry — see postExpensePayment), and derives UNPAID/PARTIALLY_PAID/PAID
  // from the new amountPaid instead of flipping straight to PAID.
  async recordPayment(
    organizationId: string,
    expenseId: string,
    dto: RecordExpensePaymentDto,
    userId?: string,
  ) {
    if (!(dto.amount > 0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }
    if (Math.abs(round2(dto.amount) - dto.amount) > 1e-9) {
      throw new BadRequestException('Payment amount can have at most 2 decimal places');
    }

    const method = dto.method ?? PaymentMethod.CASH;
    if (method !== PaymentMethod.CASH) {
      if (!dto.bankAccountId) {
        throw new BadRequestException(`bankAccountId is required for payment method ${method}`);
      }
      const bankAccount = await this.prisma.organizationBankAccount.findFirst({
        where: { id: dto.bankAccountId, organizationId, archivedAt: null },
      });
      if (!bankAccount) {
        throw new BadRequestException('bankAccountId does not refer to an active bank account for this organization');
      }
    }

    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          const expense = await tx.expense.findFirst({
            where: { id: expenseId, organizationId },
            select: { id: true, amount: true, amountPaid: true, status: true },
          });
          if (!expense) throw new NotFoundException('Expense not found');

          const total = Number(expense.amount);
          const alreadyPaid = Number(expense.amountPaid);
          const balance = round2(total - alreadyPaid);

          if (dto.amount > balance + EPS) {
            throw new BadRequestException(
              `Payment of ${dto.amount} exceeds balance due (${balance})`,
            );
          }

          const newAmountPaid = round2(alreadyPaid + dto.amount);
          const newStatus = deriveExpenseStatus(newAmountPaid, total);

          const payment = await tx.expensePayment.create({
            data: {
              expenseId,
              amount: dto.amount,
              method,
              note: dto.note,
              recordedById: userId,
              createdAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
              // CASH is never tied to a specific bank account, same policy as Payment.
              bankAccountId: method === PaymentMethod.CASH ? null : dto.bankAccountId,
            },
          });

          const result = await tx.expense.update({
            where: { id: expenseId },
            data: {
              amountPaid: newAmountPaid,
              status: newStatus,
              // Kept for backward-compatible display (e.g. "last paid via") —
              // ExpensePayment is the source of truth for the full history.
              paymentMethod: method,
              bankAccountId: method === PaymentMethod.CASH ? null : dto.bankAccountId,
              // A successful payment always has newAmountPaid > 0, so
              // newStatus is never UNPAID here — only PARTIALLY_PAID or
              // PAID. paidAt marks when it became fully paid, not the date
              // of the latest installment, so it stays null until then.
              paidAt: newStatus === ExpenseStatus.PAID ? (dto.paidAt ? new Date(dto.paidAt) : new Date()) : null,
            },
            include: { category: true, payments: { orderBy: { createdAt: 'desc' } } },
          });

          // Cash/Bank (debit... credit) + Expense Payable, in the SAME
          // transaction. If this throws, the whole payment rolls back.
          await this.postingRules.postExpensePayment(organizationId, payment.id, tx);

          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      // Keep the response shape stable: amountPaid/payment amounts would
      // otherwise serialize as strings (Prisma Decimal).
      return {
        ...updated,
        amount: Number(updated.amount),
        amountPaid: Number(updated.amountPaid),
        payments: updated.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('Payment conflicted with a concurrent update, please retry');
      }
      throw e;
    }
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