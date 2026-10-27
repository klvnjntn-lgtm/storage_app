'use client';

import { formatIDR } from '@/lib/format';
import { formatDMY, parseCalendarDate } from '@/lib/dates';
import { resolveUploadUrl } from '@/lib/assets';
import { useLanguage } from '@/app/context/LanguageContext';
import type { WorkOrder } from './workOrders';

export type SpkPrintView = {
  workOrder: WorkOrder;
  // Today's price per line (same order as workOrder.items); null when the
  // lines can't be priced any more.
  pricing: {
    lines: { unitPrice: number; lineTotal: number }[];
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    total: number;
  } | null;
  business: {
    name: string;
    legalName: string | null;
    npwp: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
};

// The printed job card. An approved job prints as the SPK (Surat Perintah
// Kerja) the mechanic works from — quantities only, part prices are settled
// on the invoice. An estimate prints priced, for the customer to approve.
export function SpkA4Template({ view }: { view: SpkPrintView }) {
  const { t } = useLanguage();
  const { workOrder: wo, business, pricing } = view;
  const isEstimate = wo.status === 'ESTIMATE';
  const priced = isEstimate && pricing ? pricing : null;
  const logoUrl = resolveUploadUrl(business.logoUrl);
  const s = (key: string) => t(`workshop.workOrders.spk.${key}`);

  const details: [string, string | null][] = [
    [s('customer'), [wo.customer.name, wo.customer.companyName, wo.customer.phone].filter(Boolean).join(' · ')],
    // Company customers: what their finance team files the estimate under.
    ...(wo.customer.npwp ? [[s('customerNpwp'), wo.customer.npwp] as [string, string]] : []),
    ...(wo.customer.address && (wo.customer.companyName || wo.customer.npwp)
      ? [[s('address'), wo.customer.address] as [string, string]]
      : []),
    [s('vehicle'), `${wo.vehicle.plateNumber} · ${wo.vehicle.vehicleModel}`],
    [s('odometer'), wo.odometer != null ? `${wo.odometer.toLocaleString('id-ID')} km` : null],
    [s('mechanic'), wo.mechanic?.name ?? null],
    ...(wo.customerPoNumber ? [[s('customerPo'), wo.customerPoNumber] as [string, string]] : []),
    ...(wo.paymentTerms ? [[s('paymentTerms'), wo.paymentTerms] as [string, string]] : []),
  ];

  return (
    <div className="w-[210mm] min-h-[297mm] p-[15mm] text-sm text-black bg-white">
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-20 w-20 object-contain" />
          )}
          <div>
            <h2 className="text-2xl font-bold leading-tight">{business.name}</h2>
            {business.legalName && business.legalName !== business.name && (
              <p className="text-xs text-gray-600">{business.legalName}</p>
            )}
            {business.address && <p className="text-xs text-gray-600">{business.address}</p>}
            {business.phone && <p className="text-xs text-gray-600">{business.phone}</p>}
            {business.npwp && <p className="text-xs text-gray-600">NPWP: {business.npwp}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold">{isEstimate ? s('estimateTitle') : s('title')}</p>
          <p>
            {s('number')} <strong>{wo.number}</strong>
          </p>
          <p className="text-gray-600">
            {s('date')} {formatDMY(new Date(wo.createdAt))}
          </p>
          {isEstimate && wo.validUntil && (
            <p className="text-gray-600">
              {s('validUntil')} {formatDMY(parseCalendarDate(wo.validUntil))}
            </p>
          )}
        </div>
      </div>

      <table className="w-full mt-6 border-t border-gray-300">
        <tbody>
          {details.map(([label, value]) => (
            <tr key={label}>
              <td className="py-1 pr-3 w-36 text-gray-600 align-top">{label}</td>
              <td className="py-1 font-medium">{value || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{s('complaint')}</p>
        <p className="mt-1 min-h-[3em] whitespace-pre-wrap border border-gray-300 rounded p-2">{wo.complaint ?? ''}</p>
      </div>

      <table className="w-full border-collapse mt-6">
        <thead>
          <tr>
            <th className="text-left border-b-2 border-gray-300 py-2 pr-3 w-10">{s('lineNo')}</th>
            <th className="text-left border-b-2 border-gray-300 py-2 px-3">{s('item')}</th>
            <th className="text-left border-b-2 border-gray-300 py-2 px-3 w-28">{s('type')}</th>
            <th className="text-right border-b-2 border-gray-300 py-2 pl-3 w-16">{s('qty')}</th>
            {priced && (
              <>
                <th className="text-right border-b-2 border-gray-300 py-2 pl-3 w-28">{s('unitPrice')}</th>
                <th className="text-right border-b-2 border-gray-300 py-2 pl-3 w-28">{s('amount')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {wo.items.map((i, idx) => (
            <tr key={i.id}>
              <td className="border-b border-gray-200 py-2 pr-3">{idx + 1}</td>
              <td className="border-b border-gray-200 py-2 px-3">
                {i.product ? (
                  <>
                    {i.product.name}
                    {i.product.sku && <span className="text-xs text-gray-500"> · {i.product.sku}</span>}
                  </>
                ) : (
                  i.description
                )}
              </td>
              <td className="border-b border-gray-200 py-2 px-3">{i.productId ? s('part') : s('labour')}</td>
              <td className="border-b border-gray-200 py-2 pl-3 text-right">{Number(i.quantity)}</td>
              {priced && (
                <>
                  <td className="border-b border-gray-200 py-2 pl-3 text-right">{formatIDR(priced.lines[idx]?.unitPrice ?? 0)}</td>
                  <td className="border-b border-gray-200 py-2 pl-3 text-right">{formatIDR(priced.lines[idx]?.lineTotal ?? 0)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 text-right">
        {priced && (priced.discountAmount > 0 || priced.taxAmount > 0) && (
          <>
            <p>
              {s('subtotal')}: {formatIDR(priced.subtotal)}
            </p>
            {priced.discountAmount > 0 && (
              <p>
                {s('discount')}: −{formatIDR(priced.discountAmount)}
              </p>
            )}
            {priced.taxAmount > 0 && (
              <p>
                {s('tax')}: {formatIDR(priced.taxAmount)}
              </p>
            )}
          </>
        )}
        <p>
          {s('estimate')}: <strong>{formatIDR(priced ? priced.total : Number(wo.estimatedTotal))}</strong>
        </p>
        <p className="text-xs text-gray-500">{isEstimate ? s('estimateValidity') : s('estimateNote')}</p>
      </div>

      {wo.notes && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{s('notes')}</p>
          <p className="mt-1 whitespace-pre-wrap">{wo.notes}</p>
        </div>
      )}

      <div className={`grid ${isEstimate ? 'grid-cols-2' : 'grid-cols-3'} gap-6 mt-16 text-center`}>
        {(isEstimate
          ? [s('signApproval'), s('signAdvisor')]
          : [s('signCustomer'), s('signAdvisor'), s('signMechanic')]
        ).map((label) => (
          <div key={label}>
            <p>{label}</p>
            <div className="h-20" />
            <p className="border-t border-gray-400 pt-1 text-xs text-gray-500">&nbsp;</p>
          </div>
        ))}
      </div>
    </div>
  );
}
