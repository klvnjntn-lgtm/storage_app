// app/(app)/sales/statement/page.tsx
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Printer, Calendar, Info } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { CustomerStatement } from '@/app/components/invoices/types';
import { toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// FIX — was d.toISOString().slice(0, 10), which converts to UTC first
// and rolls the date back one day in a timezone ahead of UTC. Same fix
// as GenerateStatementButton.tsx's identical helper.
function toDateInput(d: Date): string {
  return toCalendarDateString(d);
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toDateInput(d);
}

// FIX — useSearchParams() requires a Suspense boundary for static
// prerendering, or `next build` fails outright. See login/page.tsx.
export default function InvoiceStatementPage() {
  return (
    <Suspense fallback={null}>
      <InvoiceStatementPageInner />
    </Suspense>
  );
}

function InvoiceStatementPageInner() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const searchParams = useSearchParams();

  const customerId = searchParams.get('customerId');
  const customerNameParam = searchParams.get('customerName');
  const vehicleIds = searchParams.getAll('vehicleId'); // empty = all vehicles

  const [from, setFrom] = useState(searchParams.get('from') ?? defaultFrom());
  const [to, setTo] = useState(searchParams.get('to') ?? toDateInput(new Date()));

  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) {
      setError(t('sales.statement.customerRequired'));
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ customerId, from, to });
        for (const id of vehicleIds) params.append('vehicleId', id);
        const res = await apiFetch(`/invoices/statement?${params}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.message ?? t('sales.statement.failedToLoad', { status: res.status }));
          setStatement(null);
          return;
        }
        setStatement(await res.json());
      } catch {
        setError(t('sales.statement.couldNotReachServer'));
        setStatement(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, from, to, vehicleIds.join(',')]);

  const customerName = statement?.customer.name ?? customerNameParam ?? '';
  const totalInvoiced = statement?.lines.reduce((s, l) => s + l.invoiced, 0) ?? 0;
  const totalPaid = statement?.lines.reduce((s, l) => s + l.paidToDate, 0) ?? 0;
  const totalBalance = statement?.lines.reduce((s, l) => s + l.balance, 0) ?? 0;

  return (
    <main className="min-h-screen bg-white text-black">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #statement-print-area, #statement-print-area * { visibility: visible; }
          #statement-print-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>

      <div className="px-6 py-5 border-b-2 border-gray-300 print:hidden">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <FileText size={22} strokeWidth={2} className="text-gray-700" />
              <div>
                <h1 className="text-2xl font-bold">{t('sales.statement.title')}</h1>
                <p className="text-xs text-gray-500">
                  {customerName}
                  {vehicleIds.length > 0
                    ? ` · ${vehicleIds.length} ${t(
                        vehicleIds.length === 1 ? 'sales.statement.vehicleSingular' : 'sales.statement.vehiclePlural',
                      )} ${t('sales.statement.selected')}`
                    : ''}
                </p>
              </div>
            </div>

            <button
              onClick={() => window.print()}
              disabled={!statement}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 disabled:bg-gray-300"
            >
              <Printer size={16} strokeWidth={2} />
              {t('sales.statement.printSaveAsPdf')}
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3 mt-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                <Calendar size={12} strokeWidth={2} />
                {t('sales.statement.from')}
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('sales.statement.to')}</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <div id="statement-print-area" className="max-w-5xl mx-auto p-6">
        {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
            {error}
          </p>
        )}

        {!loading && !error && statement && (
          <>
            {/* Business identity */}
            <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b-2 border-gray-200">
              <div className="flex items-center gap-3">
                {statement.organization.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      statement.organization.logoUrl.startsWith('http')
                        ? statement.organization.logoUrl
                        : `/api${statement.organization.logoUrl}`
                    }
                    alt={t('sales.statement.logoAlt')}
                    className="w-12 h-12 object-contain rounded-md border border-gray-200"
                  />
                )}
                <div>
                  <p className="font-bold text-lg leading-tight text-black">
                    {statement.organization.legalName ?? statement.organization.name}
                  </p>
                  {statement.organization.address && (
                    <p className="text-xs text-black">{statement.organization.address}</p>
                  )}
                  {statement.organization.phone && (
                    <p className="text-xs text-black">{statement.organization.phone}</p>
                  )}
                  {statement.organization.npwp && (
                    <p className="text-xs text-black">NPWP: {statement.organization.npwp}</p>
                  )}
                  {(statement.organization.bankName || statement.organization.bankAccountNumber) && (
                    <p className="text-xs text-black mt-0.5">
                      {statement.organization.bankName}
                      {statement.organization.bankAccountNumber && ` · ${statement.organization.bankAccountNumber}`}
                      {statement.organization.bankAccountName && ` (${statement.organization.bankAccountName})`}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-right text-sm">
                <p className="font-semibold text-black">{statement.customer.name}</p>
                {statement.customer.address && (
                  <p className="text-xs text-black">{statement.customer.address}</p>
                )}
                {statement.customer.phone && (
                  <p className="text-xs text-black">{statement.customer.phone}</p>
                )}
              </div>
            </div>

            {/* Statement information */}
            <div className="flex justify-between items-center text-xs text-black mb-4">
              <span>
                {t('sales.statement.periodLabel', {
                  from: new Date(statement.from).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US'),
                  to: new Date(statement.to).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US'),
                })}
              </span>
              {statement.generatedAt && (
                <span>
                  {t('sales.statement.generatedLabel', {
                    datetime: new Date(statement.generatedAt).toLocaleString(language === 'id' ? 'id-ID' : 'en-US'),
                  })}
                </span>
              )}
            </div>

            {/* Running balance */}
            <div className="flex justify-between items-center bg-gray-50 border border-gray-200 rounded-md p-3 mb-4 text-sm text-black">
              <span>{t('sales.statement.openingBalance')}</span>
              <span className="font-semibold">{formatIDR(statement.openingBalance)}</span>
            </div>

            {statement.paymentTimingUnavailable && (
              <div className="flex items-start gap-2 text-xs text-black bg-gray-50 border border-gray-200 rounded-md p-3 mb-4">
                <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span>{t('sales.statement.paidToDateDisclosure')}</span>
              </div>
            )}

            {statement.lines.length === 0 && (
              <p className="text-sm text-black">{t('sales.statement.noInvoices')}</p>
            )}

            {statement.lines.length > 0 && (
              <div className="border-2 border-gray-300 rounded-md overflow-hidden mb-2">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b-2 border-gray-300">
                    <tr>
                      <th className="text-left p-2 font-semibold text-black">{t('sales.statement.colInvoice')}</th>
                      <th className="text-left p-2 font-semibold text-black">{t('sales.statement.colDate')}</th>
                      <th className="text-left p-2 font-semibold text-black">{t('sales.statement.colVehicle')}</th>
                      <th className="text-right p-2 font-semibold text-black">{t('sales.statement.colInvoiced')}</th>
                      <th className="text-right p-2 font-semibold text-black">{t('sales.statement.colPaidToDate')}</th>
                      <th className="text-right p-2 font-semibold text-black">{t('sales.statement.colBalance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.lines.map((line) => (
                      <tr
                        key={line.id}
                        onClick={() => router.push(`/sales/invoices/${line.id}`)}
                        className="border-b border-gray-200 last:border-0 cursor-pointer hover:bg-gray-50 print:cursor-default print:hover:bg-transparent"
                      >
                        <td className="p-2 font-medium text-black">{line.invoiceNumber ?? '—'}</td>
                        <td className="p-2 text-black">
                          {line.issuedAt ? new Date(line.issuedAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US') : '—'}
                        </td>
                        <td className="p-2 text-black">
                          {line.vehiclePlateNumber
                            ? `${line.vehiclePlateNumber}${line.vehicleModel ? ` · ${line.vehicleModel}` : ''}`
                            : '—'}
                        </td>
                        <td className="p-2 text-right text-black">{formatIDR(line.invoiced)}</td>
                        <td className="p-2 text-right text-black">{formatIDR(line.paidToDate)}</td>
                        <td className="p-2 text-right font-semibold text-black">{formatIDR(line.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {statement.lines.length > 0 && (
              <div className="flex justify-end mb-4">
                <div className="w-64 text-xs text-black">
                  <div className="flex justify-between py-0.5">
                    <span>{t('sales.statement.totalInvoiced')}</span>
                    <span>{formatIDR(totalInvoiced)}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span>{t('sales.statement.totalPaid')}</span>
                    <span>{formatIDR(totalPaid)}</span>
                  </div>
                  <div className="flex justify-between py-0.5 font-semibold text-black">
                    <span>{t('sales.statement.totalBalance')}</span>
                    <span>{formatIDR(totalBalance)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Closing balance */}
            <div className="flex justify-end mt-4 pt-4 border-t-2 border-gray-300">
              <div className="w-64 text-sm text-black">
                <div className="flex justify-between py-1">
                  <span>{t('sales.statement.openingBalance')}</span>
                  <span>{formatIDR(statement.openingBalance)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span>{t('sales.statement.periodActivity')}</span>
                  <span>{formatIDR(statement.closingBalance - statement.openingBalance)}</span>
                </div>
                <div className="flex justify-between py-1 font-bold text-base border-t-2 border-gray-300 mt-1 pt-2">
                  <span>{t('sales.statement.closingBalance')}</span>
                  <span>{formatIDR(statement.closingBalance)}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}