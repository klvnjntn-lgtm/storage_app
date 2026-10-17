'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Landmark, Printer, Calendar } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { toCalendarDateString, formatDMY, formatDMYTime } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import DatePicker from '@/app/components/shared/DatePicker';

type Kind =
  | 'CUSTOMER_PAYMENT'
  | 'CUSTOMER_REFUND'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE'
  | 'PAYROLL'
  | 'ASSET_PURCHASE'
  | 'ASSET_SALE'
  | 'TRANSFER'
  | 'OWNER'
  | 'LOAN'
  | 'OTHER';

type Line = {
  date: string;
  entryNumber: string | null;
  kind: Kind;
  party: string | null;
  reference: string | null;
  detail: string | null;
  memo: string | null;
  method: string | null;
  moneyIn: number;
  moneyOut: number;
  balance: number;
  link: { type: string; id: string } | null;
};
type KindTotal = { kind: Kind; moneyIn: number; moneyOut: number; count: number };
type Account = {
  accountId: string;
  code: string;
  name: string;
  bankName: string | null;
  accountNumber: string | null;
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
  byKind: KindTotal[];
  lines: Line[];
  truncated: boolean;
};
type Statement = {
  from: string;
  to: string;
  business: { name: string; legalName: string | null; npwp: string | null; address: string | null };
  accounts: Account[];
  totals: { opening: number; moneyIn: number; moneyOut: number; closing: number };
  byKind: KindTotal[];
};

// Where a line's link goes in the app (not followed when printed).
const LINK_PATH: Record<string, (id: string) => string> = {
  invoice: (id) => `/sales/invoices/${id}`,
  'purchase-order': (id) => `/purchasing/purchase-orders/${id}`,
  expense: () => '/accounting/expenses',
  payroll: () => '/accounting/payroll',
  'fixed-asset': () => '/accounting/fixed-assets',
  journal: () => '/accounting/journal',
};

function money(n: number) {
  return n ? formatIDR(n) : '';
}

// useSearchParams() needs a Suspense boundary (same as the customer statement).
export default function CashStatementPage() {
  return (
    <Suspense fallback={null}>
      <CashStatementPageInner />
    </Suspense>
  );
}

