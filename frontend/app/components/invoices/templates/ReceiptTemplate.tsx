// components/invoices/templates/ReceiptTemplate.tsx
'use client';

import { InvoiceView } from '../types';
import { formatIDR } from '@/lib/format';
import { resolveUploadUrl } from '@/lib/assets';
import { parseCalendarDate } from '@/lib/dates';
import { RECEIPT_CONTENT_WIDTH_MM } from '@/lib/mappers/invoice-format';
import { useLanguage } from '@/app/context/LanguageContext';

export function ReceiptTemplate({ invoice }: { invoice: InvoiceView }) {
  const { t } = useLanguage();
  const logoUrl = resolveUploadUrl(invoice.businessLogoUrl);

  return (
<div style={{ width: `${RECEIPT_CONTENT_WIDTH_MM}mm` }} className="font-mono text-xs leading-relaxed text-black bg-white">      {/* Business header */}
      <div className="text-center">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="h-10 w-10 object-contain mx-auto mb-1"
          />
        )}

        <p className="font-bold">
          {invoice.businessName ?? invoice.locationName}
        </p>

        {invoice.businessAddress && (
          <p>{invoice.businessAddress}</p>
        )}

        {invoice.businessPhone && (
          <p>{invoice.businessPhone}</p>
        )}

        <p>{invoice.invoiceNumber}</p>

        {/* Business invoice date — immutable after issuance */}
{invoice.invoiceDate && (
          <p className="text-gray-600">
    {parseCalendarDate(invoice.invoiceDate).toLocaleDateString('id-ID')}
          </p>
)}

        {invoice.employeeName && <p>{t('sales.invoiceTemplate.cashier', { name: invoice.employeeName })}</p>}
      </div>

      <div className="border-t border-dashed border-black my-1" />

      {/* Customer */}
      {invoice.customerName && (
        <div className="mb-1">
          <p>{t('sales.invoiceTemplate.customerLabel', { name: invoice.customerName })}</p>
          {invoice.customerPhone && (
            <p>{invoice.customerPhone}</p>
          )}
        </div>
      )}

      {/* Items — name, qty × price, then only the discount/tax lines that
          are actually non-zero, then the final per-item total. Keeps a
          plain item (no discount, no tax) down to two lines instead of
          padding it with "Discount: Rp 0" / "Tax: Rp 0". */}
      {invoice.items.map((item) => (
        <div key={item.id} className="mb-1.5">
          <p>{item.productName}</p>

          <div className="flex justify-between">
            <span>
              {item.quantity} x {formatIDR(item.unitPrice)}
            </span>
          </div>

          {item.itemDiscount > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>{t('sales.invoiceTemplate.discount')}</span>
              <span>-{formatIDR(item.itemDiscount)}</span>
            </div>
          )}

          {item.itemTaxAmount > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>{t('sales.invoiceTemplate.tax')}</span>
              <span>{formatIDR(item.itemTaxAmount)}</span>
            </div>
          )}

          <div className="flex justify-between font-semibold">
            <span>{t('common.total')}</span>
            <span>{formatIDR(item.itemTotal)}</span>
          </div>
        </div>
      ))}

      <div className="border-t border-dashed border-black my-1" />

      {/* Totals */}
      <div className="flex justify-between">
        <span>{t('common.subtotal')}</span>
        <span>{formatIDR(invoice.subtotal)}</span>
      </div>

      {invoice.discount > 0 && (
        <div className="flex justify-between">
          <span>{t('sales.invoiceTemplate.discount')}</span>
          <span>-{formatIDR(invoice.discount)}</span>
        </div>
      )}

      {invoice.taxAmount > 0 && (
        <div className="flex justify-between">
          <span>{t('sales.invoiceTemplate.tax')}</span>
          <span>{formatIDR(invoice.taxAmount)}</span>
        </div>
      )}

      <div className="flex justify-between font-bold border-t border-dashed border-black mt-1 pt-1">
        <span>{t('common.total')}</span>
        <span>{formatIDR(invoice.total)}</span>
      </div>

      {/* Payment status */}
      {invoice.amountPaid != null && (
        <>
          <div className="flex justify-between">
            <span>{t('sales.invoiceTemplate.paid')}</span>
            <span>{formatIDR(invoice.amountPaid)}</span>
          </div>

          <div className="flex justify-between font-bold">
            <span>{t('sales.invoiceTemplate.balance')}</span>
            <span>
              {formatIDR(
                Math.max(invoice.total - invoice.amountPaid, 0),
              )}
            </span>
          </div>
        </>
      )}

      <div className="border-t border-dashed border-black my-1" />

      {/* Footer */}
      <p className="text-center">{t('sales.invoiceTemplate.thankYou')}</p>
    </div>
  );
}