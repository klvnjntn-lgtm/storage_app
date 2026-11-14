'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import {
  Bell, Boxes, CheckCheck, ChevronRight, CircleCheck, ClipboardList, ShieldAlert, Smartphone, Truck,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useModuleState } from '@/lib/hooks/useHasModule';
import { usePendingDevices } from '@/lib/hooks/usePendingDevices';
import { isAdminRole } from '@/lib/roles';
import { formatDMY } from '@/lib/dates';
import { getInitialParam, useSyncQueryParams } from '@/lib/useQuerySync';
import type { Reminder } from '@/app/components/invoices/types';
import type { AppNotification } from '@/lib/hooks/useNotifications';
import VehicleRemindersSection, { reminderUrgency } from '@/app/components/workshop/VehicleRemindersSection';

// The one Reminders page, the full version of the bell drawer
// (NotificationDrawer), whatever modules the business has. Three tabs:
//  - Needs action: phones waiting for approval, overdue/due-soon service reminders
//  - Alerts: every alert sent to this account, grouped by day, filterable by
//    category (backend NOTIFICATION_CATEGORIES) and unread
//  - Service reminders (Workshop): the full vehicle reminder list

type Tab = 'action' | 'alerts' | 'service';
type Category = 'all' | 'delivery' | 'workshop' | 'stock' | 'account';

const PAGE_SIZE = 30;

// Mirrors the backend's NOTIFICATION_CATEGORIES, for the icon and colour.
function categoryOf(type: string): Exclude<Category, 'all'> {
  if (type.startsWith('DELIVERY') || type.startsWith('ROUTE')) return 'delivery';
  if (type === 'LOW_STOCK' || type === 'BATCH_EXPIRING') return 'stock';
  if (type.startsWith('WORK_ORDER') || type.startsWith('QUOTATION') || type.startsWith('APPROVAL')) return 'workshop';
  return 'account';
}

