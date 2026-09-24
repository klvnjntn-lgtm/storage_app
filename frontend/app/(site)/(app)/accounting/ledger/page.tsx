// app/accounting/ledger/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { BookOpen, Wallet } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import Pagination from '@/app/components/shared/Pagination';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import { toCalendarDateString } from '@/lib/dates';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';

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
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const TYPE_ORDER: Account['type'][] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const TYPE_LABEL_KEY: Record<Account['type'], string> = {
  ASSET: 'accounting.setup.typeAssets',
  LIABILITY: 'accounting.setup.typeLiabilities',
  EQUITY: 'accounting.setup.typeEquity',
  REVENUE: 'accounting.setup.typeRevenue',
  EXPENSE: 'accounting.setup.typeExpenses',
};
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
// FIX — .toISOString() converts to UTC first, rolling the date back a
// day in a timezone ahead of UTC (also fixed in applyPreset below, where
// the "YTD" preset used to start on Dec 31 of the previous year instead
// of Jan 1).
function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toCalendarDateString(d);
}
function defaultTo() {
  return toCalendarDateString(new Date());
}

// What DateRangePicker's "All time" preset resolves to — account-ledger's
// from/to are required by the backend, not optional, so a null/null
// onChange gets translated to a fixed wide range rather than sent as-is.
const ALL_TIME_FROM = '2000-01-01';

export default function AccountLedgerPage() {
  const { t, language } = useLanguage();
  // Seeded from the URL so returning here (e.g. via the browser's Back
  // button) restores the same account/range/page instead of resetting to
  // the default Cash account and a 30-day range.
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState<string>(() => getInitialParam('accountId', ''));
  const [from, setFrom] = useState(() => getInitialParam('from', defaultFrom()));
  const [to, setTo] = useState(() => getInitialParam('to', defaultTo()));
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', 50));

  const [report, setReport] = useState<LedgerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSyncQueryParams({
    accountId: accountId || null,
    from,
    to,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== 50 ? pageSize : null,
  });

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/accounting/accounts');
      if (res.ok) {
        const data: Account[] = await res.json();
        setAccounts(data);
        // Default to the Cash account if one exists — the most common
        // reason someone opens this page — rather than leaving it blank.
        // Skipped when the URL already named an account (e.g. restored
        // via the browser's Back button), so that choice isn't clobbered.
        if (accountId) return;
        const cash = data.find((a) => a.systemKey === 'CASH');
        if (cash) setAccountId(cash.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadLedger() {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/accounting/reports/account-ledger?accountId=${accountId}&from=${from}&to=${to}&page=${page}&pageSize=${pageSize}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.ledger.requestFailed', { status: res.status }));
        setReport(null);
        return;
      }
      setReport(await res.json());
    } catch {
      setError(t('accounting.ledger.couldNotReachServer'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  // FIX — was two separate effects (one loading on every dep including
  // `page`, another resetting `page` to 1 whenever a filter changed).
  // Changing a filter fired the first effect immediately with the STALE
  // page, then the second effect's setPage(1) fired the first effect
  // AGAIN — two requests per filter change, and a brief render with an
  // out-of-range page in between. Merged into one effect: a filter
  // change resets the page and skips straight to the single reload once
  // page has settled at 1 (or reloads immediately if already on page 1).
  const filtersKey = `${accountId}|${from}|${to}`;
  const prevFiltersKeyRef = useRef(filtersKey);
  useEffect(() => {
    if (prevFiltersKeyRef.current !== filtersKey) {
      prevFiltersKeyRef.current = filtersKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, page, pageSize]);

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
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <BookOpen size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>{t('nav.items.accountLedger')}</h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.ledger.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Account picker */}
        <div className="flex flex-col gap-1 mb-4">
          <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
            <Wallet size={12} strokeWidth={2} />
            {t('accounting.journal.accountColumn')}
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500 bg-white w-full sm:w-96"
          >
            <option value="" disabled>{t('accounting.ledger.chooseAccount')}</option>
            {cashAndBank.length > 0 && (
              <optgroup label={t('accounting.ledger.cashAndBankAccounts')}>
                {cashAndBank.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                ))}
              </optgroup>
            )}
            {TYPE_ORDER.map((type) => {
              const list = byType.get(type) ?? [];
              if (list.length === 0) return null;
              return (
                <optgroup key={type} label={t(TYPE_LABEL_KEY[type])}>
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
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, t) => {
              setFrom(f ?? ALL_TIME_FROM);
              setTo(t ?? toCalendarDateString(new Date()));
            }}
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}
        {loading && <p className="text-sm text-gray-500 mb-4">{t('common.loading')}</p>}
        {!accountId && !loading && (
          <p className="text-sm text-gray-400 text-center py-8">{t('accounting.ledger.chooseAccountPrompt')}</p>
        )}

        {!loading && report && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="border-2 border-gray-300 rounded-md bg-white p-3 sm:p-4">
                <p className="text-[11px] font-semibold text-gray-500 mb-1">{t('accounting.ledger.openingBalance')}</p>
                <p className="text-lg sm:text-xl font-bold">{formatIDR(report.openingBalance)}</p>
              </div>
              <div className="border-2 border-black rounded-md bg-black text-white p-3 sm:p-4">
                <p className="text-[11px] font-semibold text-gray-300 mb-1">{t('accounting.ledger.closingBalance')}</p>
                <p className="text-lg sm:text-xl font-bold">{formatIDR(report.closingBalance)}</p>
              </div>
            </div>

            {report.entries.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">{t('accounting.ledger.noTransactionsInRange')}</p>
            ) : (
              <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
                <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200 bg-gray-50">
                  <span className="w-16">{t('common.date')}</span>
                  <span>{t('accounting.ledger.memo')}</span>
                  <span className="text-right w-24">{t('accounting.journal.debit')}</span>
                  <span className="text-right w-24">{t('accounting.journal.credit')}</span>
                  <span className="text-right w-28">{t('accounting.ledger.balance')}</span>
                </div>
                {report.entries.map((e) => (
                  <div key={e.journalEntryId} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2.5 text-xs border-b border-gray-50 last:border-b-0 items-center">
                    <span className="w-16 text-gray-500 shrink-0">
                      {new Date(e.date).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', { day: '2-digit', month: 'short' })}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-gray-800">{e.memo ?? '—'}</p>
                      <p className="text-[10px] text-gray-400">
                        {e.entryNumber ?? ''} {e.entryNumber && '·'} {SOURCE_LABEL_KEY[e.sourceType] ? t(SOURCE_LABEL_KEY[e.sourceType]) : e.sourceType}
                      </p>
                    </div>
                    <span className="text-right w-24 tabular-nums">{e.debit > 0 ? formatIDR(e.debit) : ''}</span>
                    <span className="text-right w-24 tabular-nums">{e.credit > 0 ? formatIDR(e.credit) : ''}</span>
                    <span className="text-right w-28 tabular-nums font-semibold">{formatIDR(e.runningBalance)}</span>
                  </div>
                ))}
              </div>
            )}

            {report.entries.length > 0 && (
              <div className="mt-4">
                <Pagination
                  page={report.pagination.page}
                  pageSize={report.pagination.pageSize}
                  totalItems={report.pagination.total}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}