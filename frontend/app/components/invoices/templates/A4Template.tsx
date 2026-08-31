// components/invoices/templates/A4Template.tsx

import { InvoiceView } from '../types';
import { formatIDR } from '@/lib/format';
import { terbilang } from '@/lib/terbilang';
import { resolveUploadUrl } from '@/lib/assets';
import { parseCalendarDate } from '@/lib/dates';

export function A4Template({ invoice }: { invoice: InvoiceView }) {
  const balanceDue =
    invoice.amountPaid != null
      ? Math.max(invoice.total - invoice.amountPaid, 0)
      : null;

  const hasBankDetails =
    !!invoice.bankName && !!invoice.bankAccountNumber;

  const hasVehicle = !!invoice.vehiclePlateNumber;

  const logoUrl = resolveUploadUrl(invoice.businessLogoUrl);

  const billTo = invoice.billingAddress ?? invoice.customerAddress;

  const hasItemDiscounts = invoice.items.some((item) => item.itemDiscount > 0);
  const hasItemTax = invoice.items.some((item) => item.itemTaxAmount > 0);

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
              <p className="text-xs text-gray-600">
                {invoice.businessAddress}
              </p>
            )}

            {invoice.businessPhone && (
              <p className="text-xs text-gray-600">
                {invoice.businessPhone}
              </p>
            )}

            {invoice.businessNpwp && (
              <p className="text-xs text-gray-600">
                NPWP: {invoice.businessNpwp}
              </p>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-lg text-black">
            <strong>Invoice</strong> {invoice.invoiceNumber}
          </p>

          {invoice.invoiceDate && (
            <p className="text-gray-600">
              {parseCalendarDate(invoice.invoiceDate).toLocaleDateString('id-ID')}
            </p>
          )}
          {invoice.dueDate && (
            <p className="text-gray-600">
              Due{' '}
              {parseCalendarDate(invoice.dueDate).toLocaleDateString('id-ID')}
            </p>
          )}
          {invoice.paymentTerms && (
            <p className="text-gray-600 text-xs">
              {invoice.paymentTerms}
            </p>
          )}
        </div>
      </div>

      {/* Customer */}
      {(invoice.customerName ||
        invoice.customerPhone ||
        billTo) && (
        <div className="mt-6 border-t border-gray-300 pt-3">
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Bill to
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
            <p className="text-xs text-gray-600">
              NPWP: {invoice.customerNpwp}
            </p>
          )}

          {/* NEW — PO Number is optional/reference on Invoice per policy;
              only prints when the customer actually provided one. */}
          {invoice.customerPoNumber && (
            <p className="text-xs text-gray-600">
              Customer PO No.: {invoice.customerPoNumber}
            </p>
          )}
        </div>
      )}

      {/* Vehicle — WORKSHOP_RMS */}
      {hasVehicle && (
        <div className="mt-4 border-t border-gray-300 pt-3">
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Vehicle
          </p>

          <p className="font-semibold text-base text-black">
            {invoice.vehiclePlateNumber}
            {invoice.vehicleModel
              ? ` · ${invoice.vehicleModel}`
              : ''}
          </p>

          {invoice.vehicleVin && (
            <p className="text-xs text-gray-600">
              VIN: {invoice.vehicleVin}
            </p>
          )}

          {invoice.vehicleOdometer != null && (
            <p className="text-xs text-gray-600">
              Odometer: {invoice.vehicleOdometer} km
            </p>
          )}
        </div>
      )}

      {/* Items */}
      <table className="w-full border-collapse mt-6">
        <thead>
          <tr>
            <th className="text-left border-b-2 border-gray-300 py-2 text-black">
              Item
            </th>

            <th className="text-left border-b-2 border-gray-300 py-2 text-black">
              Qty
            </th>

            <th className="text-left border-b-2 border-gray-300 py-2 text-black">
              Unit
            </th>

            <th className="text-left border-b-2 border-gray-300 py-2 text-black">
              Price
            </th>

            {hasItemDiscounts && (
              <th className="text-right border-b-2 border-gray-300 py-2 text-black">
                Disc.
              </th>
            )}

            {hasItemTax && (
              <th className="text-right border-b-2 border-gray-300 py-2 text-black">
                Tax
              </th>
            )}

            <th className="text-right border-b-2 border-gray-300 py-2 text-black">
              Total
            </th>
          </tr>
        </thead>

        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id}>
              <td className="border-b border-gray-100 py-2 text-black">
                {item.productName}
              </td>

              <td className="border-b border-gray-100 py-2 text-black">
                {item.quantity}
              </td>

              <td className="border-b border-gray-100 py-2 text-black">
                {item.unit ?? '—'}
              </td>

              <td className="border-b border-gray-100 py-2 text-black">
                {formatIDR(item.unitPrice)}
              </td>

              {hasItemDiscounts && (
                <td className="border-b border-gray-100 py-2 text-right text-gray-600">
                  {item.itemDiscount > 0 ? `-${formatIDR(item.itemDiscount)}` : '—'}
                </td>
              )}

              {hasItemTax && (
                <td className="border-b border-gray-100 py-2 text-right text-gray-600">
                  {item.itemTaxAmount > 0 ? formatIDR(item.itemTaxAmount) : '—'}
                </td>
              )}

              <td className="border-b border-gray-100 py-2 text-right font-medium text-black">
                {formatIDR(item.itemTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="ml-auto w-1/2 mt-4">
        <div className="flex justify-between py-1 text-black">
          <span>Subtotal</span>
          <span>{formatIDR(invoice.subtotal)}</span>
        </div>

        {invoice.discount > 0 && (
          <div className="flex justify-between py-1 text-black">
            <span>Discount</span>
            <span>-{formatIDR(invoice.discount)}</span>
          </div>
        )}

        {invoice.taxAmount > 0 &&
          invoice.taxes.map((tax, index) => (
            <div
              key={`${tax.name}-${tax.percentage}-${index}`}
              className="flex justify-between py-1 text-gray-600"
            >
              <span>
                {tax.name} ({tax.percentage}%)
              </span>

              <span>{formatIDR(tax.amount)}</span>
            </div>
          ))}

        <div className="flex justify-between font-bold text-lg border-t-2 border-black pt-2 mt-2 text-black">
          <span>Total</span>
          <span>{formatIDR(invoice.total)}</span>
        </div>

        {invoice.amountPaid != null && (
          <>
            <div className="flex justify-between py-1 text-black">
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

      {/* Amount in words */}
      <p className="mt-4 text-xs italic text-gray-600">
        Terbilang: {terbilang(invoice.total)}
      </p>

      {/* Bank details */}
      {hasBankDetails && (
        <div className="mt-8 border-t border-gray-300 pt-3 text-xs">
          <p className="uppercase tracking-wide text-gray-500 font-semibold mb-1">
            Payment to
          </p>

          <p className="text-black">
            {invoice.bankName} — {invoice.bankAccountNumber}
            {invoice.bankAccountName
              ? ` a.n. ${invoice.bankAccountName}`
              : ''}
          </p>
        </div>
      )}
      {/* Notes */}
      {invoice.notes && (
        <div className="mt-6 border-t border-gray-300 pt-3 text-xs">
          <p className="uppercase tracking-wide text-gray-500 font-semibold mb-1">
            Notes
          </p>
          <p className="text-black whitespace-pre-line">{invoice.notes}</p>
        </div>
      )}

      {/* Signature blocks */}
      <div className="mt-16 flex justify-between gap-4">
        {hasVehicle && (
          <div className="text-center w-40">
            <p className="text-black">Driver,</p>

            <div className="h-20" />

            <p className="border-t border-gray-400 pt-1 text-black">
              &nbsp;
            </p>
          </div>
        )}

        <div className="text-center w-40">
          <p className="text-black">Penerima,</p>

          <div className="h-20" />

          <p className="border-t border-gray-400 pt-1 text-black">
            &nbsp;
          </p>
        </div>

        <div className="text-center w-40">
          <p className="text-black">Hormat kami,</p>

          <div className="h-20" />

          <p className="border-t border-gray-400 pt-1 text-black">
            {invoice.businessName ?? invoice.locationName}
          </p>
        </div>
      </div>
    </div>
  );
}