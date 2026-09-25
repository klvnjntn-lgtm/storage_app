'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Landmark, TrendingUp, Receipt, Users, Rows3, Scale, Wallet, ShoppingCart, BookOpen, BookText, ArrowUpRight, Calculator, Banknote, CalendarClock, Building2, BarChart3, PackageSearch } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { formatIDRCompact } from '@/lib/format';
import TopCustomersBarChart from '@/app/components/reports/TopCustomersBarChart';
import TopItemsPieChart from '@/app/components/reports/TopItemsPieChart';
import MiniStackedBar from '@/app/components/reports/MiniStackedBar';
import MiniDeltaBars from '@/app/components/reports/MiniDeltaBars';
import { CHART_COLORS } from '@/app/components/reports/types';
import type { TopReport } from '@/app/components/reports/types';

const PREVIEW_LIMIT = 5;


// Aging buckets are ordinal (current -> most overdue), not categorical
// identities, so the first four steps are the dataviz skill's official
// sequential-blue ramp (steps 250/350/450/550 — lightness-monotonic by
// construction, so no categorical-adjacency check applies) with the
// worst bucket picked out in the fixed "critical" status red as a single
// emphasis color, not a 5th ramp step.
const AGING_COLORS = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#d03b3b'];

// A distinct accent per report — the "different style cards" ask. Each
// value is a complete, literal Tailwind class (never interpolated) so
// the JIT compiler can find it by scanning this file's source text.
const ACCENTS: Record<string, { iconBg: string; iconBorder: string; iconText: string; hex: string }> = {
  '/accounting/sales-insights': { iconBg: 'bg-blue-50', iconBorder: 'border-blue-200', iconText: 'text-blue-700', hex: '#2a78d6' },
  '/accounting/profit-loss': { iconBg: 'bg-emerald-50', iconBorder: 'border-emerald-200', iconText: 'text-emerald-700', hex: '#0ca30c' },
  '/accounting/cash-flow': { iconBg: 'bg-sky-50', iconBorder: 'border-sky-200', iconText: 'text-sky-700', hex: '#0ea5e9' },
  '/accounting/balance-sheet': { iconBg: 'bg-indigo-50', iconBorder: 'border-indigo-200', iconText: 'text-indigo-700', hex: '#4a3aa7' },
  '/accounting/ar-aging': { iconBg: 'bg-amber-50', iconBorder: 'border-amber-200', iconText: 'text-amber-700', hex: '#eda100' },
  '/accounting/ap-aging': { iconBg: 'bg-purple-50', iconBorder: 'border-purple-200', iconText: 'text-purple-700', hex: '#9333ea' },
  '/accounting/trial-balance': { iconBg: 'bg-gray-100', iconBorder: 'border-gray-200', iconText: 'text-gray-500', hex: '#898781' },
  '/accounting/ledger': { iconBg: 'bg-gray-100', iconBorder: 'border-gray-200', iconText: 'text-gray-500', hex: '#898781' },
};

// The handful of things people actually come here to *do* — big cards,
// same treatment as every other section's hub page.
function usePrimaryItems(t: (key: string) => string) {
  return [
    {
      title: t('nav.items.journal'),
      description: t('accounting.overview.journalDescription'),
      href: '/accounting/journal',
      icon: BookText,
      gradient: 'from-gray-600 to-gray-900',
    },
    {
      title: t('nav.items.expenses'),
      description: t('accounting.overview.expensesDescription'),
      href: '/accounting/expenses',
      icon: Receipt,
      gradient: 'from-amber-500 to-orange-700',
    },
    {
      title: t('nav.items.payroll'),
      description: t('accounting.overview.payrollDescription'),
      href: '/accounting/payroll',
      icon: Users,
      gradient: 'from-cyan-500 to-blue-700',
    },
    {
      title: t('nav.items.fixedAssets'),
      description: t('accounting.overview.fixedAssetsDescription'),
      href: '/accounting/fixed-assets',
      icon: Building2,
      gradient: 'from-fuchsia-600 to-purple-900',
    },
  ];
}

