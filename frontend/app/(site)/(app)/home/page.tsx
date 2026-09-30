'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { JetBrains_Mono } from 'next/font/google';
import { display } from '@/lib/fonts';
import { Receipt, ShoppingCart, ArrowUpRight, Lock, Inbox, Wrench, Calculator, Truck } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { GridBackdrop } from '@/app/(site)/_landing/primitives';
import { useLanguage } from '@/app/context/LanguageContext';

const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'] });

type LicenseStatus = {
  edition: 'desktop' | 'cloud';
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

function getDateLine(now: Date, language: string) {
  return now.toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Live clock. Starts null so the server render and first paint match.
function useNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the clock once after mount
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Numbered mono section tag, the app-palette twin of the landing page's
// Kicker (that one is tuned for the landing's dark backdrop).
function SectionTag({ index, label }: { index: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span
        className={`${mono.className} text-[10px] tracking-[0.2em] text-blue-700 px-2 py-1 rounded-full border border-blue-200 bg-blue-50`}
      >
        {index}
      </span>
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{label}</h2>
    </div>
  );
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
  // Round-trip time of the license status call, doubling as an API health
  // check. null = pending, 'offline' = request failed.
  const [latency, setLatency] = useState<number | 'offline' | null>(null);
  const now = useNow();

  // Sessions and pending orders are warehouse concepts; the license only
  // exists on the desktop edition.
  const hasWarehouse = enabledModules.includes('WAREHOUSE_OPS');
  const showLicense = license?.edition === 'desktop';

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
        const started = performance.now();
        const res = await apiFetch('/license/status');
        setLatency(res.ok ? Math.round(performance.now() - started) : 'offline');
        setLicense(await res.json());
      } catch (err) {
        console.error('License status fetch failed:', err);
        setLatency('offline');
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
    if (!hasWarehouse) return;
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
  }, [hasWarehouse]);

  const MODULE_ITEMS = useModuleItems(t, enabledModules);
  const activeModules = MODULE_ITEMS.filter((m) => m.enabled).length;
  const notEnabledLabel = t('home.notEnabled');

  return (
    <main className="relative min-h-screen overflow-hidden text-black" style={{ backgroundColor: 'var(--page-bg)' }}>
      {/* Blueprint grid + glow, borrowed from the landing hero */}
      <GridBackdrop size={44} opacity={0.07} mask="radial-gradient(ellipse at 70% 0%, black 10%, transparent 70%)" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 right-[-10%] h-[26rem] w-[26rem] rounded-full bg-blue-500/15 blur-[120px]"
      />

      <div className="relative max-w-5xl mx-auto w-full px-4 sm:px-6 pt-10 pb-16">
        {/* GREETING */}
        <header className="animate-hero-in motion-reduce:animate-none">
          <div className={`${mono.className} flex items-center justify-between flex-wrap gap-2 text-xs`}>
            <span className="uppercase tracking-[0.2em] text-gray-500">~/home</span>
            <span className="flex items-center gap-2 text-gray-500 tabular-nums">
              {now && (
                <>
                  {getDateLine(now, language)}
                  <span aria-hidden="true" className="text-gray-300">
                    /
                  </span>
                  <time dateTime={now.toISOString()} className="text-gray-900">
                    {now.toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-GB', { hour12: false })}
                  </time>
                </>
              )}
            </span>
          </div>
          <h1 className={`${display.className} mt-4 text-4xl sm:text-5xl font-bold tracking-[-0.035em] leading-[1.02]`}>
            {getGreeting(t)}
            {profile?.email && (
              <>
                ,{' '}
                <span className="bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                  {profile.email.split('@')[0]}
                </span>
              </>
            )}
          </h1>
          <p className="mt-3 text-sm text-gray-500">{t('home.subtitle')}</p>
        </header>

        {/* STATUS STRIP */}
        <section className="mt-10">
          <SectionTag index="01" label={t('home.system')} />
          <div
            className={`${mono.className} flex flex-wrap items-stretch gap-0 border border-blue-500/20 rounded-xl overflow-hidden text-xs bg-white/60 backdrop-blur-sm divide-y sm:divide-y-0 sm:divide-x divide-blue-500/15`}
          >
            <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px]">
              <span className="relative flex w-1.5 h-1.5">
                {typeof latency === 'number' && (
                  <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-75 animate-ping motion-reduce:animate-none" />
                )}
                <span
                  className={`relative w-1.5 h-1.5 rounded-full ${
                    latency === 'offline' ? 'bg-red-500' : latency === null ? 'bg-gray-300' : 'bg-emerald-500'
                  }`}
                />
              </span>
              <span className="text-gray-500 uppercase">{t('home.system')}</span>
              <span className="ml-auto font-medium">
                {latency === null
                  ? '—'
                  : latency === 'offline'
                    ? t('home.offline')
                    : `${t('home.online')} · ${latency}ms`}
              </span>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px]">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              <span className="text-gray-500 uppercase">{t('home.modules')}</span>
              <span className="ml-auto font-medium">
                {activeModules}/{MODULE_ITEMS.length}
              </span>
            </div>
            {showLicense && (
              <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px]">
                <span className={`w-1.5 h-1.5 rounded-full ${license?.valid ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-gray-500 uppercase">{t('home.license')}</span>
                <span className="ml-auto font-medium">{license?.status}</span>
              </div>
            )}
            {hasWarehouse && (
              <>
                <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span className="text-gray-500 uppercase">{t('home.openSessions')}</span>
                  <span className="ml-auto font-medium">{openSessions === null ? '—' : openSessions}</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${pendingOrders ? 'bg-cyan-500' : 'bg-gray-300'}`} />
                  <span className="text-gray-500 uppercase">{t('home.pendingOrders')}</span>
                  <span className="ml-auto font-medium">{pendingOrders === null ? '—' : pendingOrders}</span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* MODULES */}
        <section className="mt-10">
          <SectionTag index="02" label={t('home.modules')} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {MODULE_ITEMS.map((item) => (
              <ModuleCard key={item.href} {...item} notEnabledLabel={notEnabledLabel} onNavigate={router.push} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