function CashStatementPageInner() {
  const router = useRouter();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const accountId = searchParams.get('accountId');

  const [from, setFrom] = useState(searchParams.get('from') ?? toCalendarDateString(new Date()));
  const [to, setTo] = useState(searchParams.get('to') ?? toCalendarDateString(new Date()));
  const [statement, setStatement] = useState<Statement | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ from, to });
        if (accountId) params.set('accountId', accountId);
        const res = await apiFetch(`/accounting/reports/cash-statement?${params}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.message ?? t('accounting.cashStatement.loadFailed'));
          setStatement(null);
          return;
        }
        setError(null);
        setStatement(body);
        setGeneratedAt(new Date());
      } catch {
        if (!cancelled) setError(t('accounting.cashStatement.serverError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, accountId, t]);

  function describe(l: Line): string {
    const parts = [t(`accounting.cashStatement.kind.${l.kind}`)];
    if (l.kind === 'TRANSFER' && l.detail) {
      parts[0] = t(l.moneyIn ? 'accounting.cashStatement.transferFrom' : 'accounting.cashStatement.transferTo', {
        account: l.detail,
      });
    } else if (l.kind === 'SUPPLIER_PAYMENT' && l.detail) {
      parts.push(t('accounting.cashStatement.bills', { bills: l.detail }));
    } else if (l.detail) parts.push(l.detail);
    if (l.kind === 'OTHER' || l.kind === 'OWNER' || l.kind === 'LOAN') {
      if (l.memo) parts.push(l.memo);
    }
    return parts.join(' · ');
  }

  const multi = (statement?.accounts.length ?? 0) > 1;

  return (
    <main
      className="min-h-screen text-black print:bg-white"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #cash-statement-print, #cash-statement-print * { visibility: visible; }
          #cash-statement-print { position: absolute; top: 0; left: 0; width: 100%; }
          .statement-account { break-inside: auto; }
          .statement-account + .statement-account { break-before: page; }
        }
      `}</style>

      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)] print:hidden">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Landmark size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{t('accounting.cashStatement.title')}</h1>
                <p className="text-xs text-gray-500 truncate">
                  {accountId && statement?.accounts[0] ? statement.accounts[0].name : t('accounting.cashStatement.allAccounts')}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => router.push('/accounting/cash-statement/new')}
                className="text-sm px-3 py-2 rounded-md border border-blue-500/20 bg-white hover:bg-blue-50 font-medium"
              >
                {t('accounting.cashStatement.change')}
              </button>
              <button
                onClick={() => window.print()}
                disabled={!statement}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                <Printer size={16} strokeWidth={2} />
                {t('accounting.cashStatement.print')}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 mt-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                <Calendar size={12} strokeWidth={2} />
                {t('accounting.cashStatement.from')}
              </label>
              <DatePicker
                value={from}
                onChange={(v) => {
                  setLoading(true);
                  setFrom(v);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('accounting.cashStatement.to')}</label>
              <DatePicker
                value={to}
                onChange={(v) => {
                  setLoading(true);
                  setTo(v);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6">
        <div id="cash-statement-print" className="bg-white border border-blue-500/15 rounded-xl p-4 sm:p-6 shadow-sm print:border-0 print:shadow-none print:p-0">
          {loading && <p className="text-sm text-gray-500">{t('accounting.cashStatement.loading')}</p>}
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>}

          {!loading && !error && statement && (
            <>
              {/* Business identity and period */}
              <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b-2 border-gray-200">
                <div>
                  <p className="font-bold text-lg leading-tight">{statement.business.legalName ?? statement.business.name}</p>
                  {statement.business.address && <p className="text-xs">{statement.business.address}</p>}
                  {statement.business.npwp && <p className="text-xs">NPWP: {statement.business.npwp}</p>}
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold">{t('accounting.cashStatement.title')}</p>
                  <p className="text-xs">
                    {t('accounting.cashStatement.periodLabel', {
                      from: formatDMY(new Date(statement.from)),
                      to: formatDMY(new Date(statement.to)),
                    })}
                  </p>
                  {generatedAt && (
                    <p className="text-xs text-gray-500">
                      {t('accounting.cashStatement.generatedLabel', { datetime: formatDMYTime(generatedAt) })}
                    </p>
                  )}
                </div>
              </div>

              {statement.accounts.length === 0 && <p className="text-sm">{t('accounting.cashStatement.noAccounts')}</p>}

              {/* Summary: one row per account */}
              {multi && (
                <div className="mb-6">
                  <p className="text-sm font-semibold mb-2">{t('accounting.cashStatement.summary')}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead className="bg-gray-50 border-b-2 border-gray-300">
                        <tr>
                          <th className="text-left p-2 font-semibold">{t('accounting.cashStatement.colAccount')}</th>
                          <th className="text-right p-2 font-semibold">{t('accounting.cashStatement.opening')}</th>
                          <th className="text-right p-2 font-semibold">{t('accounting.cashStatement.colIn')}</th>
                          <th className="text-right p-2 font-semibold">{t('accounting.cashStatement.colOut')}</th>
                          <th className="text-right p-2 font-semibold">{t('accounting.cashStatement.closing')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statement.accounts.map((a) => (
                          <tr key={a.accountId} className="border-b border-gray-200">
                            <td className="p-2">
                              {a.name}
                              {a.accountNumber && <span className="text-gray-500 text-xs"> · {a.accountNumber}</span>}
                            </td>
                            <td className="p-2 text-right">{formatIDR(a.opening)}</td>
                            <td className="p-2 text-right text-green-700">{money(a.moneyIn)}</td>
                            <td className="p-2 text-right text-red-700">{money(a.moneyOut)}</td>
                            <td className="p-2 text-right font-semibold">{formatIDR(a.closing)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold">
                          <td className="p-2">{t('accounting.cashStatement.total')}</td>
                          <td className="p-2 text-right">{formatIDR(statement.totals.opening)}</td>
                          <td className="p-2 text-right text-green-700">{formatIDR(statement.totals.moneyIn)}</td>
                          <td className="p-2 text-right text-red-700">{formatIDR(statement.totals.moneyOut)}</td>
                          <td className="p-2 text-right">{formatIDR(statement.totals.closing)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* One statement per account */}
              {statement.accounts.map((a) => (
                <section key={a.accountId} className="statement-account mb-8">
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <p className="font-bold">
                      {a.name}
                      {a.bankName && a.accountNumber && (
                        <span className="font-normal text-sm text-gray-600">
                          {' '}
                          · {a.bankName} {a.accountNumber}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">{a.code}</p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-sm">
                    {(
                      [
                        ['opening', a.opening, ''],
                        ['colIn', a.moneyIn, 'text-green-700'],
                        ['colOut', a.moneyOut, 'text-red-700'],
                        ['closing', a.closing, 'font-bold'],
                      ] as const
                    ).map(([key, value, cls]) => (
                      <div key={key} className="bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                        <p className="text-xs text-gray-600">{t(`accounting.cashStatement.${key}`)}</p>
                        <p className={cls}>{formatIDR(value)}</p>
                      </div>
                    ))}
                  </div>

                  {a.byKind.length > 0 && (
                    <div className="mb-3 text-xs">
                      <p className="font-semibold mb-1">{t('accounting.cashStatement.byType')}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {a.byKind.map((k) => (
                          <span key={k.kind}>
                            {t(`accounting.cashStatement.kind.${k.kind}`)} ({k.count}):{' '}
                            {k.moneyIn > 0 && <span className="text-green-700">+{formatIDR(k.moneyIn)}</span>}
                            {k.moneyIn > 0 && k.moneyOut > 0 && ' / '}
                            {k.moneyOut > 0 && <span className="text-red-700">−{formatIDR(k.moneyOut)}</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {a.lines.length === 0 ? (
                    <p className="text-sm text-gray-500">{t('accounting.cashStatement.noLines')}</p>
                  ) : (
                    <div className="overflow-x-auto border-2 border-gray-300 rounded-md">
                      <table className="w-full text-sm min-w-[720px]">
                        <thead className="bg-gray-50 border-b-2 border-gray-300">
                          <tr>
                            <th className="text-left p-2 font-semibold">{t('accounting.cashStatement.colDate')}</th>
                            <th className="text-left p-2 font-semibold">{t('accounting.cashStatement.colDescription')}</th>
                            <th className="text-left p-2 font-semibold">{t('accounting.cashStatement.colParty')}</th>
                            <th className="text-left p-2 font-semibold">{t('accounting.cashStatement.colRef')}</th>
                            <th className="text-right p-2 font-semibold">{t('accounting.cashStatement.colIn')}</th>
                            <th className="text-right p-2 font-semibold">{t('accounting.cashStatement.colOut')}</th>
                            <th className="text-right p-2 font-semibold">{t('accounting.cashStatement.colBalance')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-gray-200 bg-gray-50/50">
                            <td className="p-2" colSpan={6}>
                              {t('accounting.cashStatement.opening')}
                            </td>
                            <td className="p-2 text-right">{formatIDR(a.opening)}</td>
                          </tr>
                          {a.lines.map((l, i) => {
                            const href = l.link ? LINK_PATH[l.link.type]?.(l.link.id) : undefined;
                            return (
                              <tr
                                key={i}
                                onClick={() => href && router.push(href)}
                                className={`border-b border-gray-200 last:border-0 ${href ? 'cursor-pointer hover:bg-gray-50 print:cursor-default' : ''}`}
                              >
                                <td className="p-2 whitespace-nowrap">{formatDMY(new Date(l.date))}</td>
                                <td className="p-2">
                                  {describe(l)}
                                  {l.method && (
                                    <span className="text-gray-500 text-xs"> · {t(`accounting.cashStatement.method.${l.method}`)}</span>
                                  )}
                                </td>
                                <td className="p-2">{l.party ?? ''}</td>
                                <td className="p-2 whitespace-nowrap">{l.reference ?? l.entryNumber ?? ''}</td>
                                <td className="p-2 text-right text-green-700 whitespace-nowrap">{money(l.moneyIn)}</td>
                                <td className="p-2 text-right text-red-700 whitespace-nowrap">{money(l.moneyOut)}</td>
                                <td className="p-2 text-right whitespace-nowrap">{formatIDR(l.balance)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-gray-300">
                          <tr className="font-semibold">
                            <td className="p-2" colSpan={4}>
                              {t('accounting.cashStatement.closing')}
                            </td>
                            <td className="p-2 text-right text-green-700">{formatIDR(a.moneyIn)}</td>
                            <td className="p-2 text-right text-red-700">{formatIDR(a.moneyOut)}</td>
                            <td className="p-2 text-right">{formatIDR(a.closing)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                  {a.truncated && <p className="text-xs text-amber-700 mt-1">{t('accounting.cashStatement.truncated')}</p>}
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
