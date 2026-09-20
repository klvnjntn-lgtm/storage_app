'use client';

import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Landmark, TrendingUp, Receipt, Users, Rows3, Scale, Wallet, ShoppingCart, BookOpen, BookText, ArrowUpRight, ArrowLeft, Calculator } from 'lucide-react';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

// Only pages that actually exist today. Add a card here the same turn a
// new accounting page ships — an entry pointing at a route that doesn't
// exist yet is worse than not listing it, since it fails silently instead
// of explaining anything.
const ACCOUNTING_ITEMS = [
  {
    title: 'Chart of Accounts',
    description: 'Set up and manage the accounts everything posts to',
    href: '/accounting/setup',
    icon: Landmark,
    gradient: 'from-slate-600 to-slate-900',
  },
  {
    title: 'Journal',
    description: 'Every entry ever posted to the ledger',
    href: '/accounting/journal',
    icon: BookText,
    gradient: 'from-zinc-600 to-neutral-900',
  },
  {
    title: 'Expenses',
    description: 'Rent, electricity, and every other operating cost',
    href: '/accounting/expenses',
    icon: Receipt,
    gradient: 'from-amber-500 to-orange-700',
  },
  {
    title: 'Payroll',
    description: 'Employees, salary components, and payroll runs',
    href: '/accounting/payroll',
    icon: Users,
    gradient: 'from-cyan-500 to-blue-700',
  },
  {
    title: 'Profit & Loss',
    description: 'Revenue, cost of goods, and every posted expense',
    href: '/accounting/profit-loss',
    icon: TrendingUp,
    gradient: 'from-indigo-500 to-blue-800',
  },
  {
    title: 'Trial Balance',
    description: "Every account's lifetime balance, as of a date",
    href: '/accounting/trial-balance',
    icon: Rows3,
    gradient: 'from-teal-500 to-emerald-800',
  },
  {
    title: 'Balance Sheet',
    description: 'Assets, liabilities, and equity as of a date',
    href: '/accounting/balance-sheet',
    icon: Scale,
    gradient: 'from-violet-500 to-purple-800',
  },
  {
    title: 'AR Aging',
    description: 'Who owes you money, and how overdue it is',
    href: '/accounting/ar-aging',
    icon: Wallet,
    gradient: 'from-rose-500 to-pink-800',
  },
  {
    title: 'AP Aging',
    description: 'What you owe suppliers, and how overdue it is',
    href: '/accounting/ap-aging',
    icon: ShoppingCart,
    gradient: 'from-yellow-500 to-amber-800',
  },
  {
    title: 'Account Ledger',
    description: 'Transaction history for a single account or bank account',
    href: '/accounting/ledger',
    icon: BookOpen,
    gradient: 'from-sky-500 to-cyan-800',
  },
];

export default function AccountingHome() {
  const router = useRouter();

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
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to dashboard
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Calculator size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Accounting
              </h1>
              <p className="text-xs text-gray-500 truncate">Chart of accounts, expenses, payroll, and reports</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full px-6 pt-8 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ACCOUNTING_ITEMS.map(({ title, description, href, icon: Icon, gradient }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className={`group relative text-left rounded-xl p-6 bg-gradient-to-br ${gradient} text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between`}
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
                <p className={`${display.className} text-xl font-bold leading-tight`}>{title}</p>
                <p className="text-sm text-white/85 mt-0.5">{description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}