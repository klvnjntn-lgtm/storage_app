// app/components/purchase-orders/templates/PurchaseOrderTemplate.tsx

import { formatIDR } from '@/lib/format';
import { terbilang } from '@/lib/terbilang';
import { resolveUploadUrl } from '@/lib/assets';
import { PurchaseOrderPrintView } from '../types';

export function PurchaseOrderTemplate({ po }: { po: PurchaseOrderPrintView }) {
  const logoUrl = resolveUploadUrl(po.businessLogoUrl);

  return (
    <div className="w-[210mm] p-[15mm] text-sm text-black bg-white">
      {/* Business identity + PO meta */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-20 w-20 object-contain" />
          )}

          <div>
            <h2 className="text-2xl font-bold leading-tight text-black">
              {po.businessLegalName ?? po.businessName}
            </h2>

            {po.businessAddress && <p className="text-xs text-gray-600">{po.businessAddress}</p>}
            {po.businessPhone && <p className="text-xs text-gray-600">{po.businessPhone}</p>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-lg text-black">
            <strong>Purchase Order</strong> {po.poNumber ?? 'Unissued draft'}
          </p>

          <p className="text-gray-600">{new Date(po.orderDate).toLocaleDateString('id-ID')}</p>

          {po.expectedDate && (
            <p className="text-gray-600">
              Expected {new Date(po.expectedDate).toLocaleDateString('id-ID')}
            </p>
          )}
        </div>
      </div>

      {/* Supplier + Receiving Location */}
      <div className="mt-6 border-t border-gray-300 pt-3 grid grid-cols-2 gap-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Supplier</p>

          {po.supplierName ? (
            <>
              <p className="font-semibold text-base text-black">{po.supplierName}</p>
              {po.supplierAddress && <p className="text-black">{po.supplierAddress}</p>}
              {po.supplierPhone && <p className="text-black">{po.supplierPhone}</p>}
              {po.supplierNpwp && <p className="text-xs text-gray-600">NPWP: {po.supplierNpwp}</p>}
            </>
          ) : (
            <p className="text-gray-400">—</p>
          )}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Receiving Location
          </p>

          <p className="font-semibold text-base text-black">{po.locationName || '—'}</p>
          {po.locationAddress && <p className="text-black">{po.locationAddress}</p>}
        </div>
      </div>

      {/* Items */}
      <table className="w-full border-collapse mt-6">
        <thead>
          <tr>
            <th className="text-left border-b-2 border-gray-300 py-2 text-black">Item</th>
            <th className="text-left border-b-2 border-gray-300 py-2 text-black">Qty</th>
            <th className="text-left border-b-2 border-gray-300 py-2 text-black">Unit Cost</th>
            <th className="text-right border-b-2 border-gray-300 py-2 text-black">Total</th>
          </tr>
        </thead>

        <tbody>
          {po.items.map((item) => (
            <tr key={item.id}>
              <td className="border-b border-gray-100 py-2 text-black">
                {item.productName}
                {item.sku && <span className="text-xs text-gray-500"> ({item.sku})</span>}
              </td>
              <td className="border-b border-gray-100 py-2 text-black">{item.quantity}</td>
              <td className="border-b border-gray-100 py-2 text-black">{formatIDR(item.unitCost)}</td>
              <td className="border-b border-gray-100 py-2 text-right font-medium text-black">
                {formatIDR(item.lineTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="ml-auto w-1/2 mt-4">
        <div className="flex justify-between py-1 text-black">
          <span>Subtotal</span>
          <span>{formatIDR(po.subtotal)}</span>
        </div>

        {po.discountAmount > 0 && (
          <div className="flex justify-between py-1 text-black">
            <span>Discount</span>
            <span>-{formatIDR(po.discountAmount)}</span>
          </div>
        )}

        {po.taxAmount > 0 && po.taxName && (
          <div className="flex justify-between py-1 text-gray-600">
            <span>
              {po.taxName}
              {po.taxPercentage != null ? ` (${po.taxPercentage}%)` : ''}
            </span>
            <span>{formatIDR(po.taxAmount)}</span>
          </div>
        )}

        <div className="flex justify-between font-bold text-lg border-t-2 border-black pt-2 mt-2 text-black">
          <span>Total</span>
          <span>{formatIDR(po.total)}</span>
        </div>
      </div>

      {/* Amount in words */}
      <p className="mt-4 text-xs italic text-gray-600">Terbilang: {terbilang(po.total)}</p>

      {/* Notes */}
      {po.notes && (
        <div className="mt-6 border-t border-gray-300 pt-3 text-xs">
          <p className="uppercase tracking-wide text-gray-500 font-semibold mb-1">Notes</p>
          <p className="text-black whitespace-pre-line">{po.notes}</p>
        </div>
      )}

      {/* Signature blocks */}
      <div className="mt-16 flex justify-between gap-4">
        <div className="text-center w-40">
          <p className="text-black">Diterima oleh,</p>
          <div className="h-20" />
          <p className="border-t border-gray-400 pt-1 text-black">
            {po.supplierName ?? '\u00A0'}
          </p>
        </div>

        <div className="text-center w-40">
          <p className="text-black">Dipesan oleh,</p>
          <div className="h-20" />
          <p className="border-t border-gray-400 pt-1 text-black">
            {po.businessLegalName ?? po.businessName}
          </p>
        </div>
      </div>
    </div>
  );
}