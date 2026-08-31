'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Search,
  Inbox,
  ArrowLeftRight,
  PackageCheck,
  Undo2,
  LogOut,
  X,
  User,
  ShieldCheck,
  ShieldAlert,
  Boxes,
  PlugZap,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type Mode = 'RECEIVE' | 'RETURNS' | 'MOVE' | 'FULFILLMENT';
type FulfillmentMode = 'PICK_PACK_SHIP' | 'PICK_SHIP';

type SearchResult = {
  products: any[];
  stocks: any[];
  locations: any[];
  events: any[];
};

type LicenseStatus = {
  valid: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
  expiresAt: string | null;
  message?: string;
};

const statusStyle = (status: string) => {
  switch (status?.toUpperCase()) {
    case 'OPEN':
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'COMPLETE':
    case 'DONE':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-600 border-gray-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
};

export default function Warehouse() {
  const router = useRouter();
  const [sessions, setSessions] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>('PICK_PACK_SHIP');
  const [pendingOrderCount, setPendingOrderCount] = useState<number | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const MODES: {
    mode: Mode;
    label: string;
    subtitle: string;
    icon: typeof Inbox;
    gradient: string;
  }[] = [
    {
      mode: 'RECEIVE',
      label: 'RECEIVE',
      subtitle: 'Incoming stock',
      icon: Inbox,
      gradient: 'bg-gradient-to-br from-emerald-500 to-emerald-700',
    },
    {
      mode: 'RETURNS',
      label: 'RETURNS',
      subtitle: 'Customer returns',
      icon: Undo2,
      gradient: 'bg-gradient-to-br from-amber-500 to-orange-600',
    },
    {
      mode: 'MOVE',
      label: 'MOVE',
      subtitle: 'Pick → Move, relocate stock between locations',
      icon: ArrowLeftRight,
      gradient: 'bg-gradient-to-br from-blue-500 to-indigo-700',
    },
    {
      mode: 'FULFILLMENT',
      label: 'FULFILL ORDER',
      subtitle:
        fulfillmentMode === 'PICK_SHIP'
          ? 'Pick → Ship, one session'
          : 'Pick → Pack → Ship, one session',
      icon: PackageCheck,
      gradient: 'bg-gradient-to-br from-violet-500 to-purple-700',
    },
  ];

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await apiFetch('/auth/me');
        if (!res.ok) return;
        setProfile(await res.json());
      } catch (err) {
        console.error(err);
      }
    }
    loadProfile();
  }, []);

  useEffect(() => {
    async function loadLicense() {
      try {
        const res = await apiFetch('/license/status');
        setLicense(await res.json());
      } catch (err) {
        console.error('License status fetch failed:', err);
      }
    }
    loadLicense();
  }, []);

  useEffect(() => {
    async function loadOrgSettings() {
      try {
        const res = await apiFetch('/organization/settings');
        if (!res.ok) return;
        const json = await res.json();
        if (json.fulfillmentMode) setFulfillmentMode(json.fulfillmentMode);
      } catch (err) {
        console.error('Org settings fetch failed:', err);
      }
    }
    loadOrgSettings();
  }, []);

  useEffect(() => {
    async function loadPendingOrders() {
      try {
        const res = await apiFetch('/integrations/orders/pending');
        if (!res.ok) return;
        const json = await res.json();
        setPendingOrderCount(Array.isArray(json) ? json.length : 0);
      } catch (err) {
        console.error('Pending orders fetch failed:', err);
      }
    }
    loadPendingOrders();
  }, []);

  const start = async (mode: Mode) => {
    const res = await apiFetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: mode }),
    });
    const session = await res.json();
    router.push(`/sessions/${session.id}`);
  };

  useEffect(() => {
    if (!query.trim()) {
      setData(null);
      return;
    }
    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/products/search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setData(json);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const loadSessions = async () => {
      const res = await apiFetch('/sessions');
      const data = await res.json();
      setSessions(data);
    };
    loadSessions();
  }, []);

  return (
    <main className="min-h-screen bg-white text-black">
      {/* TOP BAR — logo + account only, no nav links */}
      <div className="border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center shrink-0 shadow-sm">
              <Boxes size={18} strokeWidth={2} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight leading-none truncate">Warehouse OS</h1>
              <p className="text-xs text-gray-500 mt-0.5 truncate">Scanner Hub</p>
            </div>
          </div>

          <button
            onClick={() => setShowProfile(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-gray-300 hover:bg-gray-100 hover:border-gray-400 font-medium transition-colors shrink-0"
          >
            <User size={16} strokeWidth={2} />
            <span className="hidden xs:inline">Account</span>
          </button>
        </div>
      </div>

      {/* Account Modal — w-full + max-w + horizontal margin instead of a
          bare fixed width, so it can't overflow the viewport on the
          narrowest phones (down to ~320px wide). */}
      {showProfile && profile && (
        <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-100 p-6 w-full max-w-[300px] shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <span className="text-[15px] font-medium">Account</span>
              <button
                onClick={() => setShowProfile(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-sm font-medium text-white shrink-0 shadow-sm">
                {profile.email.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{profile.email}</p>
                <p className="text-xs text-gray-500 truncate">{profile.role} · {profile.organization.name}</p>
              </div>
            </div>

            {license && (
              <div
                className={`flex items-center gap-2 rounded-md border px-3 py-2 mb-5 text-xs font-medium ${
                  license.valid
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {license.valid ? <ShieldCheck size={15} strokeWidth={2} className="shrink-0" /> : <ShieldAlert size={15} strokeWidth={2} className="shrink-0" />}
                <span>{license.valid ? 'License active' : license.message || 'License invalid or expired'}</span>
              </div>
            )}

            <div className="border-t border-gray-100 pt-4 space-y-2.5 mb-5">
              {[
                { label: 'Email', value: profile.email },
                { label: 'Role', value: profile.role },
                { label: 'Organization', value: profile.organization.name },
                ...(license ? [{ label: 'License', value: license.status }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center gap-2">
                  <span className="text-[13px] text-gray-400 shrink-0">{label}</span>
                  <span className="text-[13px] text-gray-700 truncate text-right">{value}</span>
                </div>
              ))}
            </div>

            <button
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md border border-red-200 bg-red-50 text-red-600 text-[13px] font-medium hover:bg-red-100 transition-colors"
              onClick={() => {
                localStorage.removeItem('accessToken');
                window.location.href = '/login';
              }}
            >
              <LogOut size={14} />
              Log out
            </button>
          </div>
        </div>
      )}

      {/* CENTERED CONTENT */}
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-5 flex flex-col items-center text-center">
        {/* SEARCH BAR */}
        <div className="pt-8 w-full">
          <div className="relative">
            <Search
              size={18}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search SKU, product, rack, brand..."
              className="w-full pl-10 pr-4 py-3 rounded-md border border-gray-300 focus:outline-none focus:border-black focus:shadow-[0_0_0_3px_rgba(0,0,0,0.06)] text-base transition-shadow text-left"
            />
          </div>

          {query && (
            <div className="mt-2 bg-white border border-gray-300 rounded-md overflow-hidden shadow-md text-left">
              {loading && <div className="p-3 text-sm text-gray-500">Searching...</div>}

              {!loading && data && (
                <div className="max-h-72 overflow-auto text-sm">
                  {data.products?.length > 0 && (
                    <div className="p-2">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">Products</p>
                      {data.products.map((p: any) => (
                        <div
                          key={p.id}
                          className="p-2 hover:bg-gray-100 rounded cursor-pointer"
                          onClick={() => router.push(`/inventory/products/${p.id}`)}
                        >
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-gray-500">{p.sku}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {data.stocks?.length > 0 && (
                    <div className="p-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">Stock</p>
                      {data.stocks.map((s: any) => (
                        <div
                          key={s.id}
                          className="p-2 hover:bg-gray-100 rounded cursor-pointer"
                          onClick={() => router.push(`/products/${s.productId}`)}
                        >
                          <p>{s.product?.name}</p>
                          <p className="text-xs text-gray-500">{s.location?.name} • qty {s.quantity}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {data.locations?.length > 0 && (
                    <div className="p-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">Locations</p>
                      {data.locations.map((l: any) => (
                        <div
                          key={l.id}
                          className="p-2 hover:bg-gray-100 rounded cursor-pointer"
                          onClick={() => router.push(`/locations/${l.id}`)}
                        >
                          {l.name}
                        </div>
                      ))}
                    </div>
                  )}

                  {data.events?.length > 0 && (
                    <div className="p-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">Events</p>
                      {data.events.map((e: any) => (
                        <div
                          key={e.id}
                          className="p-2 text-xs text-gray-700 hover:bg-gray-100 rounded cursor-pointer"
                          onClick={() =>
                            router.push(e.sessionId ? `/sessions/${e.sessionId}` : `/products/${e.productId}`)
                          }
                        >
                          {e.type} • {e.product?.name}
                          {!e.sessionId && <span className="text-gray-400"> (bulk import)</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {!loading && data &&
                    (data.products?.length ?? 0) === 0 &&
                    (data.stocks?.length ?? 0) === 0 &&
                    (data.locations?.length ?? 0) === 0 &&
                    (data.events?.length ?? 0) === 0 && (
                      <div className="p-3 text-sm text-gray-500">No results found</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* PENDING IMPORTED ORDERS — text container gets min-w-0 so it can
            wrap/shrink, and the arrow gets shrink-0, instead of both
            competing for space with no give in a plain flex row. */}
        {!!pendingOrderCount && (
          <div className="pt-6 w-full">
            <div
              onClick={() => router.push('/upload-order')}
              className="flex items-center justify-between gap-2 bg-violet-50 border-2 border-violet-200 rounded-md p-3 cursor-pointer hover:border-violet-300 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0 rounded-md bg-violet-100 p-2">
                  <PlugZap size={16} strokeWidth={2} className="text-violet-700" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-violet-900">
                    {pendingOrderCount} uploaded order{pendingOrderCount === 1 ? '' : 's'} waiting to be fulfilled
                  </p>
                  <p className="text-xs text-violet-600">From Accurate / CSV import</p>
                </div>
              </div>
              <span className="text-xs text-violet-700 font-semibold shrink-0">View →</span>
            </div>
          </div>
        )}

        {/* RECENT SESSIONS */}
        <div className="pt-6 w-full">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Sessions</h2>
            <button
              onClick={() => router.push('/sessions')}
              className="text-xs text-gray-500 hover:text-black font-semibold"
            >
              View All →
            </button>
          </div>

          <div className="space-y-2 text-left">
            {sessions.slice(0, 5).map((s) => (
              <div
                key={s.id}
                onClick={() => router.push(`/sessions/${s.id}`)}
                className="bg-white border border-gray-300 rounded-md p-3 cursor-pointer hover:border-gray-400 hover:shadow-sm transition-all flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-semibold">{s.type}</span>
                  {(s.type === 'FULFILLMENT' || s.type === 'MOVE') && s.stage && (
                    <span className="ml-1.5 text-xs text-gray-500">· {s.stage}</span>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">{s.totalItems} items</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-md border font-medium shrink-0 ${statusStyle(s.status)}`}>
                  {s.status}
                </span>
              </div>
            ))}

            {sessions.length === 0 && <p className="text-sm text-gray-400">No recent sessions</p>}
          </div>
        </div>

        {/* MAIN ACTIONS */}
        <div className="pt-7 pb-10 w-full">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 text-left">
            Start a Session
          </h2>

          <div className="grid grid-cols-2 gap-3">
            {MODES.map(({ mode, label, subtitle, icon: Icon, gradient }) => (
              <button
                key={mode}
                onClick={() => start(mode)}
                className={`
                  ${mode === 'RECEIVE' || mode === 'FULFILLMENT' ? 'col-span-2' : ''}
                  ${gradient} text-white
                  rounded-lg p-4 sm:p-5 text-left
                  shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]
                  transition-all duration-200
                  min-h-[92px] flex items-center gap-3 sm:gap-4
                `}
              >
                <span className="shrink-0 rounded-lg bg-white/15 p-2 sm:p-2.5">
                  <Icon size={22} strokeWidth={2} className="sm:hidden" />
                  <Icon size={24} strokeWidth={2} className="hidden sm:block" />
                </span>
                <div className="min-w-0">
                  <p className="text-lg sm:text-xl font-bold leading-tight">{label}</p>
                  <p className="text-xs sm:text-sm text-white/85">{subtitle}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div className="px-4 sm:px-6 py-4 text-center text-xs text-gray-500 border-t-2 border-gray-300">
        Tap a mode → scan items instantly
      </div>
    </main>
  );
}