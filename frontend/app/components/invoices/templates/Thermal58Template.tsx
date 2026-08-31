// components/invoices/templates/Thermal58Template.tsx

import { InvoiceView } from '../types';
import { formatIDR } from '@/lib/format';
import { resolveUploadUrl } from '@/lib/assets';
import { parseCalendarDate } from '@/lib/dates';

// 58mm thermal paper prints roughly 48mm wide once printer margins are
// accounted for. This is intentionally narrower than the 80mm receipt
// template. Item name and quantity/price are kept on separate lines so
// long product names don't collide with the amount column.
export function Thermal58Template({ invoice }: { invoice: InvoiceView }) {
  const logoUrl = resolveUploadUrl(invoice.businessLogoUrl);

  return (
    <div className="w-[48mm] font-mono text-[10px] leading-snug text-black bg-white">
      {/* Business header */}
      <div className="text-center">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="h-8 w-8 object-contain mx-auto mb-1"
          />
        )}

        <p className="font-bold">
          {invoice.businessName ?? invoice.locationName}
        </p>

        {invoice.businessPhone && (
          <p>{invoice.businessPhone}</p>
        )}

        <p>{invoice.invoiceNumber}</p>

        {/* Immutable business invoice date */}
{invoice.invoiceDate && (
          <p className="text-gray-600">
    {parseCalendarDate(invoice.invoiceDate).toLocaleDateString('id-ID')}
          </p>
)}
      </div>

      <div className="border-t border-dashed border-black my-1" />

      {/* Customer */}
      {invoice.customerName && (
        <div className="mb-1">
          <p>Customer: {invoice.customerName}</p>

          {invoice.customerPhone && (
            <p>{invoice.customerPhone}</p>
          )}
        </div>
      )}

      {/* Items — same compact breakdown as the 80mm receipt, just tighter.
          Discount/Tax lines are omitted when zero to save vertical space
          on narrow paper. */}
      {invoice.items.map((item) => (
        <div key={item.id} className="mb-1.5">
          <p className="leading-tight">
            {item.productName}
          </p>

          <div className="flex justify-between">
            <span>
              {item.quantity}×{formatIDR(item.unitPrice)}
            </span>
          </div>

          {item.itemDiscount > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Disc</span>
              <span>-{formatIDR(item.itemDiscount)}</span>
            </div>
          )}

          {item.itemTaxAmount > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Tax</span>
              <span>{formatIDR(item.itemTaxAmount)}</span>
            </div>
          )}

          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{formatIDR(item.itemTotal)}</span>
          </div>
        </div>
      ))}

      <div className="border-t border-dashed border-black my-1" />

      {/* Totals */}
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{formatIDR(invoice.subtotal)}</span>
      </div>

      {invoice.discount > 0 && (
        <div className="flex justify-between">
          <span>Disc</span>
          <span>-{formatIDR(invoice.discount)}</span>
        </div>
      )}

      {invoice.taxAmount > 0 && (
        <div className="flex justify-between">
          <span>Tax</span>
          <span>{formatIDR(invoice.taxAmount)}</span>
        </div>
      )}

      <div className="flex justify-between font-bold border-t border-dashed border-black mt-1 pt-1">
        <span>Total</span>
        <span>{formatIDR(invoice.total)}</span>
      </div>

      {/* Payment status */}
      {invoice.amountPaid != null && (
        <>
          <div className="flex justify-between">
            <span>Paid</span>
            <span>{formatIDR(invoice.amountPaid)}</span>
          </div>

          <div className="flex justify-between font-bold">
            <span>Balance</span>
            <span>
              {formatIDR(
                Math.max(invoice.total - invoice.amountPaid, 0),
              )}
            </span>
          </div>
        </>
      )}

      <div className="border-t border-dashed border-black my-1" />

      <p className="text-center">Terima kasih</p>
    </div>
  );
}