const CATEGORY_STYLE: Record<Exclude<Category, 'all'>, { icon: typeof Truck; cls: string }> = {
  delivery: { icon: Truck, cls: 'bg-blue-100 text-blue-700' },
  workshop: { icon: ClipboardList, cls: 'bg-violet-100 text-violet-700' },
  stock: { icon: Boxes, cls: 'bg-amber-100 text-amber-700' },
  account: { icon: ShieldAlert, cls: 'bg-slate-200 text-slate-700' },
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export default function RemindersPage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const localeTag = language === 'id' ? 'id-ID' : 'en-US';
  const { user } = useCurrentUser();
  const hasDelivery = useModuleState('DELIVERY_DMS');
  const hasWorkshop = useModuleState('WORKSHOP_RMS');

  const pendingDevices = usePendingDevices(
    !!hasDelivery && (isAdminRole(user?.role) || user?.role === 'USER'),
  );

  const [tab, setTab] = useState<Tab>(() => getInitialParam<Tab>('tab', 'action'));
  const [category, setCategory] = useState<Category>(() => getInitialParam<Category>('category', 'all'));
  const [unreadOnly, setUnreadOnly] = useState(false);
  useSyncQueryParams({
    tab: tab !== 'action' ? tab : null,
    category: tab === 'alerts' && category !== 'all' ? category : null,
  });

  // ── Counts for the tab badges ──────────────────────────────────────
  const [unreadCount, setUnreadCount] = useState(0);
  const [serviceReminders, setServiceReminders] = useState<Reminder[]>([]);
  const [countsTick, setCountsTick] = useState(0);
  const refreshCounts = () => setCountsTick((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/notifications/unread-count')
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!cancelled && d) setUnreadCount(d.count ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [countsTick]);

  useEffect(() => {
    if (!hasWorkshop) return;
    let cancelled = false;
    apiFetch('/reminders')
      .then((res) => (res.ok ? res.json() : null))
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setServiceReminders(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasWorkshop, countsTick]);

  const serviceAttention = serviceReminders.filter((r) => {
    const u = reminderUrgency(r);
    return u === 'overdue' || u === 'soon';
  }).length;
  const actionCount = pendingDevices.length + serviceAttention;

  // ── Alerts list (load more, grouped by day) ───────────────────────
  const [items, setItems] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // A new filter starts the list over.
  function changeFilter(next: { category?: Category; unreadOnly?: boolean }) {
    if (next.category !== undefined) setCategory(next.category);
    if (next.unreadOnly !== undefined) setUnreadOnly(next.unreadOnly);
    setPage(1);
    setItems([]);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (unreadOnly) qs.set('unreadOnly', 'true');
    if (category !== 'all') qs.set('category', category);
    apiFetch(`/notifications?${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        if (cancelled) return;
        const rows: AppNotification[] = Array.isArray(body.data) ? body.data : [];
        setError(null);
        setItems((prev) => (page === 1 ? rows : [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]));
        setTotal(body.total ?? 0);
      })
      .catch(() => {
        if (!cancelled) setError(t('delivery.reminders.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, unreadOnly, category, reloadTick, t]);

  function openAlert(n: AppNotification) {
    if (!n.readAt) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      apiFetch(`/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => {});
    }
    if (n.link) router.push(n.link);
  }

  async function markAllRead() {
    const res = await apiFetch('/notifications/read-all', { method: 'PATCH' }).catch(() => null);
    if (res?.ok) {
      setUnreadCount(0);
      setPage(1);
      setReloadTick((n) => n + 1);
    }
  }

  // "Today", "Yesterday", the weekday within the last week, then the date.
  const groups = useMemo(() => {
    const today = startOfDay(new Date());
    const DAY = 86_400_000;
    const out: { key: number; label: string; showDate: boolean; items: AppNotification[] }[] = [];
    for (const n of items) {
      const created = new Date(n.createdAt);
      const key = startOfDay(created);
      let group = out[out.length - 1];
      if (!group || group.key !== key) {
        const diff = Math.round((today - key) / DAY);
        const label =
          diff === 0
            ? t('delivery.reminders.today')
            : diff === 1
              ? t('delivery.reminders.yesterday')
              : diff < 7
                ? created.toLocaleDateString(localeTag, { weekday: 'long' })
                : formatDMY(created);
        group = { key, label, showDate: diff < 7, items: [] };
        out.push(group);
      }
      group.items.push(n);
    }
    return out;
  }, [items, t, localeTag]);

  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit', hour12: false });

  const tabs: { key: Tab; label: string; badge: number; tone: string }[] = [
    { key: 'action', label: t('delivery.reminders.tabAction'), badge: actionCount, tone: 'bg-red-500 text-white' },
    { key: 'alerts', label: t('delivery.reminders.tabAlerts'), badge: unreadCount, tone: 'bg-blue-600 text-white' },
    ...(hasWorkshop
      ? [{ key: 'service' as Tab, label: t('delivery.reminders.tabService'), badge: 0, tone: '' }]
      : []),
  ];

  const categories: { key: Category; label: string }[] = [
    { key: 'all', label: t('delivery.reminders.all') },
    ...(hasDelivery ? [{ key: 'delivery' as Category, label: t('delivery.reminders.catDelivery') }] : []),
    { key: 'workshop', label: t('delivery.reminders.catWorkshop') },
    { key: 'stock', label: t('delivery.reminders.catStock') },
    { key: 'account', label: t('delivery.reminders.catAccount') },
  ];

  const hasUnread = unreadCount > 0 || items.some((n) => !n.readAt);

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/85 backdrop-blur-md border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 sm:pt-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Bell size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {t('delivery.reminders.title')}
                </h1>
                <p className="text-xs text-gray-500 truncate">{t('delivery.reminders.subtitle')}</p>
              </div>
            </div>
            {tab === 'alerts' && (
              <button
                onClick={markAllRead}
                disabled={!hasUnread}
                className="flex items-center gap-1.5 text-xs font-medium border border-blue-500/20 text-blue-700 bg-white rounded-md px-2.5 py-2 sm:py-1.5 disabled:opacity-40 shrink-0"
              >
                <CheckCheck size={14} />
                <span className="hidden sm:inline">{t('delivery.reminders.markAllRead')}</span>
              </button>
            )}
          </div>

          <div role="tablist" className="flex gap-1 mt-3 -mb-px overflow-x-auto">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                role="tab"
                aria-selected={tab === tb.key}
                onClick={() => setTab(tb.key)}
                className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === tb.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {tb.label}
                {tb.badge > 0 && (
                  <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${tb.tone}`}>
                    {tb.badge > 99 ? '99+' : tb.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        {/* ── Needs action ─────────────────────────────────────── */}
        {tab === 'action' && (
          <div className="space-y-6">
            {pendingDevices.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-600 mb-2">
                  {t('delivery.reminders.phonesWaiting')}{' '}
                  <span className="text-gray-400 font-normal">({pendingDevices.length})</span>
                </h2>
                <div className="flex flex-col gap-2">
                  {pendingDevices.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => router.push('/delivery/drivers')}
                      className="text-left flex items-center gap-3 border border-amber-300 rounded-xl p-3 bg-amber-50 shadow-sm hover:border-amber-400 transition-colors"
                    >
                      <span className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                        <Smartphone size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-amber-900">
                          {t('shared.notificationDrawer.phoneWaiting')}
                        </span>
                        <span className="block text-xs text-amber-900/80">
                          {t('shared.notificationDrawer.phoneWaitingBody', { name: d.user.displayName || d.user.email })}
                        </span>
                      </span>
                      <ChevronRight size={16} className="text-amber-700 shrink-0" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {hasWorkshop && serviceAttention > 0 && (
              <VehicleRemindersSection only="attention" onChange={refreshCounts} />
            )}

            {actionCount === 0 && (
              <div className="flex flex-col items-center text-center py-14">
                <span className="w-14 h-14 rounded-full bg-green-100 text-green-700 flex items-center justify-center mb-3">
                  <CircleCheck size={28} />
                </span>
                <p className="font-semibold">{t('delivery.reminders.allClear')}</p>
                <p className="text-sm text-gray-500 mt-1">{t('delivery.reminders.allClearHint')}</p>
                <button
                  onClick={() => setTab('alerts')}
                  className="mt-4 text-sm font-medium text-blue-700 hover:underline"
                >
                  {t('delivery.reminders.seeAlerts')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Alerts, by day ───────────────────────────────────── */}
        {tab === 'alerts' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
              <div className="flex gap-1.5 overflow-x-auto flex-1 pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                {categories.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => changeFilter({ category: c.key })}
                    className={`whitespace-nowrap text-xs font-medium rounded-full px-3 py-1.5 border transition-colors ${
                      category === c.key
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-300 text-gray-600 hover:border-blue-400'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 shrink-0 cursor-pointer select-none self-end sm:self-auto">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => changeFilter({ unreadOnly: e.target.checked })}
                  className="accent-blue-600 w-4 h-4"
                />
                {t('delivery.reminders.unreadOnly')}
              </label>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">{error}</p>}
            {loading && items.length === 0 && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
            {!loading && !error && items.length === 0 && (
              <div className="flex flex-col items-center text-center py-14">
                <span className="w-14 h-14 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center mb-3">
                  <Bell size={26} />
                </span>
                <p className="text-sm text-gray-500">
                  {unreadOnly ? t('delivery.reminders.noUnread') : t('delivery.reminders.noAlerts')}
                </p>
              </div>
            )}

            <div className="space-y-5">
              {groups.map((g) => (
                <section key={g.key}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {g.label}
                    {g.showDate && (
                      <span className="ml-1.5 font-normal normal-case tracking-normal text-gray-400">
                        {formatDMY(new Date(g.key))}
                      </span>
                    )}
                  </h2>
                  <div className="flex flex-col gap-1.5 mt-2">
                    {g.items.map((n) => {
                      const cat = CATEGORY_STYLE[categoryOf(n.type)];
                      const Icon = cat.icon;
                      const read = !!n.readAt;
                      return (
                        <button
                          key={n.id}
                          onClick={() => openAlert(n)}
                          className={`text-left flex items-start gap-3 rounded-xl p-3 border transition-colors ${
                            read
                              ? 'bg-gray-200/70 border-gray-300 hover:bg-gray-200'
                              : 'bg-white border-blue-500/25 shadow-sm hover:border-blue-500/50 hover:bg-blue-50/40'
                          }`}
                        >
                          <span
                            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                              read ? 'bg-gray-300 text-gray-600' : cat.cls
                            }`}
                          >
                            <Icon size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start gap-1.5">
                              {!read && <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0 mt-1.5" aria-hidden="true" />}
                              <span className={`text-sm line-clamp-2 ${read ? 'text-gray-600' : 'font-semibold text-gray-900'}`}>
                                {n.title}
                              </span>
                              <span className={`text-[11px] ml-auto pl-2 pt-0.5 shrink-0 tabular-nums ${read ? 'text-gray-500' : 'text-gray-400'}`}>
                                {timeOf(n.createdAt)}
                              </span>
                            </span>
                            {n.body && (
                              <span className={`block text-xs mt-0.5 ${read ? 'text-gray-500' : 'text-gray-700'}`}>{n.body}</span>
                            )}
                          </span>
                          {n.link && <ChevronRight size={16} className="text-gray-400 shrink-0 self-center" />}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            {items.length > 0 && (
              <div className="flex flex-col items-center gap-2 pt-5">
                <p className="text-xs text-gray-400">
                  {t('delivery.reminders.showing', { shown: items.length, total })}
                </p>
                {items.length < total && (
                  <button
                    onClick={() => {
                      setLoading(true);
                      setPage((p) => p + 1);
                    }}
                    disabled={loading}
                    className="text-sm font-medium border border-blue-500/25 text-blue-700 bg-white rounded-lg px-4 py-2 hover:bg-blue-50 disabled:opacity-50"
                  >
                    {loading ? t('common.loading') : t('delivery.reminders.loadMore')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Service reminders (Workshop) ─────────────────────── */}
        {tab === 'service' && hasWorkshop && <VehicleRemindersSection onChange={refreshCounts} />}
      </div>
    </main>
  );
}
