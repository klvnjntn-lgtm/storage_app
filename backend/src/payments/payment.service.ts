// payments/payments.service.ts
import { runSerializable } from '../prisma/serializable';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InvoiceActivityEventType,
  InvoiceStatus,
  JournalSourceType,
  Prisma,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostingRulesService } from '../accounting/posting-rules.service';
import { JournalService } from '../accounting/journal.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ApplyCreditDto } from './dto/apply-credit.dto';
import { deriveStatus } from './payment-status.util';

const EPS = 0.005; // half a cent: amounts are 2dp, so anything smaller is float noise

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type Tx = Prisma.TransactionClient;
type MoneyFields = { total: Prisma.Decimal; amountPaid: Prisma.Decimal; creditedAmount: Prisma.Decimal };

// What the customer still owes (positive) or is owed back (negative) on an
// invoice: its total, less returns credited, less what has been paid.
function balanceOf(inv: MoneyFields) {
  return round2(inv.total.toNumber() - inv.creditedAmount.toNumber() - inv.amountPaid.toNumber());
}

// Customer credit held on an invoice: paid more than is still owed, which
// happens when goods on a paid invoice are returned.
function creditOf(inv: MoneyFields) {
  return Math.max(0, -balanceOf(inv));
}

// How a payment row moves the invoice's amountPaid (amounts are positive).
function signOf(kind: PaymentKind) {
  return kind === PaymentKind.PAYMENT || kind === PaymentKind.CREDIT_IN ? 1 : -1;
}

