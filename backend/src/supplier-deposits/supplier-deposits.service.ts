import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JournalSourceType, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { orgToday, parseDateOnly } from '../accounting/business-date';
import { resolveBranchId } from '../branches/resolve-branch';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { runSerializable } from '../prisma/serializable';
import { SupplierPaymentsService } from '../accounting/supplier-payments.service';

const EPS = 0.005;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Amounts = { amount: Prisma.Decimal; appliedAmount: Prisma.Decimal; refundedAmount: Prisma.Decimal };
export const remainingOf = (d: Amounts) => round2(Number(d.amount) - Number(d.appliedAmount) - Number(d.refundedAmount));

const LIST_INCLUDE = {
  supplier: { select: { id: true, name: true, npwp: true } },
  bankAccount: { select: { bankName: true, accountNumber: true } },
  branch: { select: { id: true, name: true } },
} satisfies Prisma.SupplierDepositInclude;

// Down payments to suppliers (uang muka pembelian): money paid before goods
// arrive. Held as an asset, then set against a PO's payable, or refunded.
@Injectable()
export class SupplierDepositsService {
  constructor(
    private prisma: PrismaService,
    private postingRules: PostingRulesService,
    private journal: JournalService,
    private numbering: DocumentNumberingService,
    private supplierPayments: SupplierPaymentsService,
  ) {}

  private present(d: Prisma.SupplierDepositGetPayload<{ include: typeof LIST_INCLUDE }>) {
    return {
      id: d.id,
      depositNumber: d.depositNumber,
      date: d.date.toISOString().slice(0, 10),
      supplier: d.supplier,
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
    filters: { branchId?: string; supplierId?: string; open?: boolean; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const where: Prisma.SupplierDepositWhereInput = {
      organizationId,
      ...(filters.branchId && { branchId: filters.branchId }),
      ...(filters.supplierId && { supplierId: filters.supplierId }),
      ...(filters.open && { voidedAt: null }),
    };
    if (filters.open) {
      // Whatever is left is a column sum, so it's filtered here, not in SQL.
      const rows = await this.prisma.supplierDeposit.findMany({ where, orderBy: { date: 'asc' }, include: LIST_INCLUDE });
      const open = rows.filter((d) => remainingOf(d) > EPS);
      return { data: open.slice((page - 1) * pageSize, page * pageSize).map((d) => this.present(d)), total: open.length, page, pageSize };
    }
    const [rows, total] = await Promise.all([
      this.prisma.supplierDeposit.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: LIST_INCLUDE,
      }),
      this.prisma.supplierDeposit.count({ where }),
    ]);
    return { data: rows.map((d) => this.present(d)), total, page, pageSize };
  }

