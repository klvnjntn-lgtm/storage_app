'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import { Receipt, ShoppingCart, ArrowUpRight, Lock, Inbox, Wrench, Calculator } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });
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

  const warehouseEnabled = enabledModules.includes('WAREHOUSE_OPS');
  // NOTE: Sales, Purchasing, and Accounting all currently gate on
  // INVOICE_POS. Split each into its own flag once the backend exposes
  // separate ones — Accounting in particular bundles Expenses/Payroll/
  // reporting under the same module key as invoicing, which won't always
  // be the right grouping.
  const salesEnabled = enabledModules.includes('INVOICE_POS');
  const purchasingEnabled = enabledModules.includes('INVOICE_POS');
  const accountingEnabled = enabledModules.includes('INVOICE_POS');
  const workshopEnabled = enabledModules.includes('WORKSHOP_RMS');

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
            {/* Inventory */}
            {warehouseEnabled ? (
              <button
                onClick={() => router.push('/inventory')}
                className="group relative text-left rounded-xl p-6 bg-gradient-to-br from-green-400 to-green-700 text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between"
              >
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-white/15 p-2.5 ring-1 ring-white/10">
                    <Inbox size={22} strokeWidth={2} />
                  </span>
                  <ArrowUpRight
                    size={18}
                    strokeWidth={2}
                    className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                  />
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight`}>{t('home.inventory')}</p>
                  <p className="text-sm text-white/85 mt-0.5">
                    {t('home.inventoryDesc')}
                  </p>
                </div>
              </button>
            ) : (
              <div className="relative text-left rounded-xl p-6 bg-slate-50 border-2 border-dashed border-blue-300/50 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-blue-100 p-2.5">
                    <Lock size={20} strokeWidth={2} className="text-blue-400" />
                  </span>
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>{t('home.inventory')}</p>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {t('home.notEnabled')}
                  </p>
                </div>
              </div>
            )}

            {/* Sales */}
            {salesEnabled ? (
              <button
                onClick={() => router.push('/sales')}
                className="group relative text-left rounded-xl p-6 bg-gradient-to-br from-red-500 to-pink-600 text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between"
              >
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-white/15 p-2.5 ring-1 ring-white/10">
                    <Receipt size={22} strokeWidth={2} />
                  </span>
                  <ArrowUpRight
                    size={18}
                    strokeWidth={2}
                    className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                  />
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight`}>{t('home.sales')}</p>
                  <p className="text-sm text-white/85 mt-0.5">
                    {t('home.salesDesc')}
                  </p>
                </div>
              </button>
            ) : (
              <div className="relative text-left rounded-xl p-6 bg-slate-50 border-2 border-dashed border-blue-300/50 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-blue-100 p-2.5">
                    <Lock size={20} strokeWidth={2} className="text-blue-400" />
                  </span>
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>{t('home.sales')}</p>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {t('home.notEnabled')}
                  </p>
                </div>
              </div>
            )}

            {/* Purchasing */}
            {purchasingEnabled ? (
              <button
                onClick={() => router.push('/purchasing')}
                className="group relative text-left rounded-xl p-6 bg-gradient-to-br from-amber-500 to-orange-700 text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between"
              >
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-white/15 p-2.5 ring-1 ring-white/10">
                    <ShoppingCart size={22} strokeWidth={2} />
                  </span>
                  <ArrowUpRight
                    size={18}
                    strokeWidth={2}
                    className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                  />
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight`}>{t('home.purchasing')}</p>
                  <p className="text-sm text-white/85 mt-0.5">
                    {t('home.purchasingDesc')}
                  </p>
                </div>
              </button>
            ) : (
              <div className="relative text-left rounded-xl p-6 bg-slate-50 border-2 border-dashed border-blue-300/50 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-blue-100 p-2.5">
                    <Lock size={20} strokeWidth={2} className="text-blue-400" />
                  </span>
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>{t('home.purchasing')}</p>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {t('home.notEnabled')}
                  </p>
                </div>
              </div>
            )}

            {/* Accounting — NEW. Gradient distinct from all four siblings
                (indigo/blue, vs. green/red-pink/amber-orange/cyan-blue) so
                the grid stays scannable at a glance rather than any two
                cards reading as "the same module" by color alone. */}
            {accountingEnabled ? (
              <button
                onClick={() => router.push('/accounting')}
                className="group relative text-left rounded-xl p-6 bg-gradient-to-br from-indigo-500 to-blue-800 text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between"
              >
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-white/15 p-2.5 ring-1 ring-white/10">
                    <Calculator size={22} strokeWidth={2} />
                  </span>
                  <ArrowUpRight
                    size={18}
                    strokeWidth={2}
                    className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                  />
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight`}>{t('home.accounting')}</p>
                  <p className="text-sm text-white/85 mt-0.5">
                    {t('home.accountingDesc')}
                  </p>
                </div>
              </button>
            ) : (
              <div className="relative text-left rounded-xl p-6 bg-slate-50 border-2 border-dashed border-blue-300/50 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-blue-100 p-2.5">
                    <Lock size={20} strokeWidth={2} className="text-blue-400" />
                  </span>
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>{t('home.accounting')}</p>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {t('home.notEnabled')}
                  </p>
                </div>
              </div>
            )}

            {/* Workshop */}
            {workshopEnabled ? (
              <button
                onClick={() => router.push('/workshop')}
                className="group relative text-left rounded-xl p-6 bg-gradient-to-br from-cyan-500 to-blue-700 text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between"
              >
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-white/15 p-2.5 ring-1 ring-white/10">
                    <Wrench size={22} strokeWidth={2} />
                  </span>
                  <ArrowUpRight
                    size={18}
                    strokeWidth={2}
                    className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                  />
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight`}>{t('home.workshop')}</p>
                  <p className="text-sm text-white/85 mt-0.5">
                    {t('home.workshopDesc')}
                  </p>
                </div>
              </button>
            ) : (
              <div className="relative text-left rounded-xl p-6 bg-slate-50 border-2 border-dashed border-blue-300/50 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-blue-100 p-2.5">
                    <Lock size={20} strokeWidth={2} className="text-blue-400" />
                  </span>
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>{t('home.workshop')}</p>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {t('home.notEnabled')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}