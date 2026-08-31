// components/invoices/templates/PaymentBadge.tsx
import { InvoiceView } from '../types';
import { isPaymentBadgeVisible, paymentBadgeStyle } from '@/lib/payment-status';

export function PaymentBadge({ invoice }: { invoice: InvoiceView }) {
  if (!isPaymentBadgeVisible(invoice.paymentStatus)) return null;
  return (
    <span
      className={`inline-block border-2 rounded-md px-3 py-1 text-base font-bold uppercase tracking-wide ${paymentBadgeStyle(invoice.paymentStatus!)}`}
    >
      {invoice.paymentStatus}
    </span>
  );
}