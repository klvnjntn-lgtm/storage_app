'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Receipt, ShoppingCart, Inbox, Wrench, Calculator, Truck } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { HubAccent, HubCard, HubGrid, HubPage, HubSection, hubMono as mono } from '@/app/components/shared/Hub';

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

function useModuleItems(t: (key: string) => string, enabledModules: string[], isAdmin: boolean) {
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
      enabled: has('INVOICE_POS') && isAdmin, // the books are admin-only
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
  const { t } = useLanguage();
  const [profile, setProfile] = useState<any>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [openSessions, setOpenSessions] = useState<number | null>(null);
  const [pendingOrders, setPendingOrders] = useState<number | null>(null);
  // Round-trip time of the license status call, doubling as an API health
  // check. null = pending, 'offline' = request failed.
  const [latency, setLatency] = useState<number | 'offline' | null>(null);

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

  const MODULE_ITEMS = useModuleItems(t, enabledModules, profile?.role === 'ADMIN');
  const activeModules = MODULE_ITEMS.filter((m) => m.enabled).length;
  const notEnabledLabel = t('home.notEnabled');

  return (
    <HubPage
      path="~/home"
      title={
        <>
          {getGreeting(t)}
          {profile?.email && (
            <>
              , <HubAccent>{profile.email.split('@')[0]}</HubAccent>
            </>
          )}
        </>
      }
      subtitle={t('home.subtitle')}
    >
      {/* STATUS STRIP */}
      <HubSection index="01" label={t('home.system')}>
        <div
          className={`${mono.className} flex flex-wrap items-stretch gap-0 border border-blue-500/20 rounded-xl overflow-hidden text-xs bg-white/60 backdrop-blur-sm divide-y sm:divide-y-0 sm:divide-x divide-blue-500/15`}
        >
          <div className="flex items-center gap-2 px-4 py-3 flex-1 basis-full sm:basis-0 min-w-[160px]">
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
          <div className="flex items-center gap-2 px-4 py-3 flex-1 basis-full sm:basis-0 min-w-[160px]">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            <span className="text-gray-500 uppercase">{t('home.modules')}</span>
            <span className="ml-auto font-medium">
              {activeModules}/{MODULE_ITEMS.length}
            </span>
          </div>
          {showLicense && (
            <div className="flex items-center gap-2 px-4 py-3 flex-1 basis-full sm:basis-0 min-w-[160px]">
              <span className={`w-1.5 h-1.5 rounded-full ${license?.valid ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="text-gray-500 uppercase">{t('home.license')}</span>
              <span className="ml-auto font-medium">{license?.status}</span>
            </div>
          )}
          {hasWarehouse && (
            <>
              <div className="flex items-center gap-2 px-4 py-3 flex-1 basis-full sm:basis-0 min-w-[160px]">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-gray-500 uppercase">{t('home.openSessions')}</span>
                <span className="ml-auto font-medium">{openSessions === null ? '—' : openSessions}</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-3 flex-1 basis-full sm:basis-0 min-w-[160px]">
                <span className={`w-1.5 h-1.5 rounded-full ${pendingOrders ? 'bg-cyan-500' : 'bg-gray-300'}`} />
                <span className="text-gray-500 uppercase">{t('home.pendingOrders')}</span>
                <span className="ml-auto font-medium">{pendingOrders === null ? '—' : pendingOrders}</span>
              </div>
            </>
          )}
        </div>
      </HubSection>

      {/* MODULES */}
      <HubSection index="02" label={t('home.modules')}>
        <HubGrid>
          {MODULE_ITEMS.map(({ href, ...item }) => (
            <HubCard key={href} {...item} lockedLabel={notEnabledLabel} onClick={() => router.push(href)} />
          ))}
        </HubGrid>
      </HubSection>
    </HubPage>
  );
}
