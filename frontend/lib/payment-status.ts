// lib/payment-status.ts
import { PaymentStatus } from '@/app/components/invoices/types';

/** UNPAID (and unset) are the default state and shouldn't clutter the header. */
export function isPaymentBadgeVisible(status: PaymentStatus | null | undefined): boolean {
  return !!status && status !== 'UNPAID';
}

export function paymentBadgeStyle(status: PaymentStatus): string {
  return status === 'PAID'
    ? 'border-green-600 text-green-700'
    : 'border-amber-600 text-amber-700'; // PARTIAL — only other visible state
}