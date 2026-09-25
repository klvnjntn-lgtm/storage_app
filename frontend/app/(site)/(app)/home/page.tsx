'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { JetBrains_Mono } from 'next/font/google';
import { display } from '@/lib/fonts';
import { Receipt, ShoppingCart, ArrowUpRight, Lock, Inbox, Wrench, Calculator, Truck } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'] });

type LicenseStatus = {
  valid: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
  expiresAt: string | null;
  message?: string;
};

function getGreeting(t: (key: string) => string) {
  const h = new Date().getHours();
  if (h < 12) return t('home.greetingMorning');
  if (h < 18) return t('home.greetingAfternoon');
  return t('home.greetingEvening');
}

function getDateLine(language: string) {
  return new Date().toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

// Same "local component + data array" shape as accounting/page.tsx's
// ReportCard/SecondaryCard — one card definition instead of six near-
// identical inline JSX blocks (enabled gradient tile vs. disabled/locked
// dashed tile).
function ModuleCard({
  title,
  description,
  href,
  icon: Icon,
  gradient,
  enabled,
  notEnabledLabel,
  onNavigate,
}: {
  title: string;
  description: string;
  href: string;
  icon: typeof Inbox;
  gradient: string;
  enabled: boolean;
  notEnabledLabel: string;
  onNavigate: (href: string) => void;
}) {
  if (!enabled) {
    return (
      <div className="relative text-left rounded-xl p-6 bg-slate-50 border-2 border-dashed border-blue-300/50 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
        <div className="flex items-start justify-between">
          <span className="shrink-0 rounded-lg bg-blue-100 p-2.5">
            <Lock size={20} strokeWidth={2} className="text-blue-400" />
          </span>
        </div>
        <div>
          <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>{title}</p>
          <p className="text-sm text-gray-400 mt-0.5">{notEnabledLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => onNavigate(href)}
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
  );
}

function useModuleItems(t: (key: string) => string, enabledModules: string[]) {
  const has = (key: string) => enabledModules.includes(key);
  return [
    {
      title: t('home.inventory'),
      description: t('home.inventoryDesc'),
      href: '/inventory',
      icon: Inbox,
      gradient: 'from-green-400 to-green-700',
      enabled: has('WAREHOUSE_OPS'),
    },
    {
      title: t('home.sales'),
      description: t('home.salesDesc'),
      href: '/sales',
      icon: Receipt,
      gradient: 'from-red-500 to-pink-600',
      // NOTE: Sales, Purchasing, and Accounting all currently gate on
      // INVOICE_POS. Split each into its own flag once the backend
      // exposes separate ones.
      enabled: has('INVOICE_POS'),
    },
    {
      title: t('home.purchasing'),
      description: t('home.purchasingDesc'),
      href: '/purchasing',
      icon: ShoppingCart,
      gradient: 'from-amber-500 to-orange-700',
      enabled: has('INVOICE_POS'),
    },
    {
      title: t('home.accounting'),
      description: t('home.accountingDesc'),
      href: '/accounting',
      icon: Calculator,
      gradient: 'from-indigo-500 to-blue-800',
      enabled: has('INVOICE_POS'),
    },
    {
      title: t('home.workshop'),
      description: t('home.workshopDesc'),
      href: '/workshop',
      icon: Wrench,
      gradient: 'from-cyan-500 to-blue-700',
      enabled: has('WORKSHOP_RMS'),
    },
    {
      title: t('home.delivery'),
      description: t('home.deliveryDesc'),
      href: '/delivery',
      icon: Truck,
      gradient: 'from-violet-500 to-purple-800',
      enabled: has('DELIVERY_DMS'),
    },
  ];
}

export default function Home() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const [profile, setProfile] = useState<any>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [openSessions, setOpenSessions] = useState<number | null>(null);
  const [pendingOrders, setPendingOrders] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/auth/me');
        if (!res.ok) return;
        setProfile(await res.json());
      } catch (err) {
        console.error(err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/license/status');
        setLicense(await res.json());
      } catch (err) {
        console.error('License status fetch failed:', err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/organizations/modules');
        if (!res.ok) return;
        const json = await res.json();
        setEnabledModules(Array.isArray(json) ? json : []);
      } catch (err) {
        console.error('Modules fetch failed:', err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/sessions');
        if (!res.ok) return;
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.data ?? []);
        const open = list.filter((s: any) => s.status === 'OPEN' || s.status === 'IN_PROGRESS').length;
        setOpenSessions(open);
      } catch (err) {
        console.error('Sessions fetch failed:', err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/integrations/orders/pending');
        if (!res.ok) return;
        const json = await res.json();
        setPendingOrders(Array.isArray(json) ? json.length : 0);
      } catch (err) {
        console.error('Pending orders fetch failed:', err);
      }
    })();
  }, []);

  const MODULE_ITEMS = useModuleItems(t, enabledModules);
  const notEnabledLabel = t('home.notEnabled');

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
      <div className="max-w-5xl mx-auto w-full px-6 pt-10 pb-16">
        {/* GREETING */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded-md bg-blue-600 text-white text-[11px] font-bold shrink-0">
              {(profile?.organization?.name ?? 'Y')[0].toUpperCase()}
            </span>
            <p className="text-sm font-semibold text-gray-900">
              {profile?.organization?.name ?? t('home.yourOrganization')}
            </p>
          </div>
          <p className={`${mono.className} text-xs text-gray-400`}>{getDateLine(language)}</p>
        </div>
        <h2 className={`${display.className} mt-2 text-3xl font-bold tracking-tight`}>
          {getGreeting(t)}{profile?.email ? `, ${profile.email.split('@')[0]}` : ''}
        </h2>

        {/* STATUS STRIP */}
        <div className={`${mono.className} mt-6 flex flex-wrap items-stretch gap-0 border border-blue-500/20 rounded-xl overflow-hidden text-xs bg-white/60 backdrop-blur-sm`}>
          <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                license?.valid ? 'bg-emerald-500' : license ? 'bg-red-500' : 'bg-gray-300'
              }`}
            />
            <span className="text-gray-500 uppercase">{t('home.license')}</span>
            <span className="ml-auto font-medium">{license ? license.status : '—'}</span>
          </div>
          <div className="w-px bg-blue-500/15 hidden sm:block" />
          <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px] border-t sm:border-t-0 border-blue-500/15">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span className="text-gray-500 uppercase">{t('home.openSessions')}</span>
            <span className="ml-auto font-medium">{openSessions === null ? '—' : openSessions}</span>
          </div>
          <div className="w-px bg-blue-500/15 hidden sm:block" />
          <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px] border-t sm:border-t-0 border-blue-500/15">
            <span className={`w-1.5 h-1.5 rounded-full ${pendingOrders ? 'bg-cyan-500' : 'bg-gray-300'}`} />
            <span className="text-gray-500 uppercase">{t('home.pendingOrders')}</span>
            <span className="ml-auto font-medium">{pendingOrders === null ? '—' : pendingOrders}</span>
          </div>
        </div>

        {/* MODULES */}
        <div className="mt-10">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {t('home.modules')}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {MODULE_ITEMS.map((item) => (
              <ModuleCard key={item.href} {...item} notEnabledLabel={notEnabledLabel} onNavigate={router.push} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
