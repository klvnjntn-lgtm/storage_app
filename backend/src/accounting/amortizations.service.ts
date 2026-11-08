import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  AmortizationKind,
  AmortizationStatus,
  JournalSourceType,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runSerializable } from '../prisma/serializable';
import { PostingRulesService } from './posting-rules.service';
import { JournalService } from './journal.service';
import { parseDateOnly } from './business-date';
import { expenseBranchId } from './expenses.service';
import {
  addMonths,
  buildSchedule,
  chargeForMonth,
  cumulativeAfter,
  monthlyAmount,
  monthsDueThrough,
  round2,
  wholeMonthsBetween,
} from './amortization-schedule';
import {
  AmortizationPaymentDto,
  CreateAmortizationDto,
  UpdateAmortizationDto,
} from './dto/amortization.dto';

const EPS = 0.005;

type Row = Prisma.AmortizationGetPayload<{
  include: { expenseAccount: { select: { id: true; code: true; name: true } }; branch: { select: { name: true } } };
}> & { payments?: Prisma.AmortizationPaymentGetPayload<object>[] };

// Decimals as numbers, plus what the page shows without working it out: the monthly charge,
// months done, what's still to amortize (book value) and still to pay, and the next charge date.
function serialize(item: Row) {
  const cost = Number(item.cost);
  const accumulated = Number(item.accumulatedAmortization);
  const amountPaid = Number(item.amountPaid);
  const monthsDone = item.lastAmortizedThrough ? wholeMonthsBetween(item.startDate, item.lastAmortizedThrough) : 0;
  return {
    ...item,
    cost,
    accumulatedAmortization: accumulated,
    amountPaid,
    monthlyAmount: monthlyAmount(cost, item.usefulLifeMonths),
    monthsDone,
    bookValue: round2(cost - accumulated),
    balanceDue: round2(cost - amountPaid),
    nextChargeDate:
      item.status === AmortizationStatus.ACTIVE && monthsDone < item.usefulLifeMonths
        ? addMonths(item.startDate, monthsDone + 1)
        : null,
    ...(item.payments && { payments: item.payments.map((p) => ({ ...p, amount: Number(p.amount) })) }),
  };
}

const INCLUDE = {
  expenseAccount: { select: { id: true, code: true, name: true } },
  branch: { select: { name: true } },
} as const;

@Injectable()
export class AmortizationsService {
  constructor(
    private prisma: PrismaService,
    private postingRules: PostingRulesService,
    private journal: JournalService,
  ) {}

  async list(
    organizationId: string,
    filters: { status?: AmortizationStatus; kind?: AmortizationKind; branchId?: string },
  ) {
    const rows = await this.prisma.amortization.findMany({
      where: { organizationId, status: filters.status, kind: filters.kind, branchId: filters.branchId },
      include: INCLUDE,
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      take: 500,
    });
    return rows.map(serialize);
  }

  async get(organizationId: string, id: string) {
    const item = await this.prisma.amortization.findFirst({
      where: { id, organizationId },
      include: { ...INCLUDE, payments: { orderBy: { paidAt: 'desc' } } },
    });
    if (!item) throw new NotFoundException('Amortization not found');
    return {
      ...serialize(item),
      schedule: buildSchedule(Number(item.cost), item.usefulLifeMonths, item.startDate),
    };
  }

  // Records it and posts Intangible Assets / Prepaid Expenses against Expense Payable for the
  // whole cost, in the same transaction — never a row without its ledger entry. A payment made
  // at the same time goes in with it.
  async create(organizationId: string, dto: CreateAmortizationDto, userId?: string) {
    const expenseAccountId = dto.kind === AmortizationKind.PREPAID ? dto.expenseAccountId : undefined;
    if (dto.kind === AmortizationKind.PREPAID) {
      if (!expenseAccountId) {
        throw new BadRequestException('Choose the expense account a prepaid expense turns into each month');
      }
      const account = await this.prisma.chartOfAccount.findFirst({
        where: { id: expenseAccountId, organizationId },
        select: { type: true, isActive: true, name: true },
      });
      if (!account) throw new BadRequestException('expenseAccountId does not refer to an account of this organization');
      if (account.type !== AccountType.EXPENSE) {
        throw new BadRequestException(`"${account.name}" is not an expense account`);
      }
      if (!account.isActive) throw new BadRequestException(`"${account.name}" is archived`);
    }
    if (dto.payment && dto.payment.amount > dto.cost + EPS) {
      throw new BadRequestException('The payment is more than the cost');
    }
    if (dto.payment) await this.checkBankAccount(organizationId, dto.payment, dto.branchId ?? null);

    const id = await this.prisma.$transaction(async (tx) => {
      const item = await tx.amortization.create({
        data: {
          organizationId,
          kind: dto.kind,
          name: dto.name.trim(),
          category: dto.category?.trim() || null,
          branchId: await expenseBranchId(tx, organizationId, dto),
          startDate: parseDateOnly(dto.startDate, 'startDate'),
          cost: dto.cost,
          usefulLifeMonths: dto.usefulLifeMonths,
          expenseAccountId: expenseAccountId ?? null,
          notes: dto.notes?.trim() || null,
          userId,
        },
      });
      await this.postingRules.postAmortizationAcquired(organizationId, item.id, tx);
      if (dto.payment) {
        await this.addPayment(tx, organizationId, item.id, { ...dto.payment, paidAt: dto.payment.paidAt ?? dto.startDate }, userId);
      }
      return item.id;
    });
    return this.get(organizationId, id);
  }