function useSetupItems(t: (key: string) => string) {
  return [
    { title: t('nav.items.chartOfAccounts'), description: t('accounting.overview.chartOfAccountsDescription'), href: '/accounting/setup', icon: Landmark },
    { title: t('nav.items.fiscalPeriods'), description: t('accounting.overview.fiscalPeriodsDescription'), href: '/accounting/fiscal-periods', icon: CalendarClock },
  ];
}

function SecondaryCard({
  title,
  description,
  href,
  icon: Icon,
  onNavigate,
}: {
  title: string;
  description: string;
  href: string;
  icon: typeof Landmark;
  onNavigate: (href: string) => void;
}) {
  return (
    <button
      onClick={() => onNavigate(href)}
      className="group relative text-left rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-blue-500/30 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 flex items-start gap-3"
    >
      <span className="shrink-0 rounded-lg bg-blue-600/10 border border-blue-600/15 p-2.5">
        <Icon size={18} strokeWidth={2} className="text-blue-700" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <ArrowUpRight
        size={14}
        strokeWidth={2}
        className="text-gray-300 shrink-0 mt-0.5 group-hover:text-blue-600/60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
      />
    </button>
  );
}

type StatItem = { label: string; value: string; tone?: 'positive' | 'negative' };

// A dominant KPI readout — label + a big bold number, the headline of
// the card rather than a footnote under the description.
function StatTiles({ items }: { items: StatItem[] | null }) {
  if (items === null) {
    return <span className="inline-block h-9 w-32 rounded bg-gray-100 animate-pulse" />;
  }
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{item.label}</p>
          <p
            className={`text-2xl sm:text-3xl font-bold tracking-tight ${
              item.tone === 'positive' ? 'text-green-700' : item.tone === 'negative' ? 'text-red-700' : 'text-gray-900'
            }`}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// The report card shell — accent-colored icon chip + a thin accent bar
// along the top edge, a dominant stat/graphic body, and an explicit
// "View all" action. `span` picks how many of the grid's 4 columns it
// takes, which is what makes the grid asymmetric rather than a 1:1 wall.
function ReportCard({
  title,
  description,
  href,
  icon: Icon,
  span,
  children,
  viewAllLabel,
  onNavigate,
}: {
  title: string;
  description: string;
  href: string;
  icon: typeof Landmark;
  span: 'full' | 'wide' | 'normal';
  children?: React.ReactNode;
  viewAllLabel: string;
  onNavigate: (href: string) => void;
}) {
  const accent = ACCENTS[href] ?? ACCENTS['/accounting/ledger'];
  const spanClass = span === 'full' ? 'sm:col-span-2 lg:col-span-4' : span === 'wide' ? 'sm:col-span-2 lg:col-span-2' : '';

  return (
    <div className={`relative rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col ${spanClass}`}>
      <div className="h-1 w-full" style={{ backgroundColor: accent.hex }} />
      <div className="p-5 flex flex-col flex-1">
        <div className="flex items-start gap-3 mb-4">
          <span className={`shrink-0 rounded-lg ${accent.iconBg} border ${accent.iconBorder} p-3`}>
            <Icon size={20} strokeWidth={2} className={accent.iconText} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-gray-900 truncate">{title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{description}</p>
          </div>
        </div>

        {children && <div className="flex-1 mb-4">{children}</div>}
        {!children && <div className="flex-1" />}

        <button
          onClick={() => onNavigate(href)}
          className="group self-start -ml-2.5 flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-800 transition-colors"
        >
          {viewAllLabel}
          <ArrowUpRight size={12} strokeWidth={2} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </button>
      </div>
    </div>
  );
}

type ProfitLossSnapshot = { totalRevenue: number; cogs: number; totalOperatingExpenses: number; netProfit: number };
type BalanceSheetSnapshot = { totalAssets: number; totalLiabilities: number; totalEquity: number };
type CashFlowSnapshot = {
  netChange: number;
  operating: { net: number };
  investing: { net: number };
  financing: { net: number };
};
type AgingSnapshot = { totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90plus: number; total: number } };

