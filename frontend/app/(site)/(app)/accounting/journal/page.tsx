// app/accounting/journal/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { BookText, ChevronDown, ChevronUp, Plus, X, Loader2, Ban, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import Pagination from '@/app/components/shared/Pagination';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import { toCalendarDateString } from '@/lib/dates';
import { useAuth } from '@/app/context/AuthContext';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';


type Account = { id: string; code: string; name: string; type: string };

type JournalLine = {
  id: string;
  accountId: string;
  debit: number | string;
  credit: number | string;
  description: string | null;
  account: { code: string; name: string };
};

type JournalEntry = {
  id: string;
  entryNumber: string | null;
  entryDate: string;
  memo: string | null;
  sourceType: string;
  status: 'POSTED' | 'VOID';
  reversalOfId: string | null;
  lines: JournalLine[];
};

const SOURCE_TYPES = ['INVOICE', 'PAYMENT', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'SUPPLIER_PAYMENT', 'EXPENSE', 'PAYROLL', 'MANUAL'];
const SOURCE_LABEL_KEY: Record<string, string> = {
  INVOICE: 'accounting.journal.source.invoice',
  PAYMENT: 'accounting.journal.source.payment',
  PURCHASE_ORDER: 'accounting.journal.source.purchaseOrder',
  GOODS_RECEIPT: 'accounting.journal.source.goodsReceipt',
  SUPPLIER_PAYMENT: 'accounting.journal.source.supplierPayment',
  EXPENSE: 'accounting.journal.source.expense',
  PAYROLL: 'accounting.journal.source.payroll',
  MANUAL: 'accounting.journal.source.manual',
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
// FIX — .toISOString() converts to UTC first, which is wrong in a
// timezone ahead of UTC both for date-range filters and — worse — for
// todayISO(), which pre-fills the actual entryDate submitted when
// posting a manual journal entry, silently misdating the ledger for a
// ~7-hour window after local midnight.
function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toCalendarDateString(d);
}
function defaultTo() {
  return toCalendarDateString(new Date());
}
function todayISO() {
  return toCalendarDateString(new Date());
}

type ManualLine = { accountId: string; side: 'debit' | 'credit'; amount: string; description: string };

