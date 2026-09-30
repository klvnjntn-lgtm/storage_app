import { PaymentStatus } from '@prisma/client';

const EPS = 0.005; // half a cent: amounts are 2dp, so anything smaller is float noise

// Shared by PaymentService (record/void) and PostingRulesService
// (postSalesReturn), so UNPAID/PARTIAL/PAID thresholds are derived one way.
// `total` is what the customer owes: invoice.total minus creditedAmount.
export function deriveStatus(amountPaid: number, total: number): PaymentStatus {
  if (amountPaid <= 0) return PaymentStatus.UNPAID;
  if (amountPaid >= total - EPS) return PaymentStatus.PAID;
  return PaymentStatus.PARTIAL;
}
