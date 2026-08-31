// payments/payments.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceActivityEventType, Prisma, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPaymentDto } from './dto/record-payment.dto';

function deriveStatus(amountPaid: number, total: number): PaymentStatus {
  if (amountPaid <= 0) return PaymentStatus.UNPAID;
  if (amountPaid >= total) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}

@Injectable()
export class PaymentService {
  constructor(private prisma: PrismaService) {}

  async recordPayment(
    organizationId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
    userId?: string,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Scoped by organizationId — previously this was a bare
          // findUnique by id alone, which let any authenticated user
          // record a payment against ANY org's invoice if they knew or
          // guessed the invoiceId. findFirst (not findUnique) since
          // the compound filter isn't the model's unique key.
          const invoice = await tx.invoice.findFirst({
            where: { id: invoiceId, organizationId },
            select: { id: true, status: true, total: true, amountPaid: true, paymentStatus: true },
          });
          if (!invoice) throw new NotFoundException('Invoice not found');
          if (invoice.status !== 'ISSUED') {
            throw new BadRequestException('Payments can only be recorded against issued invoices');
          }

          // total is Decimal (subtotal/discount/total all use @db.Decimal(12,2)),
          // amountPaid is Int — normalize total to a number before comparing/storing.
          const total = invoice.total.toNumber();
          const newAmountPaid = invoice.amountPaid + dto.amount;

          if (newAmountPaid > total) {
            throw new BadRequestException(
              `Payment of ${dto.amount} exceeds balance due (${total - invoice.amountPaid})`,
            );
          }

          await tx.payment.create({
            data: { invoiceId, amount: dto.amount, method: dto.method, note: dto.note, recordedById: userId },
          });

          const newStatus = deriveStatus(newAmountPaid, total);

          const updated = await tx.invoice.update({
            where: { id: invoiceId },
            data: { amountPaid: newAmountPaid, paymentStatus: newStatus },
            include: { payments: { orderBy: { createdAt: 'desc' } } },
          });

          // PAYMENT_RECORDED always fires for a successful payment. The
          // amount/method go in `reason` (free text) rather than
          // oldTotal/newTotal — those columns mean "invoice total before
          // vs after an edit" for EDITED rows, and repurposing them here
          // for "amountPaid before vs after" would be a different meaning
          // wearing the same column, which is worse than just not filling
          // them for this event type.
          await tx.invoiceActivityEvent.create({
            data: {
              invoiceId,
              organizationId,
              userId,
              eventType: InvoiceActivityEventType.PAYMENT_RECORDED,
              reason: `Rp ${dto.amount.toLocaleString('id-ID')} via ${dto.method ?? 'CASH'}${dto.note ? ` — ${dto.note}` : ''}`,
            },
          });

          // MARKED_PAID only fires the moment this specific payment is
          // what crossed the invoice into PAID — not on every payment
          // while it's already sitting at PAID, and not on PARTIAL
          // payments. invoice.paymentStatus here is the status BEFORE
          // this transaction's update, so this correctly fires once.
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

          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('Payment conflicted with a concurrent update, please retry');
      }
      throw e;
    }
  }
}