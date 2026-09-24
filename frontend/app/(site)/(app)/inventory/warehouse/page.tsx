'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Search,
  Inbox,
  ArrowLeftRight,
  PackageCheck,
  Undo2,
  Boxes,
  PlugZap,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

type Mode = 'RECEIVE' | 'RETURNS' | 'MOVE' | 'FULFILLMENT';
type FulfillmentMode = 'PICK_PACK_SHIP' | 'PICK_SHIP';

type SearchResult = {
  products: any[];
  stocks: any[];
  locations: any[];
  events: any[];
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
  const { t } = useLanguage();
  const [sessions, setSessions] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>('PICK_PACK_SHIP');
  const [pendingOrderCount, setPendingOrderCount] = useState<number | null>(null);

  const MODES: {
    mode: Mode;
    label: string;
    subtitle: string;
    icon: typeof Inbox;
    gradient: string;
  }[] = [
    {
      mode: 'RECEIVE',
      label: t('inventory.warehousePage.modeReceiveLabel'),
      subtitle: t('inventory.warehousePage.modeReceiveSubtitle'),
      icon: Inbox,
      gradient: 'bg-gradient-to-br from-emerald-500 to-emerald-700',
    },
    {
      mode: 'RETURNS',
      label: t('inventory.warehousePage.modeReturnsLabel'),
      subtitle: t('inventory.warehousePage.modeReturnsSubtitle'),
      icon: Undo2,
      gradient: 'bg-gradient-to-br from-amber-500 to-orange-600',
    },
    {
      mode: 'MOVE',
      label: t('inventory.warehousePage.modeMoveLabel'),
      subtitle: t('inventory.warehousePage.modeMoveSubtitle'),
      icon: ArrowLeftRight,
      gradient: 'bg-gradient-to-br from-blue-500 to-indigo-700',
    },
    {
      mode: 'FULFILLMENT',
      label: t('inventory.warehousePage.modeFulfillLabel'),
      subtitle:
        fulfillmentMode === 'PICK_SHIP'
          ? t('inventory.warehousePage.modeFulfillSubtitlePickShip')
          : t('inventory.warehousePage.modeFulfillSubtitlePickPackShip'),
      icon: PackageCheck,
      gradient: 'bg-gradient-to-br from-violet-500 to-purple-700',
    },
  ];

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
    // FIX — was navigating unconditionally, with no res.ok check. A
    // rejected session-creation request (validation error, bad org
    // state, etc.) silently sent the user to
    // /inventory/sessions/undefined with zero error feedback — this is
    // the primary "start a session" action on this page.
    if (!res.ok) {
      alert(session?.message || t('inventory.warehousePage.startSessionFailed', { status: res.status }));
      return;
    }
    router.push(`/inventory/sessions/${session.id}`);
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
      const res = await apiFetch('/sessions?pageSize=5');
      if (!res.ok) return;
      const body = await res.json();
      setSessions(body.data ?? []);
    };
    loadSessions();
  }, []);

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
      {/* TOP BAR — logo only; account/logout lives in AppShell's nav */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shrink-0 shadow-sm">
              <Boxes size={18} strokeWidth={2} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight leading-none truncate">{t('appShell.brand')}</h1>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{t('inventory.warehousePage.scannerHub')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* CENTERED CONTENT */}
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-5 flex flex-col items-center text-center">
        {/* SEARCH BAR */}
        <div className="pt-8 w-full">
          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={18} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('inventory.warehousePage.searchPlaceholder')}
              className="flex-1 min-w-0 text-base outline-none placeholder:text-gray-400 bg-transparent text-left"
            />
          </div>

          {query && (
            <div className="mt-2 bg-white border border-blue-500/20 rounded-md overflow-hidden shadow-md text-left">
              {loading && <div className="p-3 text-sm text-gray-500">{t('inventory.warehousePage.searching')}</div>}

              {!loading && data && (
                <div className="max-h-72 overflow-auto text-sm">
                  {data.products?.length > 0 && (
                    <div className="p-2">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">{t('inventory.warehousePage.resultsProducts')}</p>
                      {data.products.map((p: any) => (
                        <div
                          key={p.id}
                          className="p-2 hover:bg-blue-50 rounded cursor-pointer"
                          onClick={() => router.push(`/inventory/stock/${p.id}`)}
                        >
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-gray-500">{p.sku}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {data.stocks?.length > 0 && (
                    <div className="p-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">{t('inventory.warehousePage.resultsStock')}</p>
                      {data.stocks.map((s: any) => (
                        <div
                          key={s.id}
                          className="p-2 hover:bg-blue-50 rounded cursor-pointer"
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
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">{t('inventory.warehousePage.resultsLocations')}</p>
                      {data.locations.map((l: any) => (
                        <div
                          key={l.id}
                          className="p-2 hover:bg-blue-50 rounded cursor-pointer"
                          onClick={() => router.push(`/locations/${l.id}`)}
                        >
                          {l.name}
                        </div>
                      ))}
                    </div>
                  )}

                  {data.events?.length > 0 && (
                    <div className="p-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">{t('inventory.warehousePage.resultsEvents')}</p>
                      {data.events.map((e: any) => (
                        <div
                          key={e.id}
                          className="p-2 text-xs text-gray-700 hover:bg-blue-50 rounded cursor-pointer"
                          onClick={() =>
                            router.push(e.sessionId ? `/inventory/sessions/${e.sessionId}` : `/inventory/stock/${e.productId}`)
                          }
                        >
                          {e.type} • {e.product?.name}
                          {!e.sessionId && <span className="text-gray-400"> {t('inventory.warehousePage.bulkImport')}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {!loading && data &&
                    (data.products?.length ?? 0) === 0 &&
                    (data.stocks?.length ?? 0) === 0 &&
                    (data.locations?.length ?? 0) === 0 &&
                    (data.events?.length ?? 0) === 0 && (
                      <div className="p-3 text-sm text-gray-500">{t('common.noResults')}</div>
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
                    {t('inventory.warehousePage.pendingOrders', { count: pendingOrderCount })}
                  </p>
                  <p className="text-xs text-violet-600">{t('inventory.warehousePage.pendingOrdersSource')}</p>
                </div>
              </div>
              <span className="text-xs text-violet-700 font-semibold shrink-0">{t('inventory.warehousePage.view')}</span>
            </div>
          </div>
        )}

        {/* RECENT SESSIONS */}
        <div className="pt-6 w-full">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('inventory.warehousePage.recentSessions')}</h2>
            <button
              onClick={() => router.push('/inventory/sessions')}
              className="text-xs text-gray-500 hover:text-blue-700 font-semibold transition-colors"
            >
              {t('inventory.warehousePage.viewAll')}
            </button>
          </div>

          <div className="space-y-2 text-left">
            {sessions.slice(0, 5).map((s) => (
              <div
                key={s.id}
                onClick={() => router.push(`/inventory/sessions/${s.id}`)}
                className="bg-white border border-gray-300 rounded-md p-3 cursor-pointer hover:border-blue-500/40 hover:shadow-sm transition-all flex items-center justify-between gap-2"
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

            {sessions.length === 0 && <p className="text-sm text-gray-400">{t('inventory.warehousePage.noRecentSessions')}</p>}
          </div>
        </div>

        {/* MAIN ACTIONS */}
        <div className="pt-7 pb-10 w-full">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 text-left">
            {t('inventory.warehousePage.startSession')}
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
      <div className="px-4 sm:px-6 py-4 text-center text-xs text-gray-500 border-t border-blue-500/15">
        {t('inventory.warehousePage.footerHint')}
      </div>
    </main>
  );
}