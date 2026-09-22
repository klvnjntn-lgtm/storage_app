'use client';

import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Landmark, TrendingUp, Receipt, Users, Rows3, Scale, Wallet, ShoppingCart, BookOpen, BookText, ArrowUpRight, Calculator, Banknote, CalendarClock, Building2 } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

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

// Everything else — read-mostly reports and one-time setup — as smaller
// cards instead of a wall of hero tiles, but still cards: same hover lift,
// same icon-chip language as the rest of the app, just lighter weight.
// Add an entry here the same turn a new accounting page ships; a route
// that isn't listed anywhere just fails silently instead of explaining
// anything.
function useReportItems(t: (key: string) => string) {
  return [
    { title: t('nav.items.profitLoss'), description: t('accounting.overview.profitLossDescription'), href: '/accounting/profit-loss', icon: TrendingUp },
    { title: t('nav.items.balanceSheet'), description: t('accounting.overview.balanceSheetDescription'), href: '/accounting/balance-sheet', icon: Scale },
    { title: t('nav.items.trialBalance'), description: t('accounting.overview.trialBalanceDescription'), href: '/accounting/trial-balance', icon: Rows3 },
    { title: t('nav.items.cashFlow'), description: t('accounting.overview.cashFlowDescription'), href: '/accounting/cash-flow', icon: Banknote },
    { title: t('nav.items.arAging'), description: t('accounting.overview.arAgingDescription'), href: '/accounting/ar-aging', icon: Wallet },
    { title: t('nav.items.apAging'), description: t('accounting.overview.apAgingDescription'), href: '/accounting/ap-aging', icon: ShoppingCart },
    { title: t('nav.items.accountLedger'), description: t('accounting.overview.ledgerDescription'), href: '/accounting/ledger', icon: BookOpen },
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

export default function AccountingHome() {
  const router = useRouter();
  const { t } = useLanguage();
  const PRIMARY_ITEMS = usePrimaryItems(t);
  const REPORT_ITEMS = useReportItems(t);
  const SETUP_ITEMS = useSetupItems(t);

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

        <div className="mb-6">
          <p className="text-[11px] font-semibold text-blue-700/60 tracking-wide uppercase px-1 mb-2">{t('accounting.overview.reportsSection')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {REPORT_ITEMS.map((item) => (
              <SecondaryCard key={item.href} {...item} onNavigate={router.push} />
            ))}
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
