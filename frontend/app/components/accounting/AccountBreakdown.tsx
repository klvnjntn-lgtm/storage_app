'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY, parseCalendarDate } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

type LedgerEntry = {
  journalEntryId: string;
  entryNumber: string | null;
  date: string;
  memo: string | null;
  sourceType: string;
  debit: number;
  credit: number;
};
type LedgerPage = {
  account: { type: string };
  entries: LedgerEntry[];
  pagination: { page: number; total: number; totalPages: number };
};
type Summary = {
  account: { type: string };
  total: number;
  groups: { sourceType: string; category: string | null; count: number; amount: number }[];
};

const PAGE_SIZE = 50;
// The account-ledger endpoint needs a start date; a balance sheet line is everything to date.
export const ALL_TIME_FROM = '2000-01-01';

// A report page's "show every breakdown" switch, so a reader sees what each figure is made of
// without opening rows one by one.
const ExpandAllContext = createContext(false);
export const BreakdownExpandAll = ExpandAllContext.Provider;

export function BreakdownToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 transition-colors"
    >
      {value ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      {value ? t('accounting.breakdown.hideAll') : t('accounting.breakdown.showAll')}
    </button>
  );
}

// One account's line on a report (balance sheet, profit & loss, …) that opens to show what makes
// up its amount: a summary by expense category or kind of transaction with each part's share,
// then — on request — the transactions themselves and a link to the full ledger.
export function AccountBreakdownRow({
  accountId,
  from,
  to,
  className,
  actions,
  indent = 0,
  children,
}: {
  accountId: string;
  from: string;
  to: string;
  className?: string;
  // Buttons beside the row (kept outside the clickable area, so they don't toggle it).
  actions?: ReactNode;
  // Left offset in px, for a child account drawn under its parent.
  indent?: number;
  // The row as the report draws it (label + amount).
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const expandAll = useContext(ExpandAllContext);
  const [open, setOpen] = useState(expandAll);
  const key = `${accountId}|${from}|${to}`;
  const [summary, setSummary] = useState<{ key: string; data: Summary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEntries, setShowEntries] = useState(false);
  const [ledger, setLedger] = useState<{ key: string; page: LedgerPage } | null>(null);

  // The page's switch opens or closes every row.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(expandAll);
  }, [expandAll]);

  useEffect(() => {
    if (!open || summary?.key === key) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await apiFetch(`/accounting/reports/account-summary?${new URLSearchParams({ accountId, from, to })}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setError(body?.message ?? t('accounting.breakdown.loadFailed'));
        else setSummary({ key, data: body });
      } catch {
        if (!cancelled) setError(t('accounting.breakdown.loadFailed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, key, accountId, from, to, summary?.key, t]);

  useEffect(() => {
    if (!open || !showEntries || ledger?.key === key) return;
    let cancelled = false;
    (async () => {
      const url = (page: number) =>
        `/accounting/reports/account-ledger?${new URLSearchParams({ accountId, from, to, page: String(page), pageSize: String(PAGE_SIZE) })}`;
      let res = await apiFetch(url(1));
      let body = await res.json().catch(() => null);
      // Entries come oldest first; the newest are the ones worth reading here.
      if (res.ok && body.pagination.totalPages > 1) {
        res = await apiFetch(url(body.pagination.totalPages));
        body = await res.json().catch(() => null);
      }
      if (!cancelled && res.ok) setLedger({ key, page: body });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, showEntries, key, accountId, from, to, ledger?.key]);

  const sourceLabel = (sourceType: string) => {
    const k = `accounting.breakdown.source.${sourceType}`;
    const label = t(k);
    return label === k ? sourceType : label;
  };

  const data = summary?.key === key ? summary.data : null;
  const page = ledger?.key === key ? ledger.page : null;
  const debitNormal = data ? data.account.type === 'ASSET' || data.account.type === 'EXPENSE' : true;
  const entries = page ? [...page.entries].reverse() : [];
  // Shares are of the gross movement, so a figure that's in minus parts still adds to 100%.
  const gross = data ? data.groups.reduce((s, g) => s + Math.abs(g.amount), 0) : 0;

  return (
    <div className={className}>
      <div className="flex items-stretch hover:bg-blue-50/60 transition-colors">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={t('accounting.breakdown.hint')}
          style={indent ? { paddingLeft: indent } : undefined}
          className="flex-1 min-w-0 text-left flex items-stretch"
        >
          <span className="pl-2 flex items-center text-gray-400">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="flex-1 min-w-0">{children}</span>
        </button>
        {actions && <div className="shrink-0 flex items-center gap-2 pr-4">{actions}</div>}
      </div>
      {open && (
        <div className="mr-4 mb-3 mt-0.5 border-l-2 border-blue-500/25 pl-3 text-xs" style={{ marginLeft: indent + 32 }}>
          {error ? (
            <p className="py-1 text-red-700">{error}</p>
          ) : !data ? (
            <p className="py-1 text-gray-500">{t('common.loading')}</p>
          ) : data.groups.length === 0 ? (
            <p className="py-1 text-gray-500">{t('accounting.breakdown.empty')}</p>
          ) : (
            <>
              <ul className="space-y-1.5 py-1">
                {data.groups.map((g) => {
                  const share = gross ? Math.abs(g.amount) / gross : 0;
                  return (
                    <li key={`${g.sourceType}|${g.category ?? ''}`}>
                      <div className="flex items-baseline gap-3">
                        <span className="min-w-0 flex-1 truncate text-gray-700">
                          {g.category ?? sourceLabel(g.sourceType)}
                          <span className="ml-1.5 text-gray-400">
                            {g.category && `${sourceLabel(g.sourceType)} · `}
                            {t('accounting.breakdown.count', { count: g.count })}
                          </span>
                        </span>
                        <span className="text-gray-400 tabular-nums w-10 text-right">{Math.round(share * 100)}%</span>
                        <span className={`tabular-nums whitespace-nowrap w-32 text-right ${g.amount < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                          {formatIDR(g.amount)}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${g.amount < 0 ? 'bg-red-300' : 'bg-blue-400'}`}
                          style={{ width: `${Math.max(share * 100, 1)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-baseline justify-between gap-3 pt-1.5 mt-1 border-t border-gray-200 font-semibold text-gray-800">
                <span>{t('accounting.breakdown.total')}</span>
                <span className="tabular-nums">{formatIDR(data.total)}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 text-gray-500">
                <button type="button" onClick={() => setShowEntries((s) => !s)} className="font-semibold text-blue-700 hover:underline">
                  {showEntries ? t('accounting.breakdown.hideEntries') : t('accounting.breakdown.showEntries')}
                </button>
                <Link href={`/accounting/ledger?${new URLSearchParams({ accountId, from, to })}`} className="font-semibold text-blue-700 hover:underline">
                  {t('accounting.breakdown.openLedger')}
                </Link>
              </div>
              {showEntries && (
                <div className="mt-1.5 border border-blue-500/15 rounded-md bg-blue-50/30">
                  {!page ? (
                    <p className="px-3 py-2 text-gray-500">{t('common.loading')}</p>
                  ) : (
                    <>
                      <ul className="divide-y divide-blue-500/10">
                        {entries.map((e, i) => {
                          const amount = debitNormal ? e.debit - e.credit : e.credit - e.debit;
                          return (
                            <li key={`${e.journalEntryId}-${i}`} className="px-3 py-1.5 flex items-baseline gap-3">
                              <span className="text-gray-500 whitespace-nowrap">{formatDMY(parseCalendarDate(e.date.slice(0, 10)))}</span>
                              <span className="min-w-0 flex-1 truncate text-gray-700">
                                {e.memo || sourceLabel(e.sourceType)}
                                {e.entryNumber && <span className="ml-1.5 text-gray-400 font-mono">{e.entryNumber}</span>}
                              </span>
                              <span className={`tabular-nums whitespace-nowrap ${amount < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                                {formatIDR(amount)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {page.pagination.total > entries.length && (
                        <p className="px-3 py-1.5 border-t border-blue-500/10 text-gray-500">
                          {t('accounting.breakdown.showingLatest', { shown: entries.length, total: page.pagination.total })}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
