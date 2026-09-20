// app/accounting/trial-balance/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, Rows3, Calendar, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type TrialBalanceLine = { accountId: string; code: string; name: string; type: string; debit: number; credit: number };
type TrialBalanceReport = {
  asOf: string;
  accounts: TrialBalanceLine[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
};

const TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const TYPE_LABEL: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expenses',
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthEndISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}
function yearEndISO() {
  const d = new Date();
  return new Date(d.getFullYear(), 11, 31).toISOString().slice(0, 10);
}

export default function TrialBalancePage() {
  const router = useRouter();
  const [asOf, setAsOf] = useState(todayISO());
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/accounting/reports/trial-balance?asOf=${asOf}`);
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

  const grouped = useMemo(() => {
    if (!report) return null;
    const map = new Map<string, TrialBalanceLine[]>();
    for (const t of TYPE_ORDER) map.set(t, []);
    for (const acc of report.accounts) map.get(acc.type)?.push(acc);
    return map;
  }, [report]);

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
              <Rows3 size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>Trial Balance</h1>
              <p className="text-xs text-gray-500 truncate">Every account&apos;s lifetime balance, as of a date</p>
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
          <div className="flex gap-1.5">
            <button onClick={() => setAsOf(todayISO())} className="text-xs px-3 py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 transition-colors">
              Today
            </button>
            <button onClick={() => setAsOf(monthEndISO())} className="text-xs px-3 py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 transition-colors">
              Month-end
            </button>
            <button onClick={() => setAsOf(yearEndISO())} className="text-xs px-3 py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 transition-colors">
              Year-end
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}
        {loading && <p className="text-sm text-gray-500 mb-4">Loading...</p>}

        {!loading && report && (
          <>
            <div
              className={`flex items-center gap-2 text-sm rounded-md p-3 mb-5 border ${
                report.isBalanced ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'
              }`}
            >
              {report.isBalanced ? <CheckCircle2 size={16} strokeWidth={2} className="shrink-0" /> : <AlertTriangle size={16} strokeWidth={2} className="shrink-0" />}
              <span>
                {report.isBalanced
                  ? `Balanced — total debits and credits both equal ${formatIDR(report.totalDebits)}.`
                  : `Not balanced: debits ${formatIDR(report.totalDebits)} vs credits ${formatIDR(report.totalCredits)}. This indicates a posting-engine issue — please report it.`}
              </span>
            </div>

            <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200 bg-gray-50">
                <span>Account</span>
                <span className="text-right w-28">Debit</span>
                <span className="text-right w-28">Credit</span>
              </div>

              {TYPE_ORDER.map((type) => {
                const list = grouped?.get(type) ?? [];
                if (list.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/50">
                      {TYPE_LABEL[type]}
                    </div>
                    {list.map((acc) => (
                      <div key={acc.accountId} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-sm border-b border-gray-50 last:border-b-0">
                        <span className="truncate text-gray-700">
                          <span className="text-gray-400 font-mono text-xs mr-2">{acc.code}</span>
                          {acc.name}
                        </span>
                        <span className="text-right w-28 tabular-nums">{acc.debit > 0 ? formatIDR(acc.debit) : ''}</span>
                        <span className="text-right w-28 tabular-nums">{acc.credit > 0 ? formatIDR(acc.credit) : ''}</span>
                      </div>
                    ))}
                  </div>
                );
              })}

              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 text-sm font-bold border-t-2 border-gray-300 bg-gray-50">
                <span>Total</span>
                <span className="text-right w-28 tabular-nums">{formatIDR(report.totalDebits)}</span>
                <span className="text-right w-28 tabular-nums">{formatIDR(report.totalCredits)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}