  async create(
    organizationId: string,
    dto: { supplierId: string; amount: number; date?: string; method?: PaymentMethod; bankAccountId?: string; note?: string; branchId?: string | null },
    userId?: string,
  ) {
    if (!(dto.amount > 0)) throw new BadRequestException('Amount must be greater than zero');
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    const branchId = await resolveBranchId(this.prisma, organizationId, { branchId: dto.branchId });
    const method = dto.method ?? PaymentMethod.TRANSFER;
    const bankAccountId = await this.assertBank(organizationId, method, dto.bankAccountId, branchId);

    return this.prisma.$transaction(async (tx) => {
      const date = dto.date ? parseDateOnly(dto.date, 'date') : await orgToday(tx, organizationId);
      const depositNumber = await this.numbering.nextSequential(tx, organizationId, 'SUPPLIER_DEPOSIT', 'UMB', date);
      const deposit = await tx.supplierDeposit.create({
        data: {
          organizationId,
          branchId,
          supplierId: dto.supplierId,
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
      await this.postingRules.postSupplierDepositPaid(organizationId, deposit.id, tx);
      return this.present(deposit);
    });
  }

  private async getScoped(tx: Prisma.TransactionClient, organizationId: string, id: string, scope?: string) {
    const deposit = await tx.supplierDeposit.findFirst({ where: { id, organizationId, voidedAt: null } });
    if (!deposit || (scope && deposit.branchId !== scope)) throw new NotFoundException('Down payment not found');
    return deposit;
  }

  async voidDeposit(organizationId: string, id: string, reason: string | undefined, userId?: string, scope?: string) {
    return runSerializable(this.prisma, async (tx) => {
      const deposit = await this.getScoped(tx, organizationId, id, scope);
      if (Number(deposit.appliedAmount) > EPS || Number(deposit.refundedAmount) > EPS) {
        throw new BadRequestException('This down payment has been used or refunded, so it cannot be voided');
      }
      const entry = await this.journal.findPostedBySource(organizationId, JournalSourceType.SUPPLIER_DEPOSIT, deposit.id, tx);
      if (entry) await this.journal.voidEntry(organizationId, entry.id, userId, reason, tx);
      const updated = await tx.supplierDeposit.update({
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
    const method = dto.method ?? PaymentMethod.TRANSFER;
    return runSerializable(this.prisma, async (tx) => {
      const deposit = await this.getScoped(tx, organizationId, id, scope);
      const remaining = remainingOf(deposit);
      if (!(dto.amount > 0) || dto.amount > remaining + EPS) {
        throw new BadRequestException('The refund cannot be more than what is left of this down payment');
      }
      const bankAccountId = await this.assertBank(organizationId, method, dto.bankAccountId, deposit.branchId);
      const updated = await tx.supplierDeposit.update({
        where: { id },
        data: { refundedAmount: { increment: round2(dto.amount) } },
        include: LIST_INCLUDE,
      });
      await this.postingRules.postSupplierDepositRefund(organizationId, { depositId: id, amount: round2(dto.amount), method, bankAccountId, userId }, tx);
      return this.present(updated);
    });
  }

  // What can be used on this PO: the down payments of its supplier.
  async openForPurchaseOrder(organizationId: string, purchaseOrderId: string, scope?: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      select: { supplierId: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (!po.supplierId) return [];
    const rows = await this.prisma.supplierDeposit.findMany({
      where: { organizationId, supplierId: po.supplierId, voidedAt: null, ...(scope && { branchId: scope }) },
      orderBy: { date: 'asc' },
    });
    return rows
      .map((d) => ({ id: d.id, depositNumber: d.depositNumber, remaining: remainingOf(d) }))
      .filter((d) => d.remaining > EPS);
  }

  // Sets a down payment against what a PO owes. Recorded as an ordinary
  // SupplierPayment, so AP aging, the PO's outstanding and voiding all simply work.
  async apply(organizationId: string, id: string, purchaseOrderId: string, requested: number | undefined, userId?: string, scope?: string) {
    return runSerializable(this.prisma, async (tx) => {
      const deposit = await this.getScoped(tx, organizationId, id, scope);
      const po = await tx.purchaseOrder.findFirst({
        where: { id: purchaseOrderId, organizationId },
        select: { id: true, supplierId: true },
      });
      if (!po) throw new NotFoundException('Purchase order not found');
      if (po.supplierId !== deposit.supplierId) {
        throw new BadRequestException('This down payment belongs to another supplier');
      }
      const owed = await this.supplierPayments.getOutstanding(organizationId, purchaseOrderId, tx);
      if (owed <= EPS) throw new BadRequestException('This purchase order has nothing outstanding to pay yet');
      const left = remainingOf(deposit);
      if (left <= EPS) throw new BadRequestException('Nothing is left of this down payment');
      const amount = requested ?? round2(Math.min(owed, left));
      if (amount > owed + EPS || amount > left + EPS) {
        throw new BadRequestException('The amount is more than the purchase order owes or the down payment has left');
      }
      const payment = await tx.supplierPayment.create({
        data: {
          organizationId,
          purchaseOrderId,
          amount,
          method: PaymentMethod.OTHER,
          paidAt: new Date(),
          note: `Down payment ${deposit.depositNumber}`,
          recordedById: userId,
          supplierDepositId: deposit.id,
        },
      });
      await tx.supplierDeposit.update({ where: { id: deposit.id }, data: { appliedAmount: { increment: amount } } });
      await this.postingRules.postSupplierDepositApplied(organizationId, payment.id, tx);
      return payment;
    });
  }
}
