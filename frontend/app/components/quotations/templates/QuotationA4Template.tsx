// components/quotations/templates/QuotationA4Template.tsx
'use client';

import { QuotationView } from '../types';
import { formatIDR } from '@/lib/format';
import { terbilang } from '@/lib/terbilang';
import { resolveUploadUrl } from '@/lib/assets';
import { parseCalendarDate } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

export function QuotationA4Template({ quotation }: { quotation: QuotationView }) {
  const { t, language } = useLanguage();
  const hasBankDetails = !!quotation.bankName && !!quotation.bankAccountNumber;
  const logoUrl = resolveUploadUrl(quotation.businessLogoUrl);
  const dateLocale = language === 'id' ? 'id-ID' : 'en-US';

  return (
    <div className="w-[210mm] p-[15mm] text-sm text-black bg-white">
      {/* Business identity + quotation meta */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-20 w-20 object-contain" />
          )}

          <div>
            <h2 className="text-2xl font-bold leading-tight text-black">
              {quotation.businessName ?? quotation.locationName}
            </h2>

            {quotation.businessAddress && <p className="text-xs text-gray-600">{quotation.businessAddress}</p>}
            {quotation.businessPhone && <p className="text-xs text-gray-600">{quotation.businessPhone}</p>}
            {quotation.businessNpwp && <p className="text-xs text-gray-600">NPWP: {quotation.businessNpwp}</p>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-lg text-black">
            <strong>{t('sales.quotationTemplate.quotationLabel')}</strong> {quotation.quotationNumber}
          </p>

          {/* FIX — was quotation.issuedAt, a field that never existed on
              the backend. quotationDate is the real "Quote Date". */}
          <p className="text-gray-600">{parseCalendarDate(quotation.quotationDate).toLocaleDateString(dateLocale)}</p>

          {quotation.validUntil && (
            <p className="text-gray-600">
              {t('sales.quotationTemplate.validUntil')} {parseCalendarDate(quotation.validUntil).toLocaleDateString(dateLocale)}
            </p>
          )}
        </div>
      </div>

      {/* Customer */}
      {(quotation.customerName || quotation.customerPhone || quotation.customerAddress) && (
        <div className="mt-6 border-t border-gray-300 pt-3">
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            {t('sales.quotationTemplate.quotedTo')}
          </p>

          {quotation.customerName && <p className="font-semibold text-base text-black">{quotation.customerName}</p>}
          {quotation.customerPhone && <p className="text-black">{quotation.customerPhone}</p>}
          {quotation.customerAddress && <p className="text-black">{quotation.customerAddress}</p>}
          {quotation.customerNpwp && <p className="text-xs text-gray-600">NPWP: {quotation.customerNpwp}</p>}
        </div>
      )}

      {/* Items — Discount/Tax columns always render, even when every
          item is zero, so the table shape stays consistent across
          quotations. */}
      <table className="w-full border-collapse mt-6">
        <thead>
          <tr>
            <th className="text-left border-b-2 border-gray-300 py-2 pr-3 text-black">
              {t('sales.quotationTemplate.itemHeader')}
            </th>
            <th className="text-left border-b-2 border-gray-300 py-2 px-3 text-black">
              {t('sales.quotationTemplate.qtyHeader')}
            </th>
            <th className="text-left border-b-2 border-gray-300 py-2 px-3 text-black">
              {t('sales.quotationTemplate.priceHeader')}
            </th>
            <th className="text-right border-b-2 border-gray-300 py-2 px-3 text-black">
              {t('sales.quotationTemplate.discountHeader')}
            </th>
            <th className="text-right border-b-2 border-gray-300 py-2 px-3 text-black">
              {t('sales.quotationTemplate.taxHeader')}
            </th>
            <th className="text-right border-b-2 border-gray-300 py-2 pl-3 text-black">
              {t('sales.quotationTemplate.totalHeader')}
            </th>
          </tr>
        </thead>

        <tbody>
          {quotation.items.map((item, index) => (
            <tr key={`${item.productName}-${index}`}>
              <td className="border-b border-gray-100 py-2 pr-3 text-black">{item.productName}</td>
              <td className="border-b border-gray-100 py-2 px-3 text-black whitespace-nowrap">
                {item.quantity}
                {item.unit && <span className="text-gray-400 text-xs ml-1">{item.unit}</span>}
              </td>
              <td className="border-b border-gray-100 py-2 px-3 text-black whitespace-nowrap">
                {formatIDR(item.unitPrice)}
              </td>
              <td className="border-b border-gray-100 py-2 px-3 text-right text-gray-600 whitespace-nowrap">
                {item.itemDiscount > 0 ? `-${formatIDR(item.itemDiscount)}` : '—'}
              </td>
              <td className="border-b border-gray-100 py-2 px-3 text-right text-gray-600 whitespace-nowrap">
                {item.itemTaxAmount > 0 ? formatIDR(item.itemTaxAmount) : '—'}
              </td>
              <td className="border-b border-gray-100 py-2 pl-3 text-right font-medium text-black whitespace-nowrap">
                {formatIDR(item.itemTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="ml-auto w-1/2 mt-4">
        <div className="flex justify-between py-1 text-black">
          <span>{t('sales.quotationTemplate.subtotalLabel')}</span>
          <span>{formatIDR(quotation.subtotal)}</span>
        </div>

        {quotation.discount > 0 && (
          <div className="flex justify-between py-1 text-black">
            <span>{t('sales.quotationTemplate.discountLabel')}</span>
            <span>-{formatIDR(quotation.discount)}</span>
          </div>
        )}

        {quotation.taxAmount > 0 &&
          quotation.taxes.map((tax, index) => (
            <div key={`${tax.name}-${tax.percentage}-${index}`} className="flex justify-between py-1 text-gray-600">
              <span>
                {tax.name} ({tax.percentage}%)
              </span>
              <span>{formatIDR(tax.amount)}</span>
            </div>
          ))}

        <div className="flex justify-between font-bold text-lg border-t-2 border-black pt-2 mt-2 text-black">
          <span>{t('sales.quotationTemplate.totalHeader')}</span>
          <span>{formatIDR(quotation.total)}</span>
        </div>
      </div>

      {/* Amount in words */}
      <p className="mt-4 text-xs italic text-gray-600">
        {t('sales.quotationTemplate.amountInWords')}: {terbilang(quotation.total)}
      </p>

      {/* Terms & Conditions — spec requires this ✅ only for Quotation */}
      {quotation.termsAndConditions && (
        <div className="mt-6 border-t border-gray-300 pt-3 text-xs">
          <p className="uppercase tracking-wide text-gray-500 font-semibold mb-1">
            {t('sales.quotationTemplate.termsAndConditions')}
          </p>
          <p className="text-black whitespace-pre-line">{quotation.termsAndConditions}</p>
        </div>
      )}

      {/* Bank details — informational only; nothing has been paid yet.
          Your own business's bank details, shown so a customer converting
          straight from quote to payment doesn't have to ask separately. */}
      {hasBankDetails && (
        <div className="mt-8 border-t border-gray-300 pt-3 text-xs">
          <p className="uppercase tracking-wide text-gray-500 font-semibold mb-1">
            {t('sales.quotationTemplate.paymentTo')}
          </p>
          <p className="text-black">
            {quotation.bankName} — {quotation.bankAccountNumber}
            {quotation.bankAccountName
              ? ` ${t('sales.quotationTemplate.onBehalfOf')} ${quotation.bankAccountName}`
              : ''}
          </p>
        </div>
      )}

      {/* Signature blocks */}
      <div className="mt-16 flex justify-between gap-4">
        <div className="text-center w-40">
          <p className="text-black">{t('sales.quotationTemplate.approvedBy')}</p>
          <div className="h-20" />
          <p className="border-t border-gray-400 pt-1 text-black">&nbsp;</p>
        </div>

        <div className="text-center w-40">
          <p className="text-black">{t('sales.quotationTemplate.sincerely')}</p>
          <div className="h-20" />
          <p className="border-t border-gray-400 pt-1 text-black">
            {quotation.businessName ?? quotation.locationName}
          </p>
        </div>
      </div>
    </div>
  );
}