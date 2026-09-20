// app/accounting/ap-aging/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, ShoppingCart, Calendar, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type APLine = {
  purchaseOrderId: string;
  poNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  dueDate: string | null;
  totalOwed: number;
  amountPaid: number;
  outstanding: number;
  daysOverdue: number;
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
};
type APAgingReport = {
  asOf: string;
  dueDateCaveat: string;
  lines: APLine[];
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number };
  reconciliation: { apLedgerBalance: number; sumOfOutstandingPOs: number; matches: boolean };
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
function formatIDRCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}rb`;
  return formatIDR(amount);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const BUCKETS: { key: keyof APAgingReport['totals']; label: string; color: string }[] = [
  { key: 'current', label: 'Current', color: 'text-gray-700 bg-white border-gray-300' },
  { key: 'd1_30', label: '1–30 days', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  { key: 'd31_60', label: '31–60 days', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  { key: 'd61_90', label: '61–90 days', color: 'text-red-700 bg-red-50 border-red-200' },
  { key: 'd90plus', label: '90+ days', color: 'text-red-800 bg-red-100 border-red-300' },
];

const BUCKET_BADGE: Record<APLine['bucket'], string> = {
  current: 'text-gray-600 bg-gray-100 border-gray-200',
  '1-30': 'text-amber-700 bg-amber-50 border-amber-200',
  '31-60': 'text-orange-700 bg-orange-50 border-orange-200',
  '61-90': 'text-red-700 bg-red-50 border-red-200',
  '90+': 'text-red-800 bg-red-100 border-red-300',
};

export default function APAgingPage() {
  const router = useRouter();
  const [asOf, setAsOf] = useState(todayISO());
  const [report, setReport] = useState<APAgingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/accounting/reports/ap-aging?asOf=${asOf}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        setReport(null);
        return;
      }
      setReport(await res.json());
    } catch {
      setError('Could not reach the server.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf]);

  const sortedLines = useMemo(
    () => [...(report?.lines ?? [])].sort((a, b) => b.daysOverdue - a.daysOverdue),
    [report],
  );

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/accounting')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <ShoppingCart size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>AP Aging</h1>
              <p className="text-xs text-gray-500 truncate">What you owe suppliers, and how overdue it is</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-5">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
              <Calendar size={12} strokeWidth={2} />
              As of
            </label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}
        {loading && <p className="text-sm text-gray-500 mb-4">Loading...</p>}

        {!loading && report && (
          <>
            <div
              className={`flex items-center gap-2 text-sm rounded-md p-3 mb-3 border ${
                report.reconciliation.matches ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'
              }`}
            >
              {report.reconciliation.matches ? <CheckCircle2 size={16} strokeWidth={2} className="shrink-0" /> : <AlertTriangle size={16} strokeWidth={2} className="shrink-0" />}
              <span>
                {report.reconciliation.matches
                  ? `Reconciled — matches the ledger's AP balance of ${formatIDR(report.reconciliation.apLedgerBalance)}.`
                  : `Doesn't reconcile: ledger AP balance ${formatIDR(report.reconciliation.apLedgerBalance)} vs sum of outstanding POs ${formatIDR(report.reconciliation.sumOfOutstandingPOs)}.`}
              </span>
            </div>

            <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md p-3 mb-5">
              <Info size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
              <span>{report.dueDateCaveat}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
              {BUCKETS.map((b) => (
                <div key={b.key} className={`border rounded-md p-2.5 ${b.color}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{b.label}</p>
                  <p className="text-sm font-bold mt-0.5">
                    <span className="sm:hidden">{formatIDRCompact(report.totals[b.key])}</span>
                    <span className="hidden sm:inline">{formatIDR(report.totals[b.key])}</span>
                  </p>
                </div>
              ))}
            </div>

            {sortedLines.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No outstanding purchase orders as of this date.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sortedLines.map((line) => (
                  <div key={line.purchaseOrderId} className="border-2 border-gray-300 rounded-md bg-white p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{line.poNumber ?? line.purchaseOrderId}</span>
                        <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${BUCKET_BADGE[line.bucket]}`}>
                          {line.bucket === 'current' ? 'Current' : `${line.bucket}d`}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {line.supplierName ?? 'No supplier on file'}
                        {line.dueDate && ` · due ${new Date(line.dueDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                      </p>
                    </div>
                    <span className="text-sm font-bold shrink-0">{formatIDR(line.outstanding)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}