export default function AccountingHome() {
  const router = useRouter();
  const { t } = useLanguage();
  const PRIMARY_ITEMS = usePrimaryItems(t);
  const SETUP_ITEMS = useSetupItems(t);

  // Current-month data for the Sales Insights card's inline charts — not a
  // filterable view of its own; the full page (date range + vehicle
  // filter) lives at /accounting/sales-insights behind this card's "View
  // all" button.
  const [preview, setPreview] = useState<TopReport | null>(null);
  useEffect(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    const params = new URLSearchParams({
      from: toCalendarDateString(monthStart),
      to: toCalendarDateString(new Date()),
      limit: String(PREVIEW_LIMIT),
    });
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/invoices/reports/top?${params}`);
        if (res.ok && !cancelled) setPreview(await res.json());
      } catch {
        // preview is best-effort — leave it unset
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Full snapshot per report — each card derives both its KPI tile(s) and
  // its mini graphic from the same fetch, so this keeps the whole
  // response rather than pre-flattening to a single display string. Each
  // fetch is independent (own try/catch) so one unavailable report
  // doesn't blank out the others.
  const [profitLoss, setProfitLoss] = useState<ProfitLossSnapshot | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetSnapshot | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowSnapshot | null>(null);
  const [arAging, setArAging] = useState<AgingSnapshot | null>(null);
  const [apAging, setApAging] = useState<AgingSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const today = toCalendarDateString(new Date());
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartStr = toCalendarDateString(monthStart);
    const monthParams = new URLSearchParams({ from: monthStartStr, to: today });

    (async () => {
      try {
        const res = await apiFetch(`/accounting/reports/profit-loss?${monthParams}`);
        if (res.ok && !cancelled) setProfitLoss(await res.json());
      } catch {
        // best-effort
      }
    })();
    (async () => {
      try {
        const res = await apiFetch(`/accounting/reports/balance-sheet?asOf=${today}`);
        if (res.ok && !cancelled) setBalanceSheet(await res.json());
      } catch {
        // best-effort
      }
    })();
    (async () => {
      try {
        const res = await apiFetch(`/accounting/reports/cash-flow?${monthParams}`);
        if (res.ok && !cancelled) setCashFlow(await res.json());
      } catch {
        // best-effort
      }
    })();
    (async () => {
      try {
        const res = await apiFetch(`/accounting/reports/ar-aging?asOf=${today}`);
        if (res.ok && !cancelled) setArAging(await res.json());
      } catch {
        // best-effort
      }
    })();
    (async () => {
      try {
        const res = await apiFetch(`/accounting/reports/ap-aging?asOf=${today}`);
        if (res.ok && !cancelled) setApAging(await res.json());
      } catch {
        // best-effort
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const viewAllLabel = t('accounting.overview.viewAll');

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.07) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Calculator size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('nav.groups.accounting')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.overview.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          {PRIMARY_ITEMS.map(({ title, description, href, icon: Icon, gradient }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className={`group relative text-left rounded-xl p-5 sm:p-6 bg-gradient-to-br ${gradient} text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[130px] sm:min-h-[150px] flex flex-col justify-between`}
            >
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-white/15 p-2.5 ring-1 ring-white/10">
                  <Icon size={22} strokeWidth={2} />
                </span>
                <ArrowUpRight
                  size={18}
                  strokeWidth={2}
                  className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                />
              </div>
              <div>
                <p className={`${display.className} text-lg sm:text-xl font-bold leading-tight`}>{title}</p>
                <p className="text-sm text-white/85 mt-0.5">{description}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="mb-8">
          <p className="text-[11px] font-semibold text-blue-700/60 tracking-wide uppercase px-1 mb-2">{t('accounting.overview.reportsSection')}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Hero — full width, the one card built entirely around live graphics */}
            <ReportCard
              title={t('nav.items.salesInsights')}
              description={t('accounting.overview.salesInsightsDescription')}
              href="/accounting/sales-insights"
              icon={BarChart3}
              span="full"
              viewAllLabel={viewAllLabel}
              onNavigate={router.push}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Users size={12} strokeWidth={2} className="text-blue-700" />
                    <p className="text-xs font-semibold text-gray-700">{t('accounting.salesInsights.topCustomers')}</p>
                  </div>
                  {preview === null ? (
                    <span className="inline-block h-40 w-full rounded bg-gray-100 animate-pulse" />
                  ) : preview.topCustomers.length > 0 ? (
                    <TopCustomersBarChart rows={preview.topCustomers} />
                  ) : (
                    <p className="text-xs text-gray-400 py-4">{t('accounting.salesInsights.noData')}</p>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <PackageSearch size={12} strokeWidth={2} className="text-blue-700" />
                    <p className="text-xs font-semibold text-gray-700">{t('accounting.salesInsights.topItems')}</p>
                  </div>
                  {preview === null ? (
                    <span className="inline-block h-40 w-full rounded bg-gray-100 animate-pulse" />
                  ) : preview.topProducts.length > 0 ? (
                    <TopItemsPieChart rows={preview.topProducts} otherLabel={t('accounting.salesInsights.other')} />
                  ) : (
                    <p className="text-xs text-gray-400 py-4">{t('accounting.salesInsights.noData')}</p>
                  )}
                </div>
              </div>
            </ReportCard>

            {/* Profit & Loss — wide, KPI tiles + a revenue composition bar */}
            <ReportCard
              title={t('nav.items.profitLoss')}
              description={t('accounting.overview.profitLossDescription')}
              href="/accounting/profit-loss"
              icon={TrendingUp}
              span="wide"
              viewAllLabel={viewAllLabel}
              onNavigate={router.push}
            >
              <div className="flex flex-col gap-4">
                <StatTiles
                  items={
                    profitLoss === null
                      ? null
                      : [
                          { label: t('accounting.overview.statLabelRevenue'), value: formatIDRCompact(profitLoss.totalRevenue) },
                          {
                            label: t('accounting.overview.statLabelProfit'),
                            value: formatIDRCompact(profitLoss.netProfit),
                            tone: profitLoss.netProfit >= 0 ? 'positive' : 'negative',
                          },
                        ]
                  }
                />
                {profitLoss && profitLoss.netProfit >= 0 && (
                  <MiniStackedBar
                    segments={[
                      { label: t('accounting.overview.statLabelCogs'), value: profitLoss.cogs, color: CHART_COLORS[1] },
                      { label: t('accounting.overview.statLabelOpex'), value: profitLoss.totalOperatingExpenses, color: CHART_COLORS[2] },
                      { label: t('accounting.overview.statLabelProfit'), value: profitLoss.netProfit, color: CHART_COLORS[0] },
                    ]}
                  />
                )}
              </div>
            </ReportCard>

            {/* Cash Flow — wide, net-cash KPI + operating/investing/financing deltas */}
            <ReportCard
              title={t('nav.items.cashFlow')}
              description={t('accounting.overview.cashFlowDescription')}
              href="/accounting/cash-flow"
              icon={Banknote}
              span="wide"
              viewAllLabel={viewAllLabel}
              onNavigate={router.push}
            >
              <div className="flex flex-col gap-2">
                <StatTiles
                  items={
                    cashFlow === null
                      ? null
                      : [
                          {
                            label: t('accounting.overview.statLabelNetCash'),
                            value: `${cashFlow.netChange >= 0 ? '+' : ''}${formatIDRCompact(cashFlow.netChange)}`,
                            tone: cashFlow.netChange >= 0 ? 'positive' : 'negative',
                          },
                        ]
                  }
                />
                {cashFlow && (
                  <MiniDeltaBars
                    items={[
                      { label: t('accounting.overview.statLabelOperating'), value: cashFlow.operating.net },
                      { label: t('accounting.overview.statLabelInvesting'), value: cashFlow.investing.net },
                      { label: t('accounting.overview.statLabelFinancing'), value: cashFlow.financing.net },
                    ]}
                  />
                )}
              </div>
            </ReportCard>

            {/* Balance Sheet — normal, total assets + liabilities/equity split */}
            <ReportCard
              title={t('nav.items.balanceSheet')}
              description={t('accounting.overview.balanceSheetDescription')}
              href="/accounting/balance-sheet"
              icon={Scale}
              span="normal"
              viewAllLabel={viewAllLabel}
              onNavigate={router.push}
            >
              <div className="flex flex-col gap-4">
                <StatTiles
                  items={
                    balanceSheet === null
                      ? null
                      : [{ label: t('accounting.overview.statLabelTotalAssets'), value: formatIDRCompact(balanceSheet.totalAssets) }]
                  }
                />
                {balanceSheet && balanceSheet.totalLiabilities >= 0 && balanceSheet.totalEquity >= 0 && (
                  <MiniStackedBar
                    segments={[
                      { label: t('accounting.overview.statLabelLiabilities'), value: balanceSheet.totalLiabilities, color: CHART_COLORS[1] },
                      { label: t('accounting.overview.statLabelEquity'), value: balanceSheet.totalEquity, color: CHART_COLORS[0] },
                    ]}
                  />
                )}
              </div>
            </ReportCard>

            {/* AR Aging — normal, outstanding KPI + severity-ramp aging bar */}
            <ReportCard
              title={t('nav.items.arAging')}
              description={t('accounting.overview.arAgingDescription')}
              href="/accounting/ar-aging"
              icon={Wallet}
              span="normal"
              viewAllLabel={viewAllLabel}
              onNavigate={router.push}
            >
              <div className="flex flex-col gap-4">
                <StatTiles
                  items={
                    arAging === null
                      ? null
                      : [{ label: t('accounting.overview.statLabelOutstanding'), value: formatIDRCompact(arAging.totals.total) }]
                  }
                />
                {arAging && (
                  <MiniStackedBar
                    segments={[
                      { label: t('accounting.overview.agingCurrent'), value: arAging.totals.current, color: AGING_COLORS[0] },
                      { label: t('accounting.overview.aging30'), value: arAging.totals.d1_30, color: AGING_COLORS[1] },
                      { label: t('accounting.overview.aging60'), value: arAging.totals.d31_60, color: AGING_COLORS[2] },
                      { label: t('accounting.overview.aging90'), value: arAging.totals.d61_90, color: AGING_COLORS[3] },
                      { label: t('accounting.overview.aging90plus'), value: arAging.totals.d90plus, color: AGING_COLORS[4] },
                    ]}
                  />
                )}
              </div>
            </ReportCard>

            {/* AP Aging — normal, payable KPI + same severity-ramp language */}
            <ReportCard
              title={t('nav.items.apAging')}
              description={t('accounting.overview.apAgingDescription')}
              href="/accounting/ap-aging"
              icon={ShoppingCart}
              span="normal"
              viewAllLabel={viewAllLabel}
              onNavigate={router.push}
            >
              <div className="flex flex-col gap-4">
                <StatTiles
                  items={
                    apAging === null
                      ? null
                      : [{ label: t('accounting.overview.statLabelPayable'), value: formatIDRCompact(apAging.totals.total) }]
                  }
                />
                {apAging && (
                  <MiniStackedBar
                    segments={[
                      { label: t('accounting.overview.agingCurrent'), value: apAging.totals.current, color: AGING_COLORS[0] },
                      { label: t('accounting.overview.aging30'), value: apAging.totals.d1_30, color: AGING_COLORS[1] },
                      { label: t('accounting.overview.aging60'), value: apAging.totals.d31_60, color: AGING_COLORS[2] },
                      { label: t('accounting.overview.aging90'), value: apAging.totals.d61_90, color: AGING_COLORS[3] },
                      { label: t('accounting.overview.aging90plus'), value: apAging.totals.d90plus, color: AGING_COLORS[4] },
                    ]}
                  />
                )}
              </div>
            </ReportCard>

            {/* Trial Balance / Ledger — plain, no live snapshot to show */}
            <ReportCard
              title={t('nav.items.trialBalance')}
              description={t('accounting.overview.trialBalanceDescription')}
              href="/accounting/trial-balance"
              icon={Rows3}
              span="normal"
              viewAllLabel={viewAllLabel}
              onNavigate={router.push}
            />
            <ReportCard
              title={t('nav.items.accountLedger')}
              description={t('accounting.overview.ledgerDescription')}
              href="/accounting/ledger"
              icon={BookOpen}
              span="normal"
              viewAllLabel={viewAllLabel}
              onNavigate={router.push}
            />
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-blue-700/60 tracking-wide uppercase px-1 mb-2">{t('accounting.overview.setupSection')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SETUP_ITEMS.map((item) => (
              <SecondaryCard key={item.href} {...item} onNavigate={router.push} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