export default function JournalPage() {
    const { t } = useLanguage();
    const { profile } = useAuth();
  const isAdmin = profile?.role === 'ADMIN';

  const [entries, setEntries] = useState<{ data: JournalEntry[]; total: number; page: number; pageSize: number } | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Seeded from the URL so a browser Back navigation (e.g. from voiding a
  // reversal that briefly leaves this page) restores the same filters
  // instead of resetting to the default 30-day range.
  const [sourceType, setSourceType] = useState<string>(() => getInitialParam('sourceType', ''));
  const [from, setFrom] = useState<string | null>(() => getInitialParam('from', defaultFrom()));
  const [to, setTo] = useState<string | null>(() => getInitialParam('to', defaultTo()));
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', 20));

  useSyncQueryParams({
    sourceType: sourceType || null,
    from,
    to,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== 20 ? pageSize : null,
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);

  const [showManual, setShowManual] = useState(false);
  const [manualDate, setManualDate] = useState(todayISO());
  const [manualMemo, setManualMemo] = useState('');
  const [manualLines, setManualLines] = useState<ManualLine[]>([
    { accountId: '', side: 'debit', amount: '', description: '' },
    { accountId: '', side: 'credit', amount: '', description: '' },
  ]);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  async function loadEntries() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (sourceType) params.set('sourceType', sourceType);
      const res = await apiFetch(`/accounting/journal?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.journal.requestFailed', { status: res.status }));
        return;
      }
      setEntries(await res.json());
    } catch {
      setError(t('accounting.journal.couldNotReachServer'));
    } finally {
      setLoading(false);
    }
  }

  async function loadAccounts() {
    const res = await apiFetch('/accounting/accounts');
    if (res.ok) setAccounts(await res.json());
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  // FIX — see ledger/page.tsx's identical fix: merges what were two
  // separate effects (load-on-every-dep + reset-page-on-filter-change)
  // into one, so a filter change fires exactly one request instead of
  // two (the first with a stale page, the second corrective).
  const filtersKey = `${sourceType}|${from}|${to}`;
  const prevFiltersKeyRef = useRef(filtersKey);
  useEffect(() => {
    if (prevFiltersKeyRef.current !== filtersKey) {
      prevFiltersKeyRef.current = filtersKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page, pageSize]);

  async function handleVoid(entry: JournalEntry) {
    const reason = prompt(t('accounting.journal.voidPrompt', { entryNumber: entry.entryNumber ?? entry.id }));
    if (reason === null) return; // cancelled
    if (!reason.trim()) {
      setVoidError(t('accounting.journal.voidReasonRequired'));
      return;
    }
    setVoidingId(entry.id);
    setVoidError(null);
    try {
      const res = await apiFetch(`/accounting/journal/${entry.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setVoidError(body?.message ?? t('accounting.journal.requestFailed', { status: res.status }));
        return;
      }
      await loadEntries();
    } catch {
      setVoidError(t('accounting.journal.couldNotReachServer'));
    } finally {
      setVoidingId(null);
    }
  }

  function addManualLine() {
    setManualLines((ls) => [...ls, { accountId: '', side: 'debit', amount: '', description: '' }]);
  }
  function removeManualLine(index: number) {
    setManualLines((ls) => ls.filter((_, i) => i !== index));
  }
  function updateManualLine(index: number, patch: Partial<ManualLine>) {
    setManualLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  const manualTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of manualLines) {
      const amt = Number(l.amount) || 0;
      if (l.side === 'debit') debit += amt;
      else credit += amt;
    }
    return { debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100 };
  }, [manualLines]);
  const manualBalanced = manualTotals.debit === manualTotals.credit && manualTotals.debit > 0;

  async function handleSubmitManual(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);

    if (manualLines.some((l) => !l.accountId)) {
      setManualError(t('accounting.journal.errorLineNeedsAccount'));
      return;
    }
    if (manualLines.some((l) => !Number(l.amount) || Number(l.amount) <= 0)) {
      setManualError(t('accounting.journal.errorLineNeedsAmount'));
      return;
    }
    if (!manualBalanced) {
      setManualError(t('accounting.journal.errorNotBalanced', { debit: formatIDR(manualTotals.debit), credit: formatIDR(manualTotals.credit) }));
      return;
    }

    setManualSaving(true);
    try {
      const res = await apiFetch('/accounting/journal/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: manualDate,
          memo: manualMemo.trim() || undefined,
          lines: manualLines.map((l) => ({
            accountId: l.accountId,
            debit: l.side === 'debit' ? Number(l.amount) : undefined,
            credit: l.side === 'credit' ? Number(l.amount) : undefined,
            description: l.description.trim() || undefined,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setManualError(body?.message ?? t('accounting.journal.requestFailed', { status: res.status }));
        return;
      }
      setShowManual(false);
      setManualMemo('');
      setManualLines([
        { accountId: '', side: 'debit', amount: '', description: '' },
        { accountId: '', side: 'credit', amount: '', description: '' },
      ]);
      await loadEntries();
    } catch {
      setManualError(t('accounting.journal.couldNotReachServer'));
    } finally {
      setManualSaving(false);
    }
  }

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
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <BookText size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>{t('nav.items.journal')}</h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.journal.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4">
          <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500 bg-white"
          >
            <option value="">{t('accounting.journal.allSourceTypes')}</option>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>{t(SOURCE_LABEL_KEY[s])}</option>
            ))}
          </select>
          {isAdmin && (
            <button
              onClick={() => setShowManual((s) => !s)}
              className="sm:ml-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              {showManual ? <X size={15} strokeWidth={2} /> : <Plus size={15} strokeWidth={2} />}
              {showManual ? t('common.cancel') : t('accounting.journal.manualEntry')}
            </button>
          )}
        </div>

        {/* Manual entry form — admin only, backend also enforces this (assertAdmin on POST /journal/manual) */}
        {isAdmin && showManual && (
          <form onSubmit={handleSubmitManual} className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3">
            {manualError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{manualError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">{t('common.date')}</label>
                <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">{t('accounting.journal.memoOptional')}</label>
                <input type="text" value={manualMemo} onChange={(e) => setManualMemo(e.target.value)} className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white" />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-600">{t('accounting.journal.lines')}</label>
              {manualLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                  <select
                    value={line.accountId}
                    onChange={(e) => updateManualLine(idx, { accountId: e.target.value })}
                    className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                  >
                    <option value="">{t('accounting.journal.accountPlaceholder')}</option>
                    {(accounts ?? []).map((a) => (
                      <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                    ))}
                  </select>
                  <select
                    value={line.side}
                    onChange={(e) => updateManualLine(idx, { side: e.target.value as 'debit' | 'credit' })}
                    className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white w-20"
                  >
                    <option value="debit">{t('accounting.journal.debit')}</option>
                    <option value="credit">{t('accounting.journal.credit')}</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    placeholder={t('common.amount')}
                    value={line.amount}
                    onChange={(e) => updateManualLine(idx, { amount: e.target.value })}
                    className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white w-24"
                  />
                  <button
                    type="button"
                    onClick={() => removeManualLine(idx)}
                    disabled={manualLines.length <= 2}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addManualLine}
                className="self-start text-xs font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1"
              >
                <Plus size={12} strokeWidth={2} /> {t('accounting.journal.addLine')}
              </button>
            </div>

            <div className={`flex items-center justify-between text-xs font-semibold rounded-md p-2 ${manualBalanced ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              <span>{t('accounting.journal.debitsSummary', { amount: formatIDR(manualTotals.debit) })}</span>
              <span>{t('accounting.journal.creditsSummary', { amount: formatIDR(manualTotals.credit) })}</span>
              <span>{manualBalanced ? t('accounting.journal.balanced') : t('accounting.journal.notBalanced')}</span>
            </div>

            <button
              type="submit"
              disabled={manualSaving || !manualBalanced}
              className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {manualSaving && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
              {manualSaving ? t('accounting.journal.posting') : t('accounting.journal.postEntry')}
            </button>
          </form>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}
        {voidError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{voidError}</p>}
        {loading && <p className="text-sm text-gray-500 mb-4">{t('common.loading')}</p>}

        {!loading && entries && entries.data.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">{t('accounting.journal.noEntriesInRange')}</p>
        )}

        <div className="flex flex-col gap-2">
          {(entries?.data ?? []).map((entry) => {
            const isExpanded = expandedId === entry.id;
            const total = entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
            return (
              <div key={entry.id} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full flex items-center justify-between gap-3 p-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${
                        entry.status === 'VOID' ? 'text-gray-400 bg-gray-100 border-gray-200' : 'text-blue-700 bg-blue-50 border-blue-200'
                      }`}
                    >
                      {entry.status === 'VOID' ? t('accounting.journal.statusVoid') : t('accounting.journal.statusPosted')}
                    </span>
                    <span className="text-sm font-semibold truncate">{entry.entryNumber ?? entry.id}</span>
                    <span className="text-xs text-gray-400 shrink-0">{SOURCE_LABEL_KEY[entry.sourceType] ? t(SOURCE_LABEL_KEY[entry.sourceType]) : entry.sourceType}</span>
                    {entry.memo && <span className="text-xs text-gray-500 truncate hidden sm:inline">{entry.memo}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-bold">{formatIDR(total)}</span>
                    {isExpanded ? <ChevronUp size={15} strokeWidth={2} className="text-gray-400" /> : <ChevronDown size={15} strokeWidth={2} className="text-gray-400" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-50">
                      <span>{t('accounting.journal.accountColumn')}</span>
                      <span className="text-right w-24">{t('accounting.journal.debit')}</span>
                      <span className="text-right w-24">{t('accounting.journal.credit')}</span>
                    </div>
                    {entry.lines.map((line) => (
                      <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 text-xs border-b border-gray-50 last:border-b-0">
                        <span className="truncate text-gray-700">
                          <span className="text-gray-400 font-mono mr-2">{line.account.code}</span>
                          {line.account.name}
                          {line.description && <span className="text-gray-400"> — {line.description}</span>}
                        </span>
                        <span className="text-right w-24 tabular-nums">{Number(line.debit) > 0 ? formatIDR(Number(line.debit)) : ''}</span>
                        <span className="text-right w-24 tabular-nums">{Number(line.credit) > 0 ? formatIDR(Number(line.credit)) : ''}</span>
                      </div>
                    ))}
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      {entry.reversalOfId && (
                        <span className="text-[11px] text-gray-400">{t('accounting.journal.reversalOfNote')}</span>
                      )}
                      {isAdmin && entry.status === 'POSTED' && !entry.reversalOfId && (
                        <button
                          onClick={() => handleVoid(entry)}
                          disabled={voidingId === entry.id}
                          className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          <Ban size={11} strokeWidth={2} />
                          {voidingId === entry.id ? t('accounting.journal.voiding') : t('accounting.journal.voidEntry')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {entries && (
          <div className="mt-4">
            <Pagination
              page={entries.page}
              pageSize={entries.pageSize}
              totalItems={entries.total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>
    </main>
  );
}