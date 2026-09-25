'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Car, Truck, ShieldAlert } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { Reminder } from '@/app/components/invoices/types';
import { useLanguage } from '@/app/context/LanguageContext';
import { useNotifications, type AppNotification } from '@/lib/hooks/useNotifications';

const DUE_SOON_DAYS = 7;

function daysUntil(dueDate: string) {
  const ms = new Date(dueDate).getTime() - new Date().getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// `enabled` gates whether the bell renders at all (hasWorkshopRms ||
// hasDelivery, see AppShell.tsx); `remindersEnabled` additionally gates the
// vehicle-reminders fetch specifically, since /reminders is module-gated to
// WORKSHOP_RMS and a delivery-only org shouldn't call it.
export default function NotificationDrawer({ enabled, remindersEnabled }: { enabled: boolean; remindersEnabled: boolean }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { unreadCount, notifications, ensureListLoaded, markRead } = useNotifications(enabled);

  useEffect(() => {
    if (!remindersEnabled) return;
    (async () => {
      try {
        const res = await apiFetch('/reminders');
        if (!res.ok) return;
        const json = await res.json();
        setReminders(Array.isArray(json) ? json : []);
      } catch (err) {
        console.error('Reminders fetch failed:', err);
      }
    })();
  }, [remindersEnabled]);

  if (!enabled) return null;

  const pending = reminders.filter((r) => r.status === 'PENDING');
  const overdue = pending.filter((r) => daysUntil(r.dueDate) < 0);
  const dueSoon = pending.filter((r) => {
    const d = daysUntil(r.dueDate);
    return d >= 0 && d <= DUE_SOON_DAYS;
  });
  const attention = [...overdue, ...dueSoon];
  const count = attention.length + unreadCount;

  function openPanel() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
    ensureListLoaded();
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }

  function statusLabel(r: Reminder) {
    const d = daysUntil(r.dueDate);
    if (d < 0) {
      const abs = Math.abs(d);
      const key = abs === 1 ? 'shared.notificationDrawer.overdueByOneDay' : 'shared.notificationDrawer.overdueByDays';
      return { text: t(key, { count: abs }), cls: 'bg-red-50 text-red-700 border-red-300' };
    }
    if (d === 0) return { text: t('shared.notificationDrawer.dueToday'), cls: 'bg-amber-50 text-amber-700 border-amber-300' };
    const key = d === 1 ? 'shared.notificationDrawer.dueInOneDay' : 'shared.notificationDrawer.dueInDays';
    return { text: t(key, { count: d }), cls: 'bg-amber-50 text-amber-700 border-amber-300' };
  }

  function handleNotificationClick(n: AppNotification) {
    setOpen(false);
    if (!n.readAt) markRead(n.id);
    if (n.link) router.push(n.link);
  }

  return (
    <>
      {/* Desktop edge-hover trigger */}
      <div
        className="hidden md:flex fixed top-0 right-0 h-full w-3.5 z-40 items-center justify-center"
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
      >
        {count > 0 && (
          <div className="w-1 h-16 rounded-full bg-red-500/80" />
        )}
      </div>

      {/* Floating bell — click/tap fallback for desktop + mobile + keyboard */}
      <button
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={t('shared.notificationDrawer.notifications')}
        className="fixed bottom-[calc(var(--app-bottom-nav-h,0px)+1.25rem)] right-5 z-40 w-11 h-11 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center hover:bg-blue-700 active:scale-95 transition-all"
      >
        <Bell size={18} strokeWidth={2} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
            {count}
          </span>
        )}
      </button>

      {/* Backdrop on mobile so tapping outside closes it */}
      {open && (
        <div
          className="fixed inset-0 bg-blue-950/10 z-40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[85vw] max-w-[320px] z-50 shadow-xl transition-transform duration-200 ease-out border-l border-blue-500/15 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          backgroundColor: '#f8fafc',
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
      >
        <div className="h-full flex flex-col p-4 overflow-y-auto pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] bg-white/60 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Bell size={15} strokeWidth={2} className="text-blue-700" />
            </span>
            <span className="font-semibold text-sm">{t('shared.notificationDrawer.reminders')}</span>
          </div>

          {count === 0 && (
            <p className="text-sm text-gray-400">{t('shared.notificationDrawer.nothingNeedsAttention')}</p>
          )}

          <div className="flex flex-col gap-2">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className={`text-left border rounded-xl p-2.5 shadow-sm hover:border-blue-500/40 hover:bg-blue-50/40 transition-colors ${
                  n.readAt ? 'border-gray-200 bg-white/60' : 'border-blue-500/15 bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  {n.type.startsWith('DEVICE') || n.type.startsWith('ACCOUNT') ? (
                    <ShieldAlert size={13} strokeWidth={2} className="text-blue-600/60 shrink-0" />
                  ) : (
                    <Truck size={13} strokeWidth={2} className="text-blue-600/60 shrink-0" />
                  )}
                  {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />}
                  <span className="text-xs font-semibold">{n.title}</span>
                </div>
                {n.body && <p className="text-xs text-gray-700">{n.body}</p>}
              </button>
            ))}
            {attention.map((r) => {
              const label = statusLabel(r);
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setOpen(false);
                    router.push(`/workshop/vehicles/${r.vehicle.id}`);
                  }}
                  className="text-left border border-blue-500/15 rounded-xl p-2.5 bg-white shadow-sm hover:border-blue-500/40 hover:bg-blue-50/40 transition-colors"
                >
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <Car size={13} strokeWidth={2} className="text-blue-600/60 shrink-0" />
                    <span className="text-xs font-semibold">{r.vehicle.plateNumber}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-md border font-medium ${label.cls}`}>
                      {label.text}
                    </span>
                  </div>
                  <p className="text-xs text-gray-700">{r.note}</p>
                </button>
              );
            })}
          </div>

          {remindersEnabled && (
            <button
              onClick={() => {
                setOpen(false);
                router.push('/workshop/reminders');
              }}
              className="mt-4 w-full text-xs px-3 py-2 rounded-lg border border-blue-500/20 text-blue-700 font-semibold bg-white hover:bg-blue-50 transition-colors"
            >
              {t('shared.notificationDrawer.viewAllReminders')}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
