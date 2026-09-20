// app/accounting/balance-sheet/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, Scale, Calendar, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type BSLine = { accountId: string; code: string; name: string; amount: number };
type BalanceSheetReport = {
  asOf: string;
  assets: BSLine[];
  totalAssets: number;
  liabilities: BSLine[];
  totalLiabilities: number;
  statedEquity: BSLine[];
  totalStatedEquity: number;
  accumulatedEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
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

export default function BalanceSheetPage() {
  const router = useRouter();
  const [asOf, setAsOf] = useState(todayISO());
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/accounting/reports/balance-sheet?asOf=${asOf}`);
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
              <Scale size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>Balance Sheet</h1>
              <p className="text-xs text-gray-500 truncate">Assets, liabilities, and equity as of a date</p>
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
                  ? `Balanced — Assets equal Liabilities + Equity, both ${formatIDR(report.totalAssets)}.`
                  : `Not balanced: Assets ${formatIDR(report.totalAssets)} vs Liabilities + Equity ${formatIDR(report.totalLiabilitiesAndEquity)}. This indicates an account-classification issue — please report it.`}
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {/* Assets */}
              <Section title="Assets">
                {report.assets.length === 0 ? (
                  <EmptyRow />
                ) : (
                  report.assets.map((a) => <Row key={a.accountId} code={a.code} name={a.name} amount={a.amount} />)
                )}
                <TotalRow label="Total Assets" amount={report.totalAssets} />
              </Section>

              {/* Liabilities */}
              <Section title="Liabilities">
                {report.liabilities.length === 0 ? (
                  <EmptyRow />
                ) : (
                  report.liabilities.map((l) => <Row key={l.accountId} code={l.code} name={l.name} amount={l.amount} />)
                )}
                <TotalRow label="Total Liabilities" amount={report.totalLiabilities} />
              </Section>

              {/* Equity */}
              <Section title="Equity">
                {report.statedEquity.length === 0 ? (
                  <p className="px-4 py-2 text-xs text-gray-400">No manually posted equity accounts (e.g. owner capital).</p>
                ) : (
                  report.statedEquity.map((e) => <Row key={e.accountId} code={e.code} name={e.name} amount={e.amount} />)
                )}
                <Row code="" name="Accumulated Earnings (undistributed profit — not yet formally closed)" amount={report.accumulatedEarnings} muted />
                <TotalRow label="Total Equity" amount={report.totalEquity} />
              </Section>

              <div className="border-2 border-black rounded-md bg-black text-white px-4 py-4 flex items-baseline justify-between">
                <span className={`${display.className} font-bold text-sm sm:text-base`}>Total Liabilities &amp; Equity</span>
                <span className={`${display.className} font-bold text-base sm:text-lg`}>{formatIDR(report.totalLiabilitiesAndEquity)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
      <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</div>
      {children}
    </div>
  );
}

function Row({ code, name, amount, muted = false }: { code: string; name: string; amount: number; muted?: boolean }) {
  return (
    <div className="px-4 py-2 flex items-baseline justify-between gap-3">
      <span className={`text-sm truncate ${muted ? 'text-gray-500 italic' : 'text-gray-700'}`}>
        {code && <span className="text-gray-400 font-mono text-xs mr-2">{code}</span>}
        {name}
      </span>
      <span className={`text-sm shrink-0 tabular-nums ${muted ? 'text-gray-500' : 'text-gray-700'}`}>{formatIDR(amount)}</span>
    </div>
  );
}

function TotalRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="px-4 py-2.5 flex items-baseline justify-between gap-3 border-t border-gray-200 bg-gray-50/60">
      <span className="text-sm font-bold">{label}</span>
      <span className="text-sm font-bold tabular-nums">{formatIDR(amount)}</span>
    </div>
  );
}

function EmptyRow() {
  return <p className="px-4 py-2 text-xs text-gray-400">No accounts with activity.</p>;
}