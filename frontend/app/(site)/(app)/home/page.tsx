'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import { Receipt, ShoppingCart, ArrowUpRight, Lock, Inbox, Wrench } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'] });

type LicenseStatus = {
  valid: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
  expiresAt: string | null;
  message?: string;
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function getDateLine() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

export default function Home() {
  const router = useRouter();
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
        const open = Array.isArray(json)
          ? json.filter((s: any) => s.status === 'OPEN' || s.status === 'IN_PROGRESS').length
          : 0;
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
  // NOTE: Sales and Purchasing both currently gate on INVOICE_POS.
  // Split this into its own PURCHASING flag once the backend exposes one.
  const salesEnabled = enabledModules.includes('INVOICE_POS');
  const purchasingEnabled = enabledModules.includes('INVOICE_POS');
  const workshopEnabled = enabledModules.includes('WORKSHOP_RMS');

  return (
    <div className="max-w-5xl mx-auto w-full px-6 pt-10 pb-16">
{/* GREETING */}
<div className="flex items-center justify-between flex-wrap gap-2">
  <div className="flex items-center gap-2">
    <span className="flex items-center justify-center w-6 h-6 rounded-md bg-gray-900 text-white text-[11px] font-bold shrink-0">
      {(profile?.organization?.name ?? 'Y')[0].toUpperCase()}
    </span>
    <p className="text-sm font-semibold text-gray-900">
      {profile?.organization?.name ?? 'Your organization'}
    </p>
  </div>
  <p className={`${mono.className} text-xs text-gray-400`}>{getDateLine()}</p>
</div>
<h2 className={`${display.className} mt-2 text-3xl font-bold tracking-tight`}>
  {getGreeting()}{profile?.email ? `, ${profile.email.split('@')[0]}` : ''}
</h2>
      {/* STATUS STRIP */}
      <div className={`${mono.className} mt-6 flex flex-wrap items-stretch gap-0 border-2 border-gray-300 rounded-md overflow-hidden text-xs`}>
        <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px]">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              license?.valid ? 'bg-emerald-500' : license ? 'bg-red-500' : 'bg-gray-300'
            }`}
          />
          <span className="text-gray-500">LICENSE</span>
          <span className="ml-auto font-medium">{license ? license.status : '—'}</span>
        </div>
        <div className="w-px bg-gray-300 hidden sm:block" />
        <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px] border-t sm:border-t-0 border-gray-300">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          <span className="text-gray-500">OPEN SESSIONS</span>
          <span className="ml-auto font-medium">{openSessions === null ? '—' : openSessions}</span>
        </div>
        <div className="w-px bg-gray-300 hidden sm:block" />
        <div className="flex items-center gap-2 px-4 py-3 flex-1 min-w-[160px] border-t sm:border-t-0 border-gray-300">
          <span className={`w-1.5 h-1.5 rounded-full ${pendingOrders ? 'bg-violet-500' : 'bg-gray-300'}`} />
          <span className="text-gray-500">PENDING ORDERS</span>
          <span className="ml-auto font-medium">{pendingOrders === null ? '—' : pendingOrders}</span>
        </div>
      </div>

      {/* MODULES */}
      <div className="mt-10">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Modules
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Inventory */}
          {warehouseEnabled ? (
            <button
              onClick={() => router.push('/inventory')}
              className="group relative text-left rounded-lg p-6 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between"
            >
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-white/15 p-2.5">
                  <Inbox size={22} strokeWidth={2} />
                </span>
                <ArrowUpRight
                  size={18}
                  strokeWidth={2}
                  className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                />
              </div>
              <div>
                <p className={`${display.className} text-xl font-bold leading-tight`}>Inventory</p>
                <p className="text-sm text-white/85 mt-0.5">
                  Scan, receive, move, and fulfill stock
                </p>
              </div>
            </button>
          ) : (
            <div className="relative text-left rounded-lg p-6 bg-gray-50 border-2 border-dashed border-gray-300 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-gray-200 p-2.5">
                  <Lock size={20} strokeWidth={2} className="text-gray-400" />
                </span>
              </div>
              <div>
                <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>Inventory</p>
                <p className="text-sm text-gray-400 mt-0.5">
                  Not enabled — ask your admin to turn this module on
                </p>
              </div>
            </div>
          )}

          {/* Sales */}
          {salesEnabled ? (
            <button
              onClick={() => router.push('/sales')}
              className="group relative text-left rounded-lg p-6 bg-gradient-to-br from-violet-500 to-purple-700 text-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between"
            >
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-white/15 p-2.5">
                  <Receipt size={22} strokeWidth={2} />
                </span>
                <ArrowUpRight
                  size={18}
                  strokeWidth={2}
                  className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                />
              </div>
              <div>
                <p className={`${display.className} text-xl font-bold leading-tight`}>Sales</p>
                <p className="text-sm text-white/85 mt-0.5">
                  Quotations, orders, invoices, and delivery
                </p>
              </div>
            </button>
          ) : (
            <div className="relative text-left rounded-lg p-6 bg-gray-50 border-2 border-dashed border-gray-300 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-gray-200 p-2.5">
                  <Lock size={20} strokeWidth={2} className="text-gray-400" />
                </span>
              </div>
              <div>
                <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>Sales</p>
                <p className="text-sm text-gray-400 mt-0.5">
                  Not enabled — ask your admin to turn this module on
                </p>
              </div>
            </div>
          )}

          {/* Purchasing */}
          {purchasingEnabled ? (
            <button
              onClick={() => router.push('/purchasing')}
              className="group relative text-left rounded-lg p-6 bg-gradient-to-br from-amber-500 to-orange-700 text-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between"
            >
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-white/15 p-2.5">
                  <ShoppingCart size={22} strokeWidth={2} />
                </span>
                <ArrowUpRight
                  size={18}
                  strokeWidth={2}
                  className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                />
              </div>
              <div>
                <p className={`${display.className} text-xl font-bold leading-tight`}>Purchasing</p>
                <p className="text-sm text-white/85 mt-0.5">
                  Purchase orders and vendor bills
                </p>
              </div>
            </button>
          ) : (
            <div className="relative text-left rounded-lg p-6 bg-gray-50 border-2 border-dashed border-gray-300 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-gray-200 p-2.5">
                  <Lock size={20} strokeWidth={2} className="text-gray-400" />
                </span>
              </div>
              <div>
                <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>Purchasing</p>
                <p className="text-sm text-gray-400 mt-0.5">
                  Not enabled — ask your admin to turn this module on
                </p>
              </div>
            </div>
          )}

          {/* Workshop */}
          {workshopEnabled ? (
            <button
              onClick={() => router.push('/workshop')}
              className="group relative text-left rounded-lg p-6 bg-gradient-to-br from-sky-500 to-blue-700 text-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between"
            >
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-white/15 p-2.5">
                  <Wrench size={22} strokeWidth={2} />
                </span>
                <ArrowUpRight
                  size={18}
                  strokeWidth={2}
                  className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                />
              </div>
              <div>
                <p className={`${display.className} text-xl font-bold leading-tight`}>Workshop</p>
                <p className="text-sm text-white/85 mt-0.5">
                  Vehicles, service jobs, and reminders
                </p>
              </div>
            </button>
          ) : (
            <div className="relative text-left rounded-lg p-6 bg-gray-50 border-2 border-dashed border-gray-300 text-gray-400 min-h-[150px] flex flex-col justify-between cursor-not-allowed">
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-gray-200 p-2.5">
                  <Lock size={20} strokeWidth={2} className="text-gray-400" />
                </span>
              </div>
              <div>
                <p className={`${display.className} text-xl font-bold leading-tight text-gray-500`}>Workshop</p>
                <p className="text-sm text-gray-400 mt-0.5">
                  Not enabled — ask your admin to turn this module on
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}