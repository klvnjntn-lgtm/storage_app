// payments/payments.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceActivityEventType, JournalSourceType, Prisma, PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { JournalService } from '../accounting/journal.service';
import { RecordPaymentDto } from './dto/record-payment.dto';

const EPS = 0.005; // half a cent: amounts are 2dp, so anything smaller is float noise

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Exported so voidPayment() below can derive the same UNPAID/PARTIAL/PAID
// thresholds when removing a payment, instead of reimplementing them.
export function deriveStatus(amountPaid: number, total: number): PaymentStatus {
  if (amountPaid <= 0) return PaymentStatus.UNPAID;
  if (amountPaid >= total - EPS) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}

@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private postingRules: PostingRulesService,
    private journal: JournalService,
  ) {}

  async recordPayment(
    organizationId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
    userId?: string,
  ) {
    // Amount sanity, independent of the DTO decorators: positive, at most 2 decimals.
    if (!(dto.amount > 0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }
    if (Math.abs(round2(dto.amount) - dto.amount) > 1e-9) {
      throw new BadRequestException('Payment amount can have at most 2 decimal places');
    }

    // Bank account validation, done BEFORE opening the transaction. The
    // transaction runs at Serializable isolation, so every extra read inside
    // it widens the window for a serialization failure (P2034).
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
          const invoice = await tx.invoice.findFirst({
            where: { id: invoiceId, organizationId },
            select: { id: true, status: true, total: true, amountPaid: true, paymentStatus: true },
          });
          if (!invoice) throw new NotFoundException('Invoice not found');
          if (invoice.status !== 'ISSUED') {
            throw new BadRequestException('Payments can only be recorded against issued invoices');
          }

          // Both are Decimal(12,2) now; compare as 2dp numbers with a tolerance.
          const total = invoice.total.toNumber();
          const alreadyPaid = invoice.amountPaid.toNumber();
          const balance = round2(total - alreadyPaid);

          if (dto.amount > balance + EPS) {
            throw new BadRequestException(
              `Payment of ${dto.amount} exceeds balance due (${balance})`,
            );
          }

          const newAmountPaid = round2(alreadyPaid + dto.amount);

          const payment = await tx.payment.create({
            data: {
              invoiceId,
              amount: dto.amount,
              method,
              note: dto.note,
              recordedById: userId,
              // CASH is never tied to a specific bank account, so this is
              // forced null rather than trusting whatever the caller sent.
              bankAccountId: method === PaymentMethod.CASH ? null : dto.bankAccountId,
            },
          });

          const newStatus = deriveStatus(newAmountPaid, total);

          const result = await tx.invoice.update({
            where: { id: invoiceId },
            data: { amountPaid: newAmountPaid, paymentStatus: newStatus },
            include: { payments: { orderBy: { createdAt: 'desc' } } },
          });

          await tx.invoiceActivityEvent.create({
            data: {
              invoiceId,
              organizationId,
              userId,
              eventType: InvoiceActivityEventType.PAYMENT_RECORDED,
              reason: `Rp ${dto.amount.toLocaleString('id-ID')} via ${method}${dto.note ? ` — ${dto.note}` : ''}`,
            },
          });

          // MARKED_PAID fires only the moment this payment crossed the invoice
          // into PAID. invoice.paymentStatus is the status BEFORE this update.
          if (newStatus === PaymentStatus.PAID && invoice.paymentStatus !== PaymentStatus.PAID) {
            await tx.invoiceActivityEvent.create({
              data: {
                invoiceId,
                organizationId,
                userId,
                eventType: InvoiceActivityEventType.MARKED_PAID,
              },
            });
          }

          // Cash/Bank (debit) + AR (credit), in the SAME transaction. If this
          // throws, the whole payment rolls back.
          await this.postingRules.postPayment(organizationId, payment.id, tx);

          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      // Keep this endpoint's response shape stable: amountPaid and payment
      // amounts were numbers when they were Int columns. Prisma Decimals
      // would otherwise serialize as strings.
      return {
        ...updated,
        amountPaid: updated.amountPaid.toNumber(),
        payments: updated.payments.map((p) => ({ ...p, amount: p.amount.toNumber() })),
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('Payment conflicted with a concurrent update, please retry');
      }
      throw e;
    }
  }

  // FIX — reverses a mistaken/duplicate payment: voids its posted journal
  // entry (mirrors SupplierPaymentsService.void/ExpensesService.voidUnpaid —
  // this codebase's established idiom is reverse-and-flag on the ledger side,
  // hard-delete on the business row, since Payment has no status field to
  // soft-void), then recomputes Invoice.amountPaid/paymentStatus the same
  // way recordPayment derives them, just subtracting instead of adding.
  // journal.voidEntry() already enforces the closed-fiscal-period guard, so
  // this doesn't need its own copy of that check.
  async voidPayment(
    organizationId: string,
    invoiceId: string,
    paymentId: string,
    userId?: string,
    reason?: string,
  ) {
    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          const payment = await tx.payment.findFirst({
            where: { id: paymentId, invoiceId, invoice: { organizationId } },
            select: { id: true, amount: true },
          });
          if (!payment) throw new NotFoundException('Payment not found');

          const invoice = await tx.invoice.findFirst({
            where: { id: invoiceId, organizationId },
            select: { id: true, total: true, amountPaid: true },
          });
          if (!invoice) throw new NotFoundException('Invoice not found');

          const entry = await this.journal.findPostedBySource(
            organizationId,
            JournalSourceType.PAYMENT,
            payment.id,
            tx,
          );
          if (entry) {
            await this.journal.voidEntry(organizationId, entry.id, userId, reason, tx);
          }

          await tx.payment.delete({ where: { id: paymentId } });

          const total = invoice.total.toNumber();
          const alreadyPaid = invoice.amountPaid.toNumber();
          const newAmountPaid = round2(alreadyPaid - payment.amount.toNumber());
          const newStatus = deriveStatus(newAmountPaid, total);

          const result = await tx.invoice.update({
            where: { id: invoiceId },
            data: { amountPaid: newAmountPaid, paymentStatus: newStatus },
            include: { payments: { orderBy: { createdAt: 'desc' } } },
          });

          await tx.invoiceActivityEvent.create({
            data: {
              invoiceId,
              organizationId,
              userId,
              eventType: InvoiceActivityEventType.VOIDED,
              reason: `Payment of Rp ${payment.amount.toNumber().toLocaleString('id-ID')} voided${reason ? ` — ${reason}` : ''}`,
            },
          });

          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return {
        ...updated,
        amountPaid: updated.amountPaid.toNumber(),
        payments: updated.payments.map((p) => ({ ...p, amount: p.amount.toNumber() })),
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('Payment void conflicted with a concurrent update, please retry');
      }
      throw e;
    }
  }
}