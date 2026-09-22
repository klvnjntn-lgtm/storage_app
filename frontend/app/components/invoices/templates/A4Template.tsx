// components/invoices/templates/A4Template.tsx
'use client';

import { InvoiceView } from '../types';
import { formatIDR } from '@/lib/format';
import { terbilang } from '@/lib/terbilang';
import { resolveUploadUrl } from '@/lib/assets';
import { parseCalendarDate } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

export function A4Template({ invoice }: { invoice: InvoiceView }) {
  const { t } = useLanguage();
  const balanceDue =
    invoice.amountPaid != null
      ? Math.max(invoice.total - invoice.amountPaid, 0)
      : null;

  const hasBankDetails =
    !!invoice.bankName && !!invoice.bankAccountNumber;

  const hasVehicle = !!invoice.vehiclePlateNumber;

  const logoUrl = resolveUploadUrl(invoice.businessLogoUrl);

  const billTo = invoice.billingAddress ?? invoice.customerAddress;

  const displayDate = invoice.invoiceDate
    ? parseCalendarDate(invoice.invoiceDate).toLocaleDateString('id-ID')
    : new Date(invoice.issuedAt).toLocaleDateString('id-ID');

  return (
    <div className="w-[210mm] p-[15mm] text-sm text-black bg-white">
      {/* Business identity + invoice meta */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="h-20 w-20 object-contain"
            />
          )}

          <div>
            <h2 className="text-2xl font-bold leading-tight text-black">
              {invoice.businessName ?? invoice.locationName}
            </h2>

            {invoice.businessAddress && (
              <p className="text-xs text-black">
                {invoice.businessAddress}
              </p>
            )}

            {invoice.businessPhone && (
              <p className="text-xs text-black">
                {invoice.businessPhone}
              </p>
            )}

            {invoice.businessNpwp && (
              <p className="text-xs text-black">
                NPWP: {invoice.businessNpwp}
              </p>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-lg text-black">
            <strong>{t('sales.invoiceTemplate.invoiceWord')}</strong> {invoice.invoiceNumber}
          </p>

          <p className="text-black">
            {displayDate}
          </p>
          {invoice.dueDate && (
            <p className="text-black">
              {t('sales.invoiceTemplate.due')}{' '}
              {parseCalendarDate(invoice.dueDate).toLocaleDateString('id-ID')}
            </p>
          )}
          {invoice.paymentTerms && (
            <p className="text-black text-xs">
              {invoice.paymentTerms}
            </p>
          )}
          {invoice.employeeName && (
            <p className="text-black text-xs">
              {t('sales.invoiceTemplate.salesLabel', { name: invoice.employeeName })}
            </p>
          )}
        </div>
      </div>

      {/* Customer */}
      {(invoice.customerName ||
        invoice.customerPhone ||
        billTo) && (
        <div className="mt-6 border-t border-gray-300 pt-3">
          <p className="text-xs uppercase tracking-wide text-black font-semibold">
            {t('sales.invoiceTemplate.billTo')}
          </p>

          {invoice.customerName && (
            <p className="font-semibold text-base text-black">
              {invoice.customerName}
            </p>
          )}

          {invoice.customerPhone && (
            <p className="text-black">
              {invoice.customerPhone}
            </p>
          )}

          {billTo && (
            <p className="text-black">
              {billTo}
            </p>
          )}

          {invoice.customerNpwp && (
            <p className="text-xs text-black">
              NPWP: {invoice.customerNpwp}
            </p>
          )}

          {/* NEW — PO Number is optional/reference on Invoice per policy;
              only prints when the customer actually provided one. */}
          {invoice.customerPoNumber && (
            <p className="text-xs text-black">
              {t('sales.invoiceTemplate.poNumberLabel', { po: invoice.customerPoNumber })}
            </p>
          )}
        </div>
      )}

      {/* Vehicle — WORKSHOP_RMS */}
      {hasVehicle && (
        <div className="mt-4 border-t border-gray-300 pt-3">
          <p className="text-xs uppercase tracking-wide text-black font-semibold">
            {t('sales.invoiceTemplate.vehicleLabel')}
          </p>

          <p className="font-semibold text-base text-black">
            {invoice.vehiclePlateNumber}
            {invoice.vehicleModel
              ? ` · ${invoice.vehicleModel}`
              : ''}
          </p>

          {invoice.vehicleVin && (
            <p className="text-xs text-black">
              {t('sales.invoiceTemplate.vinLabel', { vin: invoice.vehicleVin })}
            </p>
          )}

          {invoice.vehicleOdometer != null && (
            <p className="text-xs text-black">
              {t('sales.invoiceTemplate.odometerLabel', { value: invoice.vehicleOdometer })}
            </p>
          )}
        </div>
      )}

      {/* Items */}
      {/* Items — Discount/Tax columns always render, matching the
          Quotation/Sales Order templates. */}
      <table className="w-full border-collapse mt-6">
        <thead>
          <tr>
            <th className="text-left border-b-2 border-gray-300 py-2 pr-3 text-black">{t('sales.invoiceTemplate.itemHeader')}</th>
            <th className="text-left border-b-2 border-gray-300 py-2 px-3 text-black">{t('sales.invoiceTemplate.qtyHeader')}</th>
            <th className="text-left border-b-2 border-gray-300 py-2 px-3 text-black">{t('sales.invoiceTemplate.priceHeader')}</th>
            <th className="text-right border-b-2 border-gray-300 py-2 px-3 text-black">{t('sales.invoiceTemplate.discount')}</th>
            <th className="text-right border-b-2 border-gray-300 py-2 px-3 text-black">{t('sales.invoiceTemplate.tax')}</th>
            <th className="text-right border-b-2 border-gray-300 py-2 pl-3 text-black">{t('common.total')}</th>
          </tr>
        </thead>

        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id}>
              <td className="border-b border-gray-100 py-2 pr-3 text-black break-words">
                {item.productName}
              </td>

              <td className="border-b border-gray-100 py-2 px-3 text-black whitespace-nowrap">
                {item.quantity}
                {item.unit && (
                  <span className="text-black text-xs ml-1">{item.unit}</span>
                )}
              </td>

              <td className="border-b border-gray-100 py-2 px-3 text-black whitespace-nowrap">
                {formatIDR(item.unitPrice)}
              </td>

              <td className="border-b border-gray-100 py-2 px-3 text-right text-black whitespace-nowrap">
                {item.itemDiscount > 0 ? `-${formatIDR(item.itemDiscount)}` : '—'}
              </td>

              <td className="border-b border-gray-100 py-2 px-3 text-right text-black whitespace-nowrap">
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
          <span>{t('common.subtotal')}</span>
          <span>{formatIDR(invoice.subtotal)}</span>
        </div>

        {invoice.discount > 0 && (
          <div className="flex justify-between py-1 text-black">
            <span>{t('sales.invoiceTemplate.discount')}</span>
            <span>-{formatIDR(invoice.discount)}</span>
          </div>
        )}

        {invoice.taxAmount > 0 &&
          invoice.taxes.map((tax, index) => (
            <div
              key={`${tax.name}-${tax.percentage}-${index}`}
              className="flex justify-between py-1 text-black"
            >
              <span>
                {tax.name} ({tax.percentage}%)
              </span>

              <span>{formatIDR(tax.amount)}</span>
            </div>
          ))}

        <div className="flex justify-between font-bold text-lg border-t-2 border-black pt-2 mt-2 text-black">
          <span>{t('common.total')}</span>
          <span>{formatIDR(invoice.total)}</span>
        </div>

        {invoice.amountPaid != null && (
          <>
            <div className="flex justify-between py-1 text-black">
              <span>{t('sales.invoiceTemplate.paid')}</span>
              <span>{formatIDR(invoice.amountPaid)}</span>
            </div>

            <div className="flex justify-between font-semibold text-black">
              <span>{t('sales.invoiceTemplate.balanceDue')}</span>
              <span>{formatIDR(balanceDue ?? 0)}</span>
            </div>
          </>
        )}
      </div>

      {/* Amount in words */}
      <p className="mt-4 text-xs italic text-black">
        {t('sales.invoiceTemplate.amountInWords', { value: terbilang(invoice.total) })}
      </p>

      {/* Bank details */}
      {hasBankDetails && (
        <div className="mt-8 border-t border-gray-300 pt-3 text-xs">
          <p className="uppercase tracking-wide text-black font-semibold mb-1">
            {t('sales.invoiceTemplate.paymentTo')}
          </p>

          <p className="text-black">
            {invoice.bankName} — {invoice.bankAccountNumber}
            {invoice.bankAccountName
              ? ` ${t('sales.invoiceTemplate.onBehalfOf', { name: invoice.bankAccountName })}`
              : ''}
          </p>
        </div>
      )}
      {/* Notes */}
      {invoice.notes && (
        <div className="mt-6 border-t border-gray-300 pt-3 text-xs">
          <p className="uppercase tracking-wide text-black font-semibold mb-1">
            {t('common.notes')}
          </p>
          <p className="text-black whitespace-pre-line">{invoice.notes}</p>
        </div>
      )}

      {/* Signature blocks */}
      <div className="mt-16 flex justify-between gap-4">
        {hasVehicle && (
          <div className="text-center w-40">
            <p className="text-black">{t('sales.invoiceTemplate.driverLabel')}</p>

            <div className="h-20" />

            <p className="border-t border-gray-400 pt-1 text-black">
              &nbsp;
            </p>
          </div>
        )}

        <div className="text-center w-40">
          <p className="text-black">{t('sales.invoiceTemplate.recipientLabel')}</p>

          <div className="h-20" />

          <p className="border-t border-gray-400 pt-1 text-black">
            &nbsp;
          </p>
        </div>

        <div className="text-center w-40">
          <p className="text-black">{t('sales.invoiceTemplate.regardsLabel')}</p>

          <div className="h-20" />

          <p className="border-t border-gray-400 pt-1 text-black">
            {invoice.employeeName ?? invoice.businessName ?? invoice.locationName}
          </p>
        </div>
      </div>
    </div>
  );
}