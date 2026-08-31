// components/invoices/templates/A5Template.tsx
import { Fragment } from 'react';
import { InvoiceView } from '../types';
import { formatIDR } from '@/lib/format';
import { terbilang } from '@/lib/terbilang';
import { resolveUploadUrl } from '@/lib/assets';
import { parseCalendarDate } from '@/lib/dates';
import { A5_CONTENT_WIDTH_MM } from '@/lib/invoice-format';

export function A5Template({ invoice }: { invoice: InvoiceView }) {
  const balanceDue =
    invoice.amountPaid != null ? Math.max(invoice.total - invoice.amountPaid, 0) : null;

  const hasBankDetails = invoice.bankName && invoice.bankAccountNumber;
  const hasVehicle = !!invoice.vehiclePlateNumber;
  const billTo = invoice.billingAddress ?? invoice.customerAddress;
  const hasCustomer = !!(invoice.customerName || invoice.customerPhone || billTo);
  const logoUrl = resolveUploadUrl(invoice.businessLogoUrl);

  // invoiceDate is the invoice's business date; issuedAt is a system
  // timestamp. Fall back to issuedAt only when invoiceDate isn't set.
  const displayDate = invoice.invoiceDate
    ? parseCalendarDate(invoice.invoiceDate).toLocaleDateString('id-ID')
    : new Date(invoice.issuedAt).toLocaleDateString('id-ID');

  return (
    <div
      style={{ width: `${A5_CONTENT_WIDTH_MM}mm` }}
      className="text-[11px] leading-snug text-black bg-white"
    >
      {/* Business identity + invoice meta */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-2">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-14 w-14 object-contain" />
          )}
          <div>
            <h2 className="text-xl font-bold leading-tight text-black">
              {invoice.businessName ?? invoice.locationName}
            </h2>
            {invoice.businessAddress && <p className="text-[11px] text-gray-600">{invoice.businessAddress}</p>}
            {invoice.businessPhone && <p className="text-[11px] text-gray-600">{invoice.businessPhone}</p>}
            {invoice.businessNpwp && (
              <p className="text-[11px] text-gray-600">NPWP: {invoice.businessNpwp}</p>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-black">
            <strong>Invoice</strong> {invoice.invoiceNumber}
          </p>
          <p className="text-gray-600">{displayDate}</p>
          {invoice.dueDate && (
            <p className="text-gray-600">Due {parseCalendarDate(invoice.dueDate).toLocaleDateString('id-ID')}</p>
          )}
        </div>
      </div>

      {/* Bill to + Vehicle — fixed-width columns instead of flex-1, so a
          lone block (e.g. vehicle with no customer attached) keeps a
          sane column width instead of stretching across the full page. */}
      {(hasCustomer || hasVehicle) && (
        <div className="mt-3 border-t border-gray-300 pt-2 flex gap-6">
          {hasCustomer && (
            <div className="w-[100mm]">
              <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Bill to</p>
              {invoice.customerName && <p className="font-semibold text-black">{invoice.customerName}</p>}
              {invoice.customerPhone && <p className="text-black">{invoice.customerPhone}</p>}
              {billTo && <p className="text-black">{billTo}</p>}
              {invoice.customerNpwp && <p className="text-[10px] text-gray-600">NPWP: {invoice.customerNpwp}</p>}
            </div>
          )}

          {/* Vehicle — WORKSHOP_RMS, only present when this invoice was
              attached to a vehicle. */}
          {hasVehicle && (
            <div className="w-[80mm]">
              <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Vehicle</p>
              <p className="font-semibold text-black">
                {invoice.vehiclePlateNumber}
                {invoice.vehicleModel ? ` · ${invoice.vehicleModel}` : ''}
              </p>
              {invoice.vehicleVin && <p className="text-[10px] text-gray-600">VIN: {invoice.vehicleVin}</p>}
              {invoice.vehicleOdometer != null && (
                <p className="text-[10px] text-gray-600">Odometer: {invoice.vehicleOdometer} km</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Items — each line is a main row (name / qty / price / total),
          plus an optional compact sub-row underneath showing per-item
          discount/tax when either is non-zero. Avoids adding two more
          narrow columns to a page that doesn't have room for them. */}
      <table className="w-full border-collapse mt-3">
        <thead>
          <tr>
            <th className="text-left border-b border-gray-300 py-1 text-black">Item</th>
            <th className="text-left border-b border-gray-300 py-1 text-black w-16">Qty</th>
            <th className="text-left border-b border-gray-300 py-1 text-black w-24">Price</th>
            <th className="text-right border-b border-gray-300 py-1 text-black w-28">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => {
            const hasBreakdown = item.itemDiscount > 0 || item.itemTaxAmount > 0;
            return (
              <Fragment key={item.id}>
                <tr>
                  <td className={`text-black pt-1 ${hasBreakdown ? '' : 'border-b border-gray-100 pb-1'}`}>
                    {item.productName}
                  </td>
                  <td className={`text-black pt-1 ${hasBreakdown ? '' : 'border-b border-gray-100 pb-1'}`}>
                    {item.quantity}
                  </td>
                  <td className={`text-black pt-1 ${hasBreakdown ? '' : 'border-b border-gray-100 pb-1'}`}>
                    {formatIDR(item.unitPrice)}
                  </td>
                  <td className={`text-right text-black pt-1 ${hasBreakdown ? '' : 'border-b border-gray-100 pb-1'}`}>
                    {formatIDR(item.itemTotal)}
                  </td>
                </tr>
                {hasBreakdown && (
                  <tr>
                    <td colSpan={4} className="border-b border-gray-100 pb-1 text-[9px] text-gray-500">
                      {item.itemDiscount > 0 && (
                        <span className="mr-3">Disc: -{formatIDR(item.itemDiscount)}</span>
                      )}
                      {item.itemTaxAmount > 0 && <span>Tax: +{formatIDR(item.itemTaxAmount)}</span>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div className="mt-2 flex justify-between gap-6">
        <p className="text-[10px] italic text-gray-600 max-w-[60%] self-end">
          Terbilang: {terbilang(invoice.total)}
        </p>
        <div className="w-64 shrink-0">
          <div className="flex justify-between py-0.5 text-black">
            <span>Subtotal</span>
            <span>{formatIDR(invoice.subtotal)}</span>
          </div>
          {invoice.discount > 0 && (
            <div className="flex justify-between py-0.5 text-black">
              <span>Discount</span>
              <span>-{formatIDR(invoice.discount)}</span>
            </div>
          )}
          {invoice.taxAmount > 0 &&
            invoice.taxes.map((tax, i) => (
              <div key={i} className="flex justify-between py-0.5 text-gray-600">
                <span>
                  {tax.name} ({tax.percentage}%)
                </span>
                <span>{formatIDR(tax.amount)}</span>
              </div>
            ))}
          <div className="flex justify-between font-bold border-t border-black pt-1 mt-1 text-sm text-black">
            <span>Total</span>
            <span>{formatIDR(invoice.total)}</span>
          </div>
          {invoice.amountPaid != null && (
            <>
              <div className="flex justify-between py-0.5 text-black">
                <span>Paid</span>
                <span>{formatIDR(invoice.amountPaid)}</span>
              </div>
              <div className="flex justify-between font-semibold text-black">
                <span>Balance due</span>
                <span>{formatIDR(balanceDue ?? 0)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {hasBankDetails && (
        <div className="mt-3 border-t border-gray-300 pt-2 text-[10px]">
          <p className="uppercase tracking-wide text-gray-500 font-semibold mb-0.5">Payment to</p>
          <p className="text-black">
            {invoice.bankName} — {invoice.bankAccountNumber}
            {invoice.bankAccountName ? ` a.n. ${invoice.bankAccountName}` : ''}
          </p>
        </div>
      )}

      <div className="mt-6 flex justify-between gap-3">
        {hasVehicle && (
          <div className="text-center flex-1">
            <p className="text-black">Driver,</p>
            <div className="h-14" />
            <p className="border-t border-gray-400 pt-1 text-black">&nbsp;</p>
          </div>
        )}
        <div className="text-center flex-1">
          <p className="text-black">Penerima,</p>
          <div className="h-14" />
          <p className="border-t border-gray-400 pt-1 text-black">&nbsp;</p>
        </div>
        <div className="text-center flex-1">
          <p className="text-black">Hormat kami,</p>
          <div className="h-14" />
          <p className="border-t border-gray-400 pt-1 text-black">
            {invoice.businessName ?? invoice.locationName}
          </p>
        </div>
      </div>
    </div>
  );
}