'use client';

import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Navigation, BarChart3, Users, ArrowUpRight, Truck, Lock } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';


// Same "local component + data array" hub shape as inventory/page.tsx and
// sales/page.tsx — one card grid, not a dashboard of its own.
const DELIVERY_ITEM_DEFS = [
  { key: 'routes' as const, href: '/delivery/routes', icon: Navigation, gradient: 'from-blue-500 to-indigo-700', adminOnly: false },
  { key: 'monitoring' as const, href: '/delivery/monitoring', icon: BarChart3, gradient: 'from-cyan-500 to-blue-700', adminOnly: false },
  { key: 'drivers' as const, href: '/delivery/drivers', icon: Users, gradient: 'from-violet-500 to-purple-800', adminOnly: true },
];

export default function DeliveryHome() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, loading: userLoading } = useCurrentUser();
  const hasDelivery = useHasModule('DELIVERY_DMS');

  const DELIVERY_ITEMS = DELIVERY_ITEM_DEFS.filter((item) => !item.adminOnly || user?.role === 'ADMIN').map(
    (item) => ({
      ...item,
      title: t(`delivery.home.items.${item.key}.title`),
      description: t(`delivery.home.items.${item.key}.description`),
    }),
  );

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Truck size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('delivery.home.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('delivery.home.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
        {/* Wait for the module-status fetch before deciding what to show,
            so we don't briefly flash the locked state before hasDelivery
            resolves — same pattern as inventory/page.tsx. */}
        {!userLoading && !hasDelivery ? (
          <div className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-blue-500/25 bg-blue-600/5 py-12 sm:py-16 px-4 sm:px-6">
            <span className="rounded-lg bg-blue-600/10 border border-blue-600/20 p-3 mb-4">
              <Lock size={22} strokeWidth={2} className="text-blue-700/60" />
            </span>
            <p className={`${display.className} text-lg font-bold text-gray-600`}>{t('delivery.home.notEnabledTitle')}</p>
            <p className="text-sm text-gray-400 mt-1 max-w-sm">{t('delivery.home.notEnabledDesc')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {DELIVERY_ITEMS.map(({ title, description, href, icon: Icon, gradient }) => (
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
        )}
      </div>
    </main>
  );
}
