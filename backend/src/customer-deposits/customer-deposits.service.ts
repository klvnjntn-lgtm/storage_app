import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JournalSourceType, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { orgToday, parseDateOnly } from '../accounting/business-date';
import { resolveBranchId } from '../branches/resolve-branch';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { runSerializable } from '../prisma/serializable';

const EPS = 0.005;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Amounts = { amount: Prisma.Decimal; appliedAmount: Prisma.Decimal; refundedAmount: Prisma.Decimal };
export const remainingOf = (d: Amounts) => round2(Number(d.amount) - Number(d.appliedAmount) - Number(d.refundedAmount));

const LIST_INCLUDE = {
  customer: { select: { id: true, name: true, npwp: true } },
  bankAccount: { select: { bankName: true, accountNumber: true } },
  branch: { select: { id: true, name: true } },
} satisfies Prisma.CustomerDepositInclude;

// Down payments (uang muka): money taken from a customer before there is an
// invoice. Held as a liability, then applied to invoices through
// PaymentService.applyDeposit, or refunded.
@Injectable()
export class CustomerDepositsService {
  constructor(
    private prisma: PrismaService,
    private postingRules: PostingRulesService,
    private journal: JournalService,
    private numbering: DocumentNumberingService,
  ) {}

  private present(d: Prisma.CustomerDepositGetPayload<{ include: typeof LIST_INCLUDE }>) {
    return {
      id: d.id,
      depositNumber: d.depositNumber,
      date: d.date.toISOString().slice(0, 10),
      customer: d.customer,
      branch: d.branch,
      amount: Number(d.amount),
      appliedAmount: Number(d.appliedAmount),
      refundedAmount: Number(d.refundedAmount),
      remaining: remainingOf(d),
      method: d.method,
      bankAccount: d.bankAccount,
      note: d.note,
      voidedAt: d.voidedAt,
      voidReason: d.voidReason,
    };
  }

  private async assertBank(organizationId: string, method: PaymentMethod, bankAccountId: string | undefined, branchId: string | null) {
    if (method === PaymentMethod.CASH) return null;
    if (!bankAccountId) throw new BadRequestException(`bankAccountId is required for payment method ${method}`);
    const bank = await this.prisma.organizationBankAccount.findFirst({
      where: { id: bankAccountId, organizationId, archivedAt: null, ...(branchId && { OR: [{ branchId: null }, { branchId }] }) },
      select: { id: true },
    });
    if (!bank) throw new BadRequestException('bankAccountId does not refer to an active bank account for this organization');
    return bank.id;
  }

  async list(
    organizationId: string,
    filters: { branchId?: string; customerId?: string; open?: boolean; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const where: Prisma.CustomerDepositWhereInput = {
      organizationId,
      ...(filters.branchId && { branchId: filters.branchId }),
      ...(filters.customerId && { customerId: filters.customerId }),
      ...(filters.open && { voidedAt: null }),
    };
    if (filters.open) {
      // Whatever is left is a column sum, so it's filtered here, not in SQL.
      const rows = await this.prisma.customerDeposit.findMany({ where, orderBy: { date: 'asc' }, include: LIST_INCLUDE });
      const open = rows.filter((d) => remainingOf(d) > EPS);
      return { data: open.slice((page - 1) * pageSize, page * pageSize).map((d) => this.present(d)), total: open.length, page, pageSize };
    }
    const [rows, total] = await Promise.all([
      this.prisma.customerDeposit.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: LIST_INCLUDE,
      }),
      this.prisma.customerDeposit.count({ where }),
    ]);
    return { data: rows.map((d) => this.present(d)), total, page, pageSize };
  }

  async create(
    organizationId: string,
    dto: { customerId: string; amount: number; date?: string; method?: PaymentMethod; bankAccountId?: string; note?: string; branchId?: string | null },
    userId?: string,
  ) {
    if (!(dto.amount > 0)) throw new BadRequestException('Amount must be greater than zero');
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const branchId = await resolveBranchId(this.prisma, organizationId, { branchId: dto.branchId });
    const method = dto.method ?? PaymentMethod.CASH;
    const bankAccountId = await this.assertBank(organizationId, method, dto.bankAccountId, branchId);

    return this.prisma.$transaction(async (tx) => {
      const date = dto.date ? parseDateOnly(dto.date, 'date') : await orgToday(tx, organizationId);
      const depositNumber = await this.numbering.nextSequential(tx, organizationId, 'CUSTOMER_DEPOSIT', 'UM', date);
      const deposit = await tx.customerDeposit.create({
        data: {
          organizationId,
          branchId,
          customerId: dto.customerId,
          depositNumber,
          date,
          amount: round2(dto.amount),
          method,
          bankAccountId,
          note: dto.note?.trim() || null,
          createdById: userId ?? null,
        },
        include: LIST_INCLUDE,
      });
      await this.postingRules.postDepositReceived(organizationId, deposit.id, tx);
      return this.present(deposit);
    });
  }

  private async getScoped(tx: Prisma.TransactionClient, organizationId: string, id: string, scope?: string) {
    const deposit = await tx.customerDeposit.findFirst({ where: { id, organizationId, voidedAt: null } });
    if (!deposit || (scope && deposit.branchId !== scope)) throw new NotFoundException('Down payment not found');
    return deposit;
  }

  async voidDeposit(organizationId: string, id: string, reason: string | undefined, userId?: string, scope?: string) {
    return runSerializable(this.prisma, async (tx) => {
      const deposit = await this.getScoped(tx, organizationId, id, scope);
      if (Number(deposit.appliedAmount) > EPS || Number(deposit.refundedAmount) > EPS) {
        throw new BadRequestException('This down payment has been used or refunded, so it cannot be voided');
      }
      const entry = await this.journal.findPostedBySource(organizationId, JournalSourceType.CUSTOMER_DEPOSIT, deposit.id, tx);
      if (entry) await this.journal.voidEntry(organizationId, entry.id, userId, reason, tx);
      const updated = await tx.customerDeposit.update({
        where: { id },
        data: { voidedAt: new Date(), voidedById: userId ?? null, voidReason: reason?.trim() || null },
        include: LIST_INCLUDE,
      });
      return this.present(updated);
    });
  }

  async refund(
    organizationId: string,
    id: string,
    dto: { amount: number; method?: PaymentMethod; bankAccountId?: string },
    userId?: string,
    scope?: string,
  ) {
    const method = dto.method ?? PaymentMethod.CASH;
    return runSerializable(this.prisma, async (tx) => {
      const deposit = await this.getScoped(tx, organizationId, id, scope);
      const remaining = remainingOf(deposit);
      if (!(dto.amount > 0) || dto.amount > remaining + EPS) {
        throw new BadRequestException('The refund cannot be more than what is left of this down payment');
      }
      const bankAccountId = await this.assertBank(organizationId, method, dto.bankAccountId, deposit.branchId);
      const updated = await tx.customerDeposit.update({
        where: { id },
        data: { refundedAmount: { increment: round2(dto.amount) } },
        include: LIST_INCLUDE,
      });
      await this.postingRules.postDepositRefund(organizationId, { depositId: id, amount: round2(dto.amount), method, bankAccountId, userId }, tx);
      return this.present(updated);
    });
  }
}
