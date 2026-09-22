// components/sales-orders/templates/SalesOrderA4Template.tsx
'use client';

import { SalesOrderView } from '../types';
import { formatIDR } from '@/lib/format';
import { terbilang } from '@/lib/terbilang';
import { resolveUploadUrl } from '@/lib/assets';
import { parseCalendarDate } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

export function SalesOrderA4Template({ order }: { order: SalesOrderView }) {
  const { t, language } = useLanguage();
  const logoUrl = resolveUploadUrl(order.businessLogoUrl);

  return (
    <div className="w-[210mm] p-[15mm] text-sm text-black bg-white">
      {/* Business identity + order meta */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-20 w-20 object-contain" />
          )}

          <div>
            <h2 className="text-2xl font-bold leading-tight text-black">
              {order.businessName ?? order.locationName}
            </h2>

            {order.businessAddress && <p className="text-xs text-gray-600">{order.businessAddress}</p>}
            {order.businessPhone && <p className="text-xs text-gray-600">{order.businessPhone}</p>}
            {order.businessNpwp && <p className="text-xs text-gray-600">NPWP: {order.businessNpwp}</p>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-lg text-black">
            <strong>{t('sales.orderTemplate.title')}</strong> {order.orderNumber ?? t('sales.orderTemplate.unissued')}
          </p>

          {order.orderDate && (
            <p className="text-gray-600">
              {parseCalendarDate(order.orderDate).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
            </p>
          )}

          {/* FIX — confirmedAt is a real instant/timestamp, same as
              createdAt, not a pure calendar-date field like orderDate.
              parseCalendarDate re-derives the day from the timestamp's
              UTC Y/M/D, which rolls a late-night-local confirmation back
              one calendar day in a timezone ahead of UTC. See
              DeliveryOrderA4Template.tsx's identical handling of
              shippedAt/createdAt for why plain new Date(...) +
              toLocaleDateString() is the correct conversion here instead. */}
          {order.confirmedAt && (
            <p className="text-gray-600">
              {t('sales.orderTemplate.confirmed')} {new Date(order.confirmedAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
            </p>
          )}
        </div>
      </div>

      {/* Customer */}
      {(order.customerName || order.customerPhone || order.customerAddress) && (
        <div className="mt-6 border-t border-gray-300 pt-3">
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{t('sales.orderTemplate.orderedBy')}</p>

          {order.customerName && <p className="font-semibold text-base text-black">{order.customerName}</p>}
          {order.customerPhone && <p className="text-black">{order.customerPhone}</p>}
          {order.customerAddress && <p className="text-black">{order.customerAddress}</p>}
          {order.customerNpwp && <p className="text-xs text-gray-600">NPWP: {order.customerNpwp}</p>}
          {order.customerPoNumber && (
            <p className="text-xs text-gray-600">{t('sales.orderTemplate.poNumberLabel', { po: order.customerPoNumber })}</p>
          )}
        </div>
      )}

      {/* Items */}
      {/* Items */}
      <table className="w-full border-collapse mt-6">
        <thead>
          <tr>
            <th className="text-left border-b-2 border-gray-300 py-2 pr-3 text-black">{t('sales.orderTemplate.colItem')}</th>
            <th className="text-left border-b-2 border-gray-300 py-2 px-3 text-black">{t('sales.orderTemplate.colQty')}</th>
            <th className="text-left border-b-2 border-gray-300 py-2 px-3 text-black">{t('sales.orderTemplate.colPrice')}</th>
            <th className="text-right border-b-2 border-gray-300 py-2 px-3 text-black">{t('sales.orderTemplate.colDiscount')}</th>
            <th className="text-right border-b-2 border-gray-300 py-2 px-3 text-black">{t('sales.orderTemplate.colTax')}</th>
            <th className="text-right border-b-2 border-gray-300 py-2 pl-3 text-black">{t('sales.orderTemplate.colTotal')}</th>
          </tr>
        </thead>

        <tbody>
          {order.items.map((item, index) => (
            <tr key={`${item.productName}-${index}`}>
              <td className="border-b border-gray-100 py-2 pr-3 text-black">
                {item.productName}
                {item.sku && <span className="text-gray-400 text-xs ml-1">({item.sku})</span>}
              </td>
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
          <span>{t('common.subtotal')}</span>
          <span>{formatIDR(order.subtotal)}</span>
        </div>

        {order.discount > 0 && (
          <div className="flex justify-between py-1 text-gray-600">
            <span>{t('sales.orderTemplate.discount')}</span>
            <span>-{formatIDR(order.discount)}</span>
          </div>
        )}

        {order.taxAmount > 0 &&
          order.taxes.map((tax, index) => (
            <div key={`${tax.name}-${tax.percentage}-${index}`} className="flex justify-between py-1 text-gray-600">
              <span>
                {tax.name} ({tax.percentage}%)
              </span>
              <span>{formatIDR(tax.amount)}</span>
            </div>
          ))}

        <div className="flex justify-between font-bold text-lg border-t-2 border-black pt-2 mt-2 text-black">
          <span>{t('common.total')}</span>
          <span>{formatIDR(order.total)}</span>
        </div>
      </div>

      {/* Amount in words */}
      <p className="mt-4 text-xs italic text-gray-600">{t('sales.orderTemplate.terbilang')}: {terbilang(order.total)}</p>

      {/* Signature blocks — order-style rather than quotation's
          approval-style (Disetujui oleh), since this has already been
          confirmed rather than being proposed for acceptance. */}
      <div className="mt-16 flex justify-between gap-4">
        <div className="text-center w-40">
          <p className="text-black">{t('sales.orderTemplate.orderedBySignature')}</p>
          <div className="h-20" />
          <p className="border-t border-gray-400 pt-1 text-black">&nbsp;</p>
        </div>

        <div className="text-center w-40">
          <p className="text-black">{t('sales.orderTemplate.sincerely')}</p>
          <div className="h-20" />
          <p className="border-t border-gray-400 pt-1 text-black">
            {order.businessName ?? order.locationName}
          </p>
        </div>
      </div>
    </div>
  );
}