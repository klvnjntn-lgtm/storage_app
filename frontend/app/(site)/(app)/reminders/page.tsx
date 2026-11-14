'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Bell, Car, CheckCheck, ShieldAlert, Smartphone, Truck } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useModuleState } from '@/lib/hooks/useHasModule';
import { usePendingDevices } from '@/lib/hooks/usePendingDevices';
import { isAdminRole } from '@/lib/roles';
import { formatDMYTime } from '@/lib/dates';
import Pagination from '@/app/components/shared/Pagination';
import VehicleRemindersSection from '@/app/components/workshop/VehicleRemindersSection';
import type { AppNotification } from '@/lib/hooks/useNotifications';

// The one Reminders page, the full version of the bell drawer
// (NotificationDrawer), whatever modules the business has: phones waiting for
// approval (Delivery), vehicle service reminders (Workshop), and every alert
// sent to this account, with paging, an unread filter and mark-all-read.
export default function RemindersPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user } = useCurrentUser();
  const hasDelivery = useModuleState('DELIVERY_DMS');
  const hasWorkshop = useModuleState('WORKSHOP_RMS');

  const pendingDevices = usePendingDevices(
    !!hasDelivery && (isAdminRole(user?.role) || user?.role === 'USER'),
  );

  const [items, setItems] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bumped to fetch the current page again (after mark-all-read).
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (unreadOnly) qs.set('unreadOnly', 'true');
    apiFetch(`/notifications?${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        if (cancelled) return;
        setError(null);
        setItems(Array.isArray(body.data) ? body.data : []);
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
  }, [page, pageSize, unreadOnly, reloadTick, t]);

  async function open(n: AppNotification) {
    if (!n.readAt) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      apiFetch(`/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => {});
    }
    if (n.link) router.push(n.link);
  }

  async function markAllRead() {
    const res = await apiFetch('/notifications/read-all', { method: 'PATCH' }).catch(() => null);
    if (res?.ok) {
      setPage(1);
      setReloadTick((n) => n + 1);
    }
  }

  const hasUnread = items.some((n) => !n.readAt);

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
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
          <button
            onClick={markAllRead}
            disabled={!hasUnread}
            className="flex items-center gap-1.5 text-xs font-medium border border-blue-500/20 text-blue-700 bg-white rounded-md px-2.5 py-2 sm:py-1.5 disabled:opacity-40 shrink-0"
          >
            <CheckCheck size={14} />
            <span className="hidden sm:inline">{t('delivery.reminders.markAllRead')}</span>
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        {pendingDevices.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-600 mb-2">
              {t('delivery.reminders.phonesWaiting')} <span className="text-gray-400 font-normal">({pendingDevices.length})</span>
            </h2>
            <div className="flex flex-col gap-2">
              {pendingDevices.map((d) => (
                <button
                  key={d.id}
                  onClick={() => router.push('/delivery/drivers')}
                  className="text-left border border-amber-300 rounded-xl p-3 bg-amber-50 shadow-sm hover:border-amber-400 transition-colors"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Smartphone size={14} className="text-amber-700 shrink-0" />
                    <span className="text-sm font-semibold text-amber-900">
                      {t('shared.notificationDrawer.phoneWaiting')}
                    </span>
                    <span className="text-[11px] text-amber-700 ml-auto">{formatDMYTime(new Date(d.firstSeenAt))}</span>
                  </div>
                  <p className="text-xs text-amber-900">
                    {t('shared.notificationDrawer.phoneWaitingBody', { name: d.user.displayName || d.user.email })}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {hasWorkshop && <VehicleRemindersSection />}

        <section>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-gray-600">{t('delivery.reminders.alerts')}</h2>
            <div className="flex rounded-md border border-blue-500/20 overflow-hidden text-xs bg-white">
              {[false, true].map((u) => (
                <button
                  key={String(u)}
                  onClick={() => {
                    setUnreadOnly(u);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1.5 sm:py-1 font-medium ${unreadOnly === u ? 'bg-blue-600 text-white' : 'text-gray-600'}`}
                >
                  {u ? t('delivery.reminders.unread') : t('delivery.reminders.all')}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">{error}</p>}
          {loading && items.length === 0 && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="text-sm text-gray-400">
              {unreadOnly ? t('delivery.reminders.noUnread') : t('shared.notificationDrawer.nothingNeedsAttention')}
            </p>
          )}

          <div className="flex flex-col gap-2">
            {items.map((n) => {
              const Icon = n.type.startsWith('DEVICE') || n.type.startsWith('ACCOUNT')
                ? ShieldAlert
                : n.type.startsWith('WORK_ORDER')
                  ? Car
                  : Truck;
              return (
                <button
                  key={n.id}
                  onClick={() => open(n)}
                  className={`text-left border rounded-xl p-3 shadow-sm hover:border-blue-500/40 hover:bg-blue-50/40 transition-colors ${
                    n.readAt ? 'border-gray-200 bg-white/60' : 'border-blue-500/20 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 min-w-0">
                    <Icon size={14} className="text-blue-600/60 shrink-0" />
                    {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />}
                    <span className={`text-sm truncate ${n.readAt ? 'text-gray-700' : 'font-semibold'}`}>{n.title}</span>
                    <span className="text-[11px] text-gray-400 ml-auto shrink-0">{formatDMYTime(new Date(n.createdAt))}</span>
                  </div>
                  {n.body && <p className="text-xs text-gray-600">{n.body}</p>}
                </button>
              );
            })}
          </div>

          {total > 0 && (
            <div className="pt-3">
              <Pagination
                page={page}
                pageSize={pageSize}
                totalItems={total}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
