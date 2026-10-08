import { PaymentStatus } from '@prisma/client';

const EPS = 0.005; // half a cent: amounts are 2dp, so anything smaller is float noise

// Shared by PaymentService (record/void), PostingRulesService
// (postSalesReturn) and InvoiceService.issue(), so UNPAID/PARTIAL/PAID
// thresholds are derived one way. `total` is what the customer owes:
// invoice.total minus creditedAmount.
//
// Nothing owed (a fully returned invoice, or a 100%-discount one) counts as
// settled. It used to come out UNPAID because nothing was ever paid, which
// left such invoices overdue forever and voidable on top of their returns.
export function deriveStatus(amountPaid: number, total: number): PaymentStatus {
  if (total <= EPS) return PaymentStatus.PAID;
  if (amountPaid <= 0) return PaymentStatus.UNPAID;
  if (amountPaid >= total - EPS) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}
