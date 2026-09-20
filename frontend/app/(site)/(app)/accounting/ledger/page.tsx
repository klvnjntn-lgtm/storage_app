// app/accounting/ledger/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, BookOpen, Calendar, Wallet } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type Account = {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  systemKey: string | null;
  bankAccountId: string | null;
  isActive: boolean;
};

type LedgerEntry = {
  journalEntryId: string;
  entryNumber: string | null;
  date: string;
  memo: string | null;
  sourceType: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

type LedgerReport = {
  account: { id: string; code: string; name: string; type: string };
  from: string;
  to: string;
  openingBalance: number;
  closingBalance: number;
  entries: LedgerEntry[];
};

const TYPE_ORDER: Account['type'][] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const TYPE_LABEL: Record<Account['type'], string> = {
  ASSET: 'Assets', LIABILITY: 'Liabilities', EQUITY: 'Equity', REVENUE: 'Revenue', EXPENSE: 'Expenses',
};
const SOURCE_LABEL: Record<string, string> = {
  INVOICE: 'Invoice', PAYMENT: 'Payment', PURCHASE_ORDER: 'Purchase Order', GOODS_RECEIPT: 'Goods Receipt',
  SUPPLIER_PAYMENT: 'Supplier Payment', EXPENSE: 'Expense', PAYROLL: 'Payroll', MANUAL: 'Manual',
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10);
}

const RANGE_PRESETS = [
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'YTD', days: 0 },
] as const;

export default function AccountLedgerPage() {
  const router = useRouter();

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());

  const [report, setReport] = useState<LedgerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/accounting/accounts');
      if (res.ok) {
        const data: Account[] = await res.json();
        setAccounts(data);
        // Default to the Cash account if one exists — the most common
        // reason someone opens this page — rather than leaving it blank.
        const cash = data.find((a) => a.systemKey === 'CASH');
        if (cash) setAccountId(cash.id);
      }
    })();
  }, []);

  async function loadLedger() {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/accounting/reports/account-ledger?accountId=${accountId}&from=${from}&to=${to}`);
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
    loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, from, to]);

  function applyPreset(days: number) {
    const end = new Date();
    setTo(end.toISOString().slice(0, 10));
    if (days === 0) {
      setFrom(new Date(end.getFullYear(), 0, 1).toISOString().slice(0, 10));
    } else {
      const start = new Date();
      start.setDate(start.getDate() - days);
      setFrom(start.toISOString().slice(0, 10));
    }
  }

  // Cash/Bank accounts surfaced as their own group at the top of the
  // picker — systemKey CASH, or anything with a linked OrganizationBankAccount
  // (BCA, BNI, ...). This is the group most people opening this page
  // actually want; everything else groups by account type below it.
  const { cashAndBank, byType } = useMemo(() => {
    const cashAndBank: Account[] = [];
    const rest = new Map<Account['type'], Account[]>();
    for (const t of TYPE_ORDER) rest.set(t, []);

    for (const acc of accounts ?? []) {
      if (acc.systemKey === 'CASH' || acc.bankAccountId) {
        cashAndBank.push(acc);
      } else {
        rest.get(acc.type)?.push(acc);
      }
    }
    cashAndBank.sort((a, b) => a.code.localeCompare(b.code));
    for (const list of rest.values()) list.sort((a, b) => a.code.localeCompare(b.code));
    return { cashAndBank, byType: rest };
  }, [accounts]);

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
              <BookOpen size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>Account Ledger</h1>
              <p className="text-xs text-gray-500 truncate">Transaction history for a single account, including each bank account</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Account picker */}
        <div className="flex flex-col gap-1 mb-4">
          <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
            <Wallet size={12} strokeWidth={2} />
            Account
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500 bg-white w-full sm:w-96"
          >
            <option value="" disabled>Choose an account...</option>
            {cashAndBank.length > 0 && (
              <optgroup label="Cash & Bank Accounts">
                {cashAndBank.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                ))}
              </optgroup>
            )}
            {TYPE_ORDER.map((type) => {
              const list = byType.get(type) ?? [];
              if (list.length === 0) return null;
              return (
                <optgroup key={type} label={TYPE_LABEL[type]}>
                  {list.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>

        {/* Date range */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-5">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                <Calendar size={12} strokeWidth={2} /> From
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 sm:flex gap-1.5">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.days)}
                className="text-xs px-3 py-2.5 sm:py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}
        {loading && <p className="text-sm text-gray-500 mb-4">Loading...</p>}
        {!accountId && !loading && (
          <p className="text-sm text-gray-400 text-center py-8">Choose an account above to see its ledger.</p>
        )}

        {!loading && report && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="border-2 border-gray-300 rounded-md bg-white p-3 sm:p-4">
                <p className="text-[11px] font-semibold text-gray-500 mb-1">Opening balance</p>
                <p className="text-lg sm:text-xl font-bold">{formatIDR(report.openingBalance)}</p>
              </div>
              <div className="border-2 border-black rounded-md bg-black text-white p-3 sm:p-4">
                <p className="text-[11px] font-semibold text-gray-300 mb-1">Closing balance</p>
                <p className="text-lg sm:text-xl font-bold">{formatIDR(report.closingBalance)}</p>
              </div>
            </div>

            {report.entries.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No transactions in this range.</p>
            ) : (
              <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
                <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200 bg-gray-50">
                  <span className="w-16">Date</span>
                  <span>Memo</span>
                  <span className="text-right w-24">Debit</span>
                  <span className="text-right w-24">Credit</span>
                  <span className="text-right w-28">Balance</span>
                </div>
                {report.entries.map((e) => (
                  <div key={e.journalEntryId} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2.5 text-xs border-b border-gray-50 last:border-b-0 items-center">
                    <span className="w-16 text-gray-500 shrink-0">
                      {new Date(e.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-gray-800">{e.memo ?? '—'}</p>
                      <p className="text-[10px] text-gray-400">
                        {e.entryNumber ?? ''} {e.entryNumber && '·'} {SOURCE_LABEL[e.sourceType] ?? e.sourceType}
                      </p>
                    </div>
                    <span className="text-right w-24 tabular-nums">{e.debit > 0 ? formatIDR(e.debit) : ''}</span>
                    <span className="text-right w-24 tabular-nums">{e.credit > 0 ? formatIDR(e.credit) : ''}</span>
                    <span className="text-right w-28 tabular-nums font-semibold">{formatIDR(e.runningBalance)}</span>
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