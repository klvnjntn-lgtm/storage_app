'use client';

import { useState, type ReactNode } from 'react';
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

const PAGE_SIZE = 50;
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
// The account-ledger endpoint needs a start date; a balance sheet line is everything to date.
export const ALL_TIME_FROM = '2000-01-01';

// One account's line on a report (balance sheet, profit & loss, …) that opens to show what makes
// up its amount: the journal lines posted to it in the period, newest first, with a link to the
// full ledger.
export function AccountBreakdownRow({
  accountId,
  from,
  to,
  className,
  children,
}: {
  accountId: string;
  from: string;
  to: string;
  className?: string;
  // The row as the report draws it (label + amount).
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ key: string; page: LedgerPage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${accountId}|${from}|${to}`;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || data?.key === key) return;
    setError(null);
    try {
      const url = (page: number) =>
        `/accounting/reports/account-ledger?${new URLSearchParams({ accountId, from, to, page: String(page), pageSize: String(PAGE_SIZE) })}`;
      let res = await apiFetch(url(1));
      let body = await res.json().catch(() => null);
      // Entries come oldest first; the newest are what explain today's figure.
      if (res.ok && body.pagination.totalPages > 1) {
        res = await apiFetch(url(body.pagination.totalPages));
        body = await res.json().catch(() => null);
      }
      if (!res.ok) {
        setError(body?.message ?? t('accounting.breakdown.loadFailed'));
        return;
      }
      setData({ key, page: body });
    } catch {
      setError(t('accounting.breakdown.loadFailed'));
    }
  }

  const page = data?.key === key ? data.page : null;
  // Shown the way the report counts the account: debit-normal (assets, expenses) or credit-normal.
  const debitNormal = page ? page.account.type === 'ASSET' || page.account.type === 'EXPENSE' : true;
  const entries = page ? [...page.entries].reverse() : [];

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title={t('accounting.breakdown.hint')}
        className="w-full text-left flex items-stretch hover:bg-blue-50/60 transition-colors"
      >
        <span className="pl-2 flex items-center text-gray-400">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="flex-1 min-w-0">{children}</span>
      </button>
      {open && (
        <div className="mx-4 mb-3 mt-1 border border-blue-500/15 rounded-md bg-blue-50/30 text-xs">
          {error ? (
            <p className="px-3 py-2 text-red-700">{error}</p>
          ) : !page ? (
            <p className="px-3 py-2 text-gray-500">{t('common.loading')}</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-2 text-gray-500">{t('accounting.breakdown.empty')}</p>
          ) : (
            <>
              <ul className="divide-y divide-blue-500/10">
                {entries.map((e, i) => {
                  const amount = debitNormal ? e.debit - e.credit : e.credit - e.debit;
                  return (
                    <li key={`${e.journalEntryId}-${i}`} className="px-3 py-1.5 flex items-baseline gap-3">
                      <span className="text-gray-500 whitespace-nowrap">{formatDMY(parseCalendarDate(e.date.slice(0, 10)))}</span>
                      <span className="min-w-0 flex-1 truncate text-gray-700">
                        {e.memo || (SOURCE_LABEL_KEY[e.sourceType] ? t(SOURCE_LABEL_KEY[e.sourceType]) : e.sourceType)}
                        {e.entryNumber && <span className="ml-1.5 text-gray-400 font-mono">{e.entryNumber}</span>}
                      </span>
                      <span className={`tabular-nums whitespace-nowrap ${amount < 0 ? 'text-red-700' : 'text-gray-800'}`}>
                        {formatIDR(amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="px-3 py-1.5 flex items-center justify-between gap-2 border-t border-blue-500/10 text-gray-500">
                <span>
                  {page.pagination.total > entries.length
                    ? t('accounting.breakdown.showingLatest', { shown: entries.length, total: page.pagination.total })
                    : t('accounting.breakdown.count', { count: page.pagination.total })}
                </span>
                <Link
                  href={`/accounting/ledger?${new URLSearchParams({ accountId, from, to })}`}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  {t('accounting.breakdown.openLedger')}
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