const idr = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private postingRules: PostingRulesService,
    private journal: JournalService,
  ) {}

  // Amount sanity and bank-account checks shared by payments and refunds.
  // Done BEFORE the Serializable transaction: every extra read inside it
  // widens the window for a serialization failure (P2034).
  private async validateMoneyMovement(organizationId: string, dto: RecordPaymentDto) {
    if (!(dto.amount > 0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }
    if (Math.abs(round2(dto.amount) - dto.amount) > 1e-9) {
      throw new BadRequestException('Amount can have at most 2 decimal places');
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
    return method;
  }

  // Re-derives amountPaid/paymentStatus after a payment row was added or
  // voided. `delta` is the change to amountPaid.
  private async applyToInvoice(tx: Tx, invoice: MoneyFields & { id: string }, delta: number) {
    const owed = round2(invoice.total.toNumber() - invoice.creditedAmount.toNumber());
    const newAmountPaid = round2(invoice.amountPaid.toNumber() + delta);
    return tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaid: newAmountPaid, paymentStatus: deriveStatus(newAmountPaid, owed) },
      include: { payments: { where: { voidedAt: null }, orderBy: { createdAt: 'desc' } } },
    });
  }

  // Keep this endpoint's response shape stable: amountPaid and payment
  // amounts were numbers when they were Int columns. Prisma Decimals would
  // otherwise serialize as strings.
  private present(updated: Prisma.InvoiceGetPayload<{ include: { payments: true } }>) {
    return {
      ...updated,
      amountPaid: updated.amountPaid.toNumber(),
      payments: updated.payments.map((p) => ({ ...p, amount: p.amount.toNumber() })),
    };
  }

  private async serializable<T>(fn: (tx: Tx) => Promise<T>, conflictMessage: string): Promise<T> {
    try {
      return await runSerializable(this.prisma, fn);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException(conflictMessage);
      }
      throw e;
    }
  }

  async recordPayment(
    organizationId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
    userId?: string,
  ) {
    const method = await this.validateMoneyMovement(organizationId, dto);

    const updated = await this.serializable(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId },
        select: { id: true, status: true, total: true, amountPaid: true, creditedAmount: true, paymentStatus: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== 'ISSUED') {
        throw new BadRequestException('Payments can only be recorded against issued invoices');
      }

      // A sales return credits part of the invoice (creditedAmount), so what
      // the customer still owes is measured against the net total.
      const balance = balanceOf(invoice);
      if (dto.amount > balance + EPS) {
        throw new BadRequestException(`Payment of ${dto.amount} exceeds balance due (${balance})`);
      }

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

      const result = await this.applyToInvoice(tx, invoice, dto.amount);

      await tx.invoiceActivityEvent.create({
        data: {
          invoiceId,
          organizationId,
          userId,
          eventType: InvoiceActivityEventType.PAYMENT_RECORDED,
          reason: `${idr(dto.amount)} via ${method}${dto.note ? ` — ${dto.note}` : ''}`,
        },
      });

      // MARKED_PAID fires only the moment this payment crossed the invoice
      // into PAID. invoice.paymentStatus is the status BEFORE this update.
      if (result.paymentStatus === PaymentStatus.PAID && invoice.paymentStatus !== PaymentStatus.PAID) {
        await tx.invoiceActivityEvent.create({
          data: { invoiceId, organizationId, userId, eventType: InvoiceActivityEventType.MARKED_PAID },
        });
      }

      // Cash/Bank (debit) + AR (credit), in the SAME transaction. If this
      // throws, the whole payment rolls back.
      await this.postingRules.postPayment(organizationId, payment.id, tx);

      return result;
    }, 'Payment conflicted with a concurrent update, please retry');

    return this.present(updated);
  }

  // Pays a customer's credit on this invoice back to them (a return against
  // a paid invoice leaves the customer owed money). Partial refunds are
  // fine; never more than the credit.
  async refund(organizationId: string, invoiceId: string, dto: RecordPaymentDto, userId?: string) {
    const method = await this.validateMoneyMovement(organizationId, dto);

    const updated = await this.serializable(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId },
        select: { id: true, status: true, total: true, amountPaid: true, creditedAmount: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== InvoiceStatus.ISSUED) {
        throw new BadRequestException('Refunds can only be made against issued invoices');
      }
      const credit = creditOf(invoice);
      if (credit <= 0) {
        throw new BadRequestException('This invoice has no customer credit to refund');
      }
      if (dto.amount > credit + EPS) {
        throw new BadRequestException(`Refund of ${dto.amount} exceeds the customer's credit on this invoice (${credit})`);
      }

      const refund = await tx.payment.create({
        data: {
          invoiceId,
          kind: PaymentKind.REFUND,
          amount: dto.amount,
          method,
          note: dto.note,
          recordedById: userId,
          bankAccountId: method === PaymentMethod.CASH ? null : dto.bankAccountId,
        },
      });

      const result = await this.applyToInvoice(tx, invoice, -dto.amount);

      await tx.invoiceActivityEvent.create({
        data: {
          invoiceId,
          organizationId,
          userId,
          eventType: InvoiceActivityEventType.REFUNDED,
          reason: `${idr(dto.amount)} refunded via ${method}${dto.note ? ` — ${dto.note}` : ''}`,
        },
      });

      // AR (debit) + Cash/Bank (credit), same transaction.
      await this.postingRules.postRefund(organizationId, refund.id, tx);

      return result;
    }, 'Refund conflicted with a concurrent update, please retry');

    return this.present(updated);
  }

  // Uses a customer's credit to pay this invoice. With sourceInvoiceId, the
  // credit comes from that invoice; without, from the customer's invoices
  // holding credit, oldest first. Amount defaults to as much as possible.
  //
  // No journal entry: credit is a negative AR balance on one invoice and
  // the debt a positive one on another — moving between them nets to zero
  // in the AR account. The paired CREDIT_OUT/CREDIT_IN rows record it.
  async applyCredit(organizationId: string, targetInvoiceId: string, dto: ApplyCreditDto, userId?: string) {
    if (dto.amount != null && Math.abs(round2(dto.amount) - dto.amount) > 1e-9) {
      throw new BadRequestException('Amount can have at most 2 decimal places');
    }

    const updated = await this.serializable(async (tx) => {
      const target = await tx.invoice.findFirst({
        where: { id: targetInvoiceId, organizationId },
        select: { id: true, status: true, total: true, amountPaid: true, creditedAmount: true, customerId: true, invoiceNumber: true },
      });
      if (!target) throw new NotFoundException('Invoice not found');
      if (target.status !== InvoiceStatus.ISSUED) {
        throw new BadRequestException('Credit can only be applied to an issued invoice');
      }
      if (!target.customerId) {
        throw new BadRequestException('Credit can only be applied to an invoice with a customer');
      }
      const balance = balanceOf(target);
      if (balance <= EPS) throw new BadRequestException('This invoice has nothing left to pay');

      const sources = await tx.invoice.findMany({
        where: {
          organizationId,
          customerId: target.customerId,
          status: InvoiceStatus.ISSUED,
          id: dto.sourceInvoiceId ?? { not: target.id },
        },
        select: { id: true, total: true, amountPaid: true, creditedAmount: true, invoiceNumber: true },
        orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
      });
      if (dto.sourceInvoiceId && (sources.length === 0 || dto.sourceInvoiceId === target.id)) {
        throw new BadRequestException('The credit must come from another issued invoice of the same customer');
      }
      const available = round2(sources.reduce((sum, s) => sum + creditOf(s), 0));
      if (available <= EPS) throw new BadRequestException('The customer has no credit to apply');

      const amount = dto.amount ?? Math.min(available, balance);
      if (amount > balance + EPS) {
        throw new BadRequestException(`Cannot apply ${amount} — only ${balance} is still owed on this invoice`);
      }
      if (amount > available + EPS) {
        throw new BadRequestException(`Cannot apply ${amount} — the customer only has ${available} of credit`);
      }

      let remaining = round2(amount);
      for (const source of sources) {
        if (remaining <= EPS) break;
        const take = round2(Math.min(creditOf(source), remaining));
        if (take <= 0) continue;

        const out = await tx.payment.create({
          data: {
            invoiceId: source.id,
            kind: PaymentKind.CREDIT_OUT,
            amount: take,
            method: PaymentMethod.OTHER,
            recordedById: userId,
            note: `Applied to invoice ${target.invoiceNumber ?? target.id}`,
          },
        });
        const into = await tx.payment.create({
          data: {
            invoiceId: target.id,
            kind: PaymentKind.CREDIT_IN,
            amount: take,
            method: PaymentMethod.OTHER,
            recordedById: userId,
            linkedPaymentId: out.id,
            note: `Credit from invoice ${source.invoiceNumber ?? source.id}`,
          },
        });
        await tx.payment.update({ where: { id: out.id }, data: { linkedPaymentId: into.id } });
        await this.applyToInvoice(tx, source, -take);
        await tx.invoiceActivityEvent.create({
          data: {
            invoiceId: source.id,
            organizationId,
            userId,
            eventType: InvoiceActivityEventType.CREDIT_APPLIED,
            reason: `${idr(take)} of credit applied to invoice ${target.invoiceNumber ?? target.id}`,
          },
        });
        await tx.invoiceActivityEvent.create({
          data: {
            invoiceId: target.id,
            organizationId,
            userId,
            eventType: InvoiceActivityEventType.CREDIT_APPLIED,
            reason: `${idr(take)} of credit from invoice ${source.invoiceNumber ?? source.id}`,
          },
        });
        remaining = round2(remaining - take);
      }

      const fresh = await tx.invoice.findUniqueOrThrow({
        where: { id: target.id },
        select: { id: true, total: true, amountPaid: true, creditedAmount: true },
      });
      return this.applyToInvoice(tx, fresh, round2(amount - remaining));
    }, 'Applying credit conflicted with a concurrent update, please retry');

    return this.present(updated);
  }

  // Credit picture around one invoice: what credit it holds (refundable or
  // applicable elsewhere), what credit the customer holds on other invoices
  // (applicable here), and which of their invoices still have money owed.
  async getCreditInfo(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true, total: true, amountPaid: true, creditedAmount: true, customerId: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const others = invoice.customerId
      ? await this.prisma.invoice.findMany({
          where: { organizationId, customerId: invoice.customerId, status: InvoiceStatus.ISSUED, id: { not: invoice.id } },
          select: { id: true, invoiceNumber: true, issuedAt: true, total: true, amountPaid: true, creditedAmount: true },
          orderBy: { issuedAt: 'asc' },
        })
      : [];

    const sources = others
      .map((o) => ({ invoiceId: o.id, invoiceNumber: o.invoiceNumber, credit: creditOf(o) }))
      .filter((o) => o.credit > 0);
    const targets = others
      .map((o) => ({ invoiceId: o.id, invoiceNumber: o.invoiceNumber, balance: balanceOf(o) }))
      .filter((o) => o.balance > 0);

    return {
      credit: creditOf(invoice),
      balance: Math.max(0, balanceOf(invoice)),
      customerCredit: round2(sources.reduce((sum, s) => sum + s.credit, 0)),
      sources,
      targets,
    };
  }

  // Reverses a payment row. A payment or refund also has its journal entry
  // voided; a credit application is undone as a pair (both invoices). A
  // payment can't be voided while money from it has since been refunded or
  // applied elsewhere — that would leave the invoice paid less than zero.
  async voidPayment(
    organizationId: string,
    invoiceId: string,
    paymentId: string,
    userId?: string,
    reason?: string,
  ) {
    const updated = await this.serializable(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, invoiceId, invoice: { organizationId }, voidedAt: null },
        select: { id: true, amount: true, kind: true, linkedPaymentId: true, invoiceId: true },
      });
      if (!payment) throw new NotFoundException('Payment not found');

      const legs = [payment];
      if (payment.kind === PaymentKind.CREDIT_OUT || payment.kind === PaymentKind.CREDIT_IN) {
        const other = payment.linkedPaymentId
          ? await tx.payment.findFirst({
              where: { id: payment.linkedPaymentId, voidedAt: null },
              select: { id: true, amount: true, kind: true, linkedPaymentId: true, invoiceId: true },
            })
          : null;
        if (other) legs.push(other);
      }

      for (const leg of legs) {
        const invoice = await tx.invoice.findFirstOrThrow({
          where: { id: leg.invoiceId, organizationId },
          select: { id: true, total: true, amountPaid: true, creditedAmount: true },
        });
        const delta = -signOf(leg.kind) * leg.amount.toNumber();
        if (invoice.amountPaid.toNumber() + delta < -EPS) {
          throw new BadRequestException(
            'Money from this payment has since been refunded or applied to another invoice — void that first',
          );
        }

        if (leg.kind === PaymentKind.PAYMENT || leg.kind === PaymentKind.REFUND) {
          const entry = await this.journal.findPostedBySource(organizationId, JournalSourceType.PAYMENT, leg.id, tx);
          if (entry) await this.journal.voidEntry(organizationId, entry.id, userId, reason, tx);
        }

        // Kept, not deleted, so the payment history stays complete; every
        // read filters voidedAt: null.
        await tx.payment.update({
          where: { id: leg.id },
          data: { voidedAt: new Date(), voidedById: userId ?? null, voidReason: reason?.trim() || null },
        });
        await this.applyToInvoice(tx, invoice, delta);

        const label =
          leg.kind === PaymentKind.REFUND ? 'Refund' : leg.kind === PaymentKind.PAYMENT ? 'Payment' : 'Credit application';
        await tx.invoiceActivityEvent.create({
          data: {
            invoiceId: leg.invoiceId,
            organizationId,
            userId,
            eventType: InvoiceActivityEventType.VOIDED,
            reason: `${label} of ${idr(leg.amount.toNumber())} voided${reason ? ` — ${reason}` : ''}`,
          },
        });
      }

      return tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { payments: { where: { voidedAt: null }, orderBy: { createdAt: 'desc' } } },
      });
    }, 'Payment void conflicted with a concurrent update, please retry');

    return this.present(updated);
  }
}
