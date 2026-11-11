// app/accounting/stock-check/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { display } from '@/lib/fonts';
import { PackageSearch, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';

// Does the Inventory account still hold what the stock is worth? Both are
// built by the same movements, so a gap means something moved stock or
// cost without its ledger entry. See the backend's
// AccountingReportsService.getInventoryReconciliation.
type ProductRow = { productId: string; sku: string | null; name: string; onHand: number };
type Report = {
  asOf: string;
  ledgerBalance: number;
  stockValue: number;
  difference: number;
  inBalance: boolean;
  productsWithoutCost: { count: number; top: ProductRow[] };
  productsBelowZero: { count: number; top: ProductRow[] };
  provisionalInvoiceLines: number;
};

export default function StockCheckPage() {
  const { t } = useLanguage();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiFetch('/accounting/reports/inventory-reconciliation');
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('accounting.stockCheck.requestFailed', { status: res.status }));
        return;
      }
      setReport(body);
    } catch {
      setError(t('accounting.stockCheck.couldNotReachServer'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refresh() {
    setLoading(true);
    setError(null);
    load();
  }

  const figures = report
    ? [
        { label: t('accounting.stockCheck.ledgerBalance'), hint: t('accounting.stockCheck.ledgerBalanceHint'), value: report.ledgerBalance },
        { label: t('accounting.stockCheck.stockValue'), hint: t('accounting.stockCheck.stockValueHint'), value: report.stockValue },
        { label: t('accounting.stockCheck.difference'), hint: t('accounting.stockCheck.differenceHint'), value: report.difference },
      ]
    : [];

  const lists = report
    ? [
        { title: t('accounting.stockCheck.withoutCost'), hint: t('accounting.stockCheck.withoutCostHint'), ...report.productsWithoutCost },
        { title: t('accounting.stockCheck.belowZero'), hint: t('accounting.stockCheck.belowZeroHint'), ...report.productsBelowZero },
      ].filter((l) => l.count > 0)
    : [];

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <PackageSearch size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('nav.items.stockValueCheck')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.stockCheck.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border-2 border-gray-300 bg-white text-xs font-semibold hover:bg-gray-50 disabled:opacity-60 shrink-0"
          >
            <RefreshCw size={12} strokeWidth={2} className={loading ? 'animate-spin' : ''} />
            {t('accounting.stockCheck.refresh')}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>}
        {loading && !report && <p className="text-sm text-gray-500">{t('accounting.stockCheck.loading')}</p>}

        {report && (
          <>
            <div
              className={`flex items-start gap-2 text-sm rounded-md border-2 p-3 ${
                report.inBalance ? 'text-green-800 bg-green-50 border-green-200' : 'text-amber-800 bg-amber-50 border-amber-200'
              }`}
            >
              {report.inBalance ? (
                <CheckCircle2 size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
              )}
              <span>{report.inBalance ? t('accounting.stockCheck.inBalance') : t('accounting.stockCheck.outOfBalance')}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {figures.map((f) => (
                <div key={f.label} className="border-2 border-gray-300 rounded-md bg-white p-4">
                  <p className="text-xs font-semibold text-gray-600">{f.label}</p>
                  <p className="text-lg font-bold tabular-nums mt-1">{formatIDR(f.value)}</p>
                  <p className="text-[11px] text-gray-500 mt-1">{f.hint}</p>
                </div>
              ))}
            </div>

            {report.provisionalInvoiceLines > 0 && (
              <p className="text-xs text-gray-600 bg-white border-2 border-gray-300 rounded-md p-3">
                {t('accounting.stockCheck.provisionalLines', { count: report.provisionalInvoiceLines })}
              </p>
            )}

            {lists.map((l) => (
              <div key={l.title} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200">
                  <p className="text-sm font-semibold">
                    {l.title} ({l.count})
                  </p>
                  <p className="text-xs text-gray-500">{l.hint}</p>
                </div>
                {l.top.map((p) => (
                  <div key={p.productId} className="flex items-center justify-between gap-3 px-4 py-2 border-b border-gray-100 last:border-b-0 text-sm">
                    <span className="min-w-0 truncate">
                      {p.sku ? <span className="text-gray-500 mr-2">{p.sku}</span> : null}
                      {p.name}
                    </span>
                    <span className="tabular-nums shrink-0">{p.onHand.toLocaleString('id-ID')}</span>
                  </div>
                ))}
                {l.count > l.top.length && (
                  <p className="px-4 py-2 text-xs text-gray-400">{t('accounting.stockCheck.andMore', { count: l.count - l.top.length })}</p>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
