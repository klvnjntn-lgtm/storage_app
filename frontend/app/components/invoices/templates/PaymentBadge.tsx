// components/invoices/templates/PaymentBadge.tsx
'use client';

import { InvoiceView } from '../types';
import { isPaymentBadgeVisible, paymentBadgeStyle } from '@/lib/payment-status';
import { useLanguage } from '@/app/context/LanguageContext';

export function PaymentBadge({ invoice }: { invoice: InvoiceView }) {
  const { t } = useLanguage();
  if (!isPaymentBadgeVisible(invoice.paymentStatus)) return null;
  const label =
    invoice.paymentStatus === 'PAID'
      ? t('sales.invoiceTemplate.paymentBadgePaid')
      : invoice.paymentStatus === 'PARTIAL'
        ? t('sales.invoiceTemplate.paymentBadgePartial')
        : t('sales.invoiceTemplate.paymentBadgeUnpaid');
  return (
    <span
      className={`inline-block border-2 rounded-md px-3 py-1 text-base font-bold uppercase tracking-wide ${paymentBadgeStyle(invoice.paymentStatus!)}`}
    >
      {label}
    </span>
  );
}