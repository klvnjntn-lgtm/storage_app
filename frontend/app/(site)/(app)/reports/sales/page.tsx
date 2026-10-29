'use client';

import { useState, type ReactNode } from 'react';
import { ChartColumnIncreasing, LayoutDashboard, ReceiptText, Trophy } from 'lucide-react';
import { PageFrame } from '@/app/components/shared/PageFrame';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import { useLanguage } from '@/app/context/LanguageContext';
import { toCalendarDateString } from '@/lib/dates';
import { getInitialParam, useMergeQueryParams } from '@/lib/useQuerySync';
import { InvoiceMarginList, MarginSummary, useRevenueReport } from '@/app/components/reports/SalesMargin';
import { SalesRankings, TopSellersPreview } from '@/app/components/reports/SalesRankings';

type Tab = 'overview' | 'invoices' | 'rankings';
const TABS: { key: Tab; icon: typeof Trophy }[] = [
  { key: 'overview', icon: LayoutDashboard },
  { key: 'invoices', icon: ReceiptText },
  { key: 'rankings', icon: Trophy },
];

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toCalendarDateString(d);
}
// What DateRangePicker's "All time" preset (null/null) becomes — both
// report endpoints need a from/to.
const ALL_TIME_FROM = '2000-01-01';

// How sales went, from the issued invoices (not the ledger): margins
// overall and per invoice, and who and what sold. One date range for every
// tab, so "this month's profit and top customers" is one visit. Replaces
// the separate Sales Margin and Sales Insights pages.
export default function SalesReportsPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>(() => {
    const picked = getInitialParam<Tab>('tab', 'overview');
    return TABS.some((x) => x.key === picked) ? picked : 'overview';
  });
  const [from, setFrom] = useState(() => getInitialParam('from', defaultFrom()));
  const [to, setTo] = useState(() => getInitialParam('to', toCalendarDateString(new Date())));
  useMergeQueryParams({ from, to });

  // Shared by Overview and Invoices, so flipping between them doesn't refetch.
  const revenue = useRevenueReport(from, to, tab !== 'rankings');

  function choose(next: Tab) {
    setTab(next);
    // Each tab's own params (page, vehicle) start fresh; the range carries over.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${new URLSearchParams({ tab: next, from, to })}`);
  }

  const tabs = (
    <div role="tablist" className="flex gap-2 mt-4 overflow-x-auto">
      {TABS.map(({ key, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => choose(key)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border whitespace-nowrap transition-colors ${
            tab === key
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white text-gray-600 border-blue-500/20 hover:bg-blue-50 hover:border-blue-500/35'
          }`}
        >
          <Icon size={16} strokeWidth={2} />
          {t(`salesReports.tabs.${key}`)}
        </button>
      ))}
    </div>
  );

  const marginBody = (render: (r: NonNullable<typeof revenue.report>) => ReactNode) => (
    <>
      {revenue.error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{revenue.error}</p>
      )}
      {revenue.loading && <p className="text-sm text-gray-500">{t('sales.reports.crunchingNumbers')}</p>}
      {!revenue.loading && !revenue.error && revenue.report && render(revenue.report)}
    </>
  );

  return (
    <PageFrame icon={ChartColumnIncreasing} title={t('nav.items.salesReports')} subtitle={t(`salesReports.subtitles.${tab}`)} below={tabs}>
      <DateRangePicker
        from={from}
        to={to}
        onChange={(f, tt) => {
          setFrom(f ?? ALL_TIME_FROM);
          setTo(tt ?? toCalendarDateString(new Date()));
        }}
      />

      {tab === 'overview' && (
        <>
          {marginBody((r) => (
            <MarginSummary report={r} />
          ))}
          <TopSellersPreview from={from} to={to} onSeeAll={() => choose('rankings')} />
        </>
      )}
      {tab === 'invoices' &&
        marginBody((r) => (
          <InvoiceMarginList report={r} />
        ))}
      {tab === 'rankings' && <SalesRankings key="rankings" from={from} to={to} />}
    </PageFrame>
  );
}