  // Name, category and notes only: the cost, dates and accounts are in the ledger already.
  async update(organizationId: string, id: string, dto: UpdateAmortizationDto) {
    const item = await this.prisma.amortization.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!item) throw new NotFoundException('Amortization not found');
    await this.prisma.amortization.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.category !== undefined && { category: dto.category.trim() || null }),
        ...(dto.notes !== undefined && { notes: dto.notes.trim() || null }),
      },
    });
    return this.get(organizationId, id);
  }

  async recordPayment(organizationId: string, id: string, dto: AmortizationPaymentDto, userId?: string) {
    const item = await this.prisma.amortization.findFirst({ where: { id, organizationId }, select: { branchId: true } });
    if (!item) throw new NotFoundException('Amortization not found');
    await this.checkBankAccount(organizationId, dto, item.branchId);
    try {
      await runSerializable(this.prisma, (tx) => this.addPayment(tx, organizationId, id, dto, userId));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('Payment conflicted with a concurrent update, please retry');
      }
      throw e;
    }
    return this.get(organizationId, id);
  }

  // Only a shared bank account or the item's own branch's, and active.
  private async checkBankAccount(organizationId: string, dto: AmortizationPaymentDto, branchId: string | null) {
    const method = dto.method ?? PaymentMethod.CASH;
    if (method === PaymentMethod.CASH) return;
    if (!dto.bankAccountId) throw new BadRequestException(`bankAccountId is required for payment method ${method}`);
    const bank = await this.prisma.organizationBankAccount.findFirst({
      where: {
        id: dto.bankAccountId,
        organizationId,
        archivedAt: null,
        ...(branchId && { OR: [{ branchId: null }, { branchId }] }),
      },
    });
    if (!bank) throw new BadRequestException('bankAccountId does not refer to an active bank account for this organization');
  }

  private async addPayment(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
    dto: AmortizationPaymentDto,
    userId?: string,
  ) {
    const item = await tx.amortization.findFirst({
      where: { id, organizationId },
      select: { cost: true, amountPaid: true, startDate: true },
    });
    if (!item) throw new NotFoundException('Amortization not found');
    const balance = round2(Number(item.cost) - Number(item.amountPaid));
    if (!(dto.amount > 0)) throw new BadRequestException('Payment amount must be greater than zero');
    if (dto.amount > balance + EPS) throw new BadRequestException(`Payment of ${dto.amount} exceeds the balance due (${balance})`);
    const method = dto.method ?? PaymentMethod.CASH;

    const payment = await tx.amortizationPayment.create({
      data: {
        amortizationId: id,
        amount: dto.amount,
        method,
        paidAt: dto.paidAt ? parseDateOnly(dto.paidAt, 'paidAt') : new Date(),
        note: dto.note?.trim() || null,
        recordedById: userId,
        bankAccountId: method === PaymentMethod.CASH ? null : dto.bankAccountId,
      },
    });
    await tx.amortization.update({ where: { id }, data: { amountPaid: { increment: dto.amount } } });
    await this.postingRules.postAmortizationPayment(organizationId, payment.id, tx);
  }

  // Posts every month that has ended by `throughDate` and isn't posted yet — one journal entry per
  // month, dated on that month's schedule date, so each month's P&L carries its own share even
  // when months are caught up at once. Per item, in one transaction that first claims the item
  // (conditional on lastAmortizedThrough), so a repeated or concurrent run posts nothing twice.
  // An item that can't post (a closed fiscal period, an archived expense account) is skipped
  // with the reason, and the rest still go through.
  async runAmortization(organizationId: string, throughDate: Date) {
    const items = await this.prisma.amortization.findMany({
      where: { organizationId, status: AmortizationStatus.ACTIVE, startDate: { lt: throughDate } },
      orderBy: { startDate: 'asc' },
    });

    const posted: { id: string; name: string; months: number; amount: number }[] = [];
    const skipped: { id: string; name: string; reason: string }[] = [];

    for (const item of items) {
      const cost = Number(item.cost);
      const months = item.usefulLifeMonths;
      const done = item.lastAmortizedThrough ? wholeMonthsBetween(item.startDate, item.lastAmortizedThrough) : 0;
      const due = monthsDueThrough(item.startDate, months, throughDate);
      if (due <= done) continue;

      try {
        const amount = await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.amortization.updateMany({
            where: {
              id: item.id,
              organizationId,
              status: AmortizationStatus.ACTIVE,
              lastAmortizedThrough: item.lastAmortizedThrough,
            },
            data: {
              accumulatedAmortization: cumulativeAfter(cost, months, due),
              lastAmortizedThrough: addMonths(item.startDate, due),
              status: due >= months ? AmortizationStatus.COMPLETED : AmortizationStatus.ACTIVE,
            },
          });
          if (claimed.count === 0) return 0; // another run got here first

          let total = 0;
          for (let k = done + 1; k <= due; k++) {
            const date = addMonths(item.startDate, k);
            const charge = chargeForMonth(cost, months, k);
            await this.postingRules.postAmortizationCharge(
              organizationId,
              {
                amortizationId: item.id,
                date,
                sourceId: `${item.id}:month:${k}`,
                amount: charge,
                monthNumber: k,
              },
              tx,
            );
            total = round2(total + charge);
          }
          return total;
        });
        if (amount > 0) posted.push({ id: item.id, name: item.name, months: due - done, amount });
      } catch (e) {
        skipped.push({ id: item.id, name: item.name, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      throughDate,
      itemsAmortized: posted.length,
      total: round2(posted.reduce((s, p) => s + p.amount, 0)),
      entries: posted,
      skipped,
    };
  }

  // Ends it early (the licence was cancelled, the lease ended): what's left of the cost is
  // expensed on `date`, and an intangible comes off the balance sheet. Months already due are
  // left to runAmortization — run it first so they land in their own months.
  async writeOff(organizationId: string, id: string, date: Date) {
    const item = await this.prisma.amortization.findFirst({ where: { id, organizationId } });
    if (!item) throw new NotFoundException('Amortization not found');
    if (item.status !== AmortizationStatus.ACTIVE) throw new BadRequestException('Only an active amortization can be written off');
    if (date.getTime() < item.startDate.getTime()) throw new BadRequestException('The write-off date is before the start date');
    if (item.lastAmortizedThrough && date.getTime() < item.lastAmortizedThrough.getTime()) {
      throw new BadRequestException('The write-off date is before the last month already amortized');
    }

    const cost = Number(item.cost);
    const accumulatedBefore = Number(item.accumulatedAmortization);
    const remaining = round2(cost - accumulatedBefore);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.amortization.updateMany({
        where: { id, organizationId, status: AmortizationStatus.ACTIVE, accumulatedAmortization: item.accumulatedAmortization },
        data: { status: AmortizationStatus.WRITTEN_OFF, writtenOffAt: date, accumulatedAmortization: cost },
      });
      if (claimed.count === 0) throw new ConflictException('It changed while writing off — reload and try again');
      await this.postingRules.postAmortizationWriteOff(organizationId, { amortizationId: id, date, remaining, accumulatedBefore }, tx);
    });
    return this.get(organizationId, id);
  }

  // Only before anything real happened to it — no payment, no month amortized. After that it's
  // accounting history: write it off instead.
  async remove(organizationId: string, id: string, userId?: string, reason?: string) {
    const item = await this.prisma.amortization.findFirst({ where: { id, organizationId } });
    if (!item) throw new NotFoundException('Amortization not found');
    if (Number(item.amountPaid) > 0) throw new BadRequestException('It has payments recorded — it can only be written off');
    if (Number(item.accumulatedAmortization) > 0) {
      throw new BadRequestException('Months have been amortized already — it can only be written off');
    }

    const sourceType = item.kind === AmortizationKind.INTANGIBLE ? JournalSourceType.INTANGIBLE_ASSET : JournalSourceType.PREPAID_EXPENSE;
    await this.prisma.$transaction(async (tx) => {
      const entry = await this.journal.findPostedBySource(organizationId, sourceType, `${id}:acquired`, tx);
      if (entry) await this.journal.voidEntry(organizationId, entry.id, userId, reason, tx);
      await tx.amortization.delete({ where: { id } });
    });
    return { ok: true };
  }
}
