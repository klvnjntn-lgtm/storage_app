// app/(app)/sales/statement/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FileText, Printer, Calendar, Info } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { CustomerStatement } from '@/app/components/invoices/types';

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toDateInput(d);
}

export default function InvoiceStatementPage() {
  const router = useRouter();
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
      setError('A customer is required to generate a statement.');
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
          setError(body?.message ?? `Failed to load statement (${res.status})`);
          setStatement(null);
          return;
        }
        setStatement(await res.json());
      } catch {
        setError('Could not reach the server.');
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
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <FileText size={22} strokeWidth={2} className="text-gray-700" />
              <div>
                <h1 className="text-2xl font-bold">Customer Statement</h1>
                <p className="text-xs text-gray-500">
                  {customerName}
                  {vehicleIds.length > 0 ? ` · ${vehicleIds.length} vehicle${vehicleIds.length === 1 ? '' : 's'} selected` : ''}
                </p>
              </div>
            </div>

            <button
              onClick={() => window.print()}
              disabled={!statement}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 disabled:bg-gray-300"
            >
              <Printer size={16} strokeWidth={2} />
              Print / Save as PDF
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3 mt-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                <Calendar size={12} strokeWidth={2} />
                From
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">To</label>
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
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
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
                    alt="Logo"
                    className="w-12 h-12 object-contain rounded-md border border-gray-200"
                  />
                )}
                <div>
                  <p className="font-bold text-lg leading-tight">
                    {statement.organization.legalName ?? statement.organization.name}
                  </p>
                  {statement.organization.address && (
                    <p className="text-xs text-gray-500">{statement.organization.address}</p>
                  )}
                  {statement.organization.phone && (
                    <p className="text-xs text-gray-500">{statement.organization.phone}</p>
                  )}
                  {statement.organization.npwp && (
                    <p className="text-xs text-gray-500">NPWP: {statement.organization.npwp}</p>
                  )}
                  {(statement.organization.bankName || statement.organization.bankAccountNumber) && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {statement.organization.bankName}
                      {statement.organization.bankAccountNumber && ` · ${statement.organization.bankAccountNumber}`}
                      {statement.organization.bankAccountName && ` (${statement.organization.bankAccountName})`}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-right text-sm">
                <p className="font-semibold">{statement.customer.name}</p>
                {statement.customer.address && (
                  <p className="text-xs text-gray-500">{statement.customer.address}</p>
                )}
                {statement.customer.phone && (
                  <p className="text-xs text-gray-500">{statement.customer.phone}</p>
                )}
              </div>
            </div>

            {/* Statement information */}
            <div className="flex justify-between items-center text-xs text-gray-600 mb-4">
              <span>
                Statement period: {new Date(statement.from).toLocaleDateString('id-ID')} –{' '}
                {new Date(statement.to).toLocaleDateString('id-ID')}
              </span>
              {statement.generatedAt && (
                <span>Generated {new Date(statement.generatedAt).toLocaleString('id-ID')}</span>
              )}
            </div>

            {/* Running balance */}
            <div className="flex justify-between items-center bg-gray-50 border border-gray-200 rounded-md p-3 mb-4 text-sm">
              <span>Opening balance</span>
              <span className="font-semibold">{formatIDR(statement.openingBalance)}</span>
            </div>

            {statement.paymentTimingUnavailable && (
              <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md p-3 mb-4">
                <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span>
                  "Paid to date" reflects each invoice's current payment status, not the date the
                  payment was made — payments aren't tracked with their own timestamp yet, so this
                  isn't a period-accurate cash total.
                </span>
              </div>
            )}

            {statement.lines.length === 0 && (
              <p className="text-sm text-gray-400">No invoices in this date range.</p>
            )}

            {statement.lines.length > 0 && (
              <div className="border-2 border-gray-300 rounded-md overflow-hidden mb-2">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b-2 border-gray-300">
                    <tr>
                      <th className="text-left p-2 font-semibold">Invoice</th>
                      <th className="text-left p-2 font-semibold">Date</th>
                      <th className="text-left p-2 font-semibold">Vehicle</th>
                      <th className="text-right p-2 font-semibold">Invoiced</th>
                      <th className="text-right p-2 font-semibold">Paid to date</th>
                      <th className="text-right p-2 font-semibold">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.lines.map((line) => (
                      <tr
                        key={line.id}
                        onClick={() => router.push(`/sales/invoices/${line.id}`)}
                        className="border-b border-gray-200 last:border-0 cursor-pointer hover:bg-gray-50 print:cursor-default print:hover:bg-transparent"
                      >
                        <td className="p-2 font-medium">{line.invoiceNumber ?? '—'}</td>
                        <td className="p-2 text-gray-600">
                          {line.issuedAt ? new Date(line.issuedAt).toLocaleDateString('id-ID') : '—'}
                        </td>
                        <td className="p-2 text-gray-600">
                          {line.vehiclePlateNumber
                            ? `${line.vehiclePlateNumber}${line.vehicleModel ? ` · ${line.vehicleModel}` : ''}`
                            : '—'}
                        </td>
                        <td className="p-2 text-right">{formatIDR(line.invoiced)}</td>
                        <td className="p-2 text-right">{formatIDR(line.paidToDate)}</td>
                        <td className="p-2 text-right font-semibold">{formatIDR(line.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {statement.lines.length > 0 && (
              <div className="flex justify-end mb-4">
                <div className="w-64 text-xs text-gray-600">
                  <div className="flex justify-between py-0.5">
                    <span>Total invoiced</span>
                    <span>{formatIDR(totalInvoiced)}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span>Total paid</span>
                    <span>{formatIDR(totalPaid)}</span>
                  </div>
                  <div className="flex justify-between py-0.5 font-semibold text-gray-800">
                    <span>Total balance</span>
                    <span>{formatIDR(totalBalance)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Closing balance */}
            <div className="flex justify-end mt-4 pt-4 border-t-2 border-gray-300">
              <div className="w-64 text-sm">
                <div className="flex justify-between py-1">
                  <span className="text-gray-500">Opening balance</span>
                  <span>{formatIDR(statement.openingBalance)}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-500">Period activity</span>
                  <span>{formatIDR(statement.closingBalance - statement.openingBalance)}</span>
                </div>
                <div className="flex justify-between py-1 font-bold text-base border-t-2 border-gray-300 mt-1 pt-2">
                  <span>Closing balance</span>
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