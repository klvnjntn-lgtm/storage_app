import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountResolverService } from '../accounting/account-resolver.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { JournalService } from '../accounting/journal.service';
import { CreateSupplierPaymentDto } from './dto/supplier-payment.dto';
import { JournalEntryStatus, JournalSourceType, PaymentMethod, Prisma, SystemAccountKey } from '@prisma/client';

@Injectable()
export class SupplierPaymentsService {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountResolverService,
    private postingRules: PostingRulesService,
    private journal: JournalService,
  ) {}

  async list(organizationId: string, purchaseOrderId?: string) {
    return this.prisma.supplierPayment.findMany({
      where: { organizationId, ...(purchaseOrderId && { purchaseOrderId }) },
      include: { purchaseOrder: { select: { poNumber: true, supplier: { select: { name: true } } } } },
      orderBy: { paidAt: 'desc' },
    });
  }

  async get(organizationId: string, id: string) {
    const payment = await this.prisma.supplierPayment.findFirst({
      where: { id, organizationId },
      include: { purchaseOrder: { select: { poNumber: true, supplier: { select: { name: true } } } } },
    });
    if (!payment) throw new NotFoundException('Supplier payment not found');
    return payment;
  }

  // Outstanding AP for a PO is computed from the SAME inputs
  // postGoodsReceipt() used to credit AP in the first place — sum of
  // (quantity × unitCost) across every GoodsReceipt against this PO,
  // minus payments already recorded — rather than from PurchaseOrder.total.
  // Those two numbers can legitimately differ (PO.total includes tax/
  // discount that isn't part of what actually posted to AP), so paying
  // against PO.total would let someone pay more or less than the real
  // ledger liability without any error ever surfacing.
  // Reads the AP actually credited by postGoodsReceipt() straight from the
  // ledger, rather than recomputing (qty × unitCost) here a second time.
  // That recomputation used to be equivalent to what got posted, but isn't
  // anymore now that postGoodsReceipt() allocates the PO's discount/tax
  // proportionally across receipts — duplicating that math here would just
  // create a second place for the two numbers to silently drift apart.
  // Reading the posted credit is the version that can't drift, by
  // definition: it's the same number, not a recomputation of it.
  async getOutstanding(organizationId: string, purchaseOrderId: string, tx: any = this.prisma): Promise<number> {
    const apAccountId = await this.accounts.resolve(organizationId, SystemAccountKey.ACCOUNTS_PAYABLE, tx);

    const receiptIds = (
      await tx.goodsReceipt.findMany({ where: { organizationId, purchaseOrderId }, select: { id: true } })
    ).map((r: { id: string }) => r.id);

    let totalCredited = 0;
    if (receiptIds.length > 0) {
      const lines = await tx.journalEntryLine.findMany({
        where: {
          accountId: apAccountId,
          journalEntry: {
            organizationId,
            status: JournalEntryStatus.POSTED,
            sourceType: JournalSourceType.GOODS_RECEIPT,
            sourceId: { in: receiptIds },
          },
        },
        select: { credit: true },
      });
      totalCredited = lines.reduce((sum: number, l: { credit: unknown }) => sum + Number(l.credit), 0);
    }

    const priorPayments = await tx.supplierPayment.aggregate({
      where: { organizationId, purchaseOrderId },
      _sum: { amount: true },
    });
    const totalPaid = Number(priorPayments._sum.amount ?? 0);

    return this.round2(totalCredited - totalPaid);
  }

  private round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  // Posts AP (debit) + Cash/Bank (credit) in the same transaction as the
  // row write — same "never create a document without its journal entry
  // committing atomically with it" rule as ExpensesService.create().
  async create(organizationId: string, userId: string | undefined, dto: CreateSupplierPaymentDto) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, organizationId },
    });
    if (!po) throw new BadRequestException('purchaseOrderId does not refer to a valid purchase order for this organization');

    if (dto.method !== PaymentMethod.CASH) {
      if (!dto.bankAccountId) {
        throw new BadRequestException(`bankAccountId is required for payment method ${dto.method}`);
      }
      const bankAccount = await this.prisma.organizationBankAccount.findFirst({
        where: { id: dto.bankAccountId, organizationId, archivedAt: null },
      });
      if (!bankAccount) {
        throw new BadRequestException('bankAccountId does not refer to an active bank account for this organization');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const outstanding = await this.getOutstanding(organizationId, dto.purchaseOrderId, tx);
      if (outstanding <= 0) {
        throw new BadRequestException('This purchase order has no outstanding balance to pay against');
      }
      if (dto.amount > outstanding) {
        throw new BadRequestException(
          `Cannot pay ${dto.amount} — only ${outstanding} is outstanding on this purchase order`,
        );
      }

      const payment = await tx.supplierPayment.create({
        data: {
          organizationId,
          purchaseOrderId: dto.purchaseOrderId,
          amount: dto.amount,
          method: dto.method,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
          note: dto.note?.trim(),
          recordedById: userId,
          bankAccountId: dto.method === PaymentMethod.CASH ? null : dto.bankAccountId,
        },
        
      });

      await this.postingRules.postSupplierPayment(organizationId, payment.id, tx);

      return payment;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  ;
    
  }

  // Reverses the journal entry and deletes the row. No PAID/UNPAID status
  // on SupplierPayment to gate this on (unlike Expense) — a payment either
  // exists or it doesn't — so this is available any time, same as
  // "void this document" elsewhere, and just as irreversible once called.
  async void(organizationId: string, id: string, userId?: string, reason?: string) {
    const payment = await this.get(organizationId, id);

    return this.prisma.$transaction(async (tx) => {
      const entry = await this.journal.findPostedBySource(
        organizationId,
        JournalSourceType.SUPPLIER_PAYMENT,
        payment.id,
        tx,
      );
      if (entry) {
        await this.journal.voidEntry(organizationId, entry.id, userId, reason, tx);
      }
      return tx.supplierPayment.delete({ where: { id } });
    });
  }
}