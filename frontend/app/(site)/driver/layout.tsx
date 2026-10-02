'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { LogOut, Bell } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { display } from '@/lib/fonts';
import ThemeToggle from '@/app/components/shared/ThemeToggle';
import { apiFetch } from '@/lib/apifetch';
import { clearSession } from '@/lib/session';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { ensurePushSubscription } from '@/lib/push';

// Deliberately NOT wrapped in AppShell — that sidebar is built for the
// admin desktop dashboard. A driver is on their phone in the field and
// only ever needs their own route, so this is its own minimal shell. It
// gets its own bell (rather than AppShell's NotificationDrawer) since it
// never renders AppShell at all.
export default function DriverLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const { unreadCount, notifications, ensureListLoaded, markRead } = useNotifications(true);

  useEffect(() => {
    ensurePushSubscription();
  }, []);

  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // ignore — still proceed to clear local state below
    }
    clearSession();
    window.location.href = '/login';
  }

  return (
    <div
      className="min-h-dvh text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-white/80 backdrop-blur-md border-b border-blue-500/15 px-4 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Image
            src="/waresys-logo.svg"
            alt={t('appShell.brand')}
            width={1600}
            height={442}
            priority
            className="app-logo h-6 w-auto shrink-0"
          />
          <span className={`${display.className} text-lg font-bold truncate border-l border-blue-500/20 pl-2.5`}>
            {t('delivery.driver.title')}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ThemeToggle />
          <div className="relative">
            <button
              onClick={() => {
                setOpen((v) => !v);
                if (!open) ensureListLoaded();
              }}
              aria-label={t('shared.notificationDrawer.notifications')}
              className="relative w-11 h-11 flex items-center justify-center rounded-xl text-gray-600 hover:text-blue-700"
            >
              <Bell size={22} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border-2 border-white">
                  {unreadCount}
                </span>
              )}
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div className="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-2">
                  {notifications.length === 0 && (
                    <p className="text-xs text-gray-400 p-2">{t('shared.notificationDrawer.nothingNeedsAttention')}</p>
                  )}
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setOpen(false);
                        if (!n.readAt) markRead(n.id);
                      }}
                      className={`w-full text-left border rounded-md p-2 mb-1 text-xs ${
                        n.readAt ? 'border-gray-100 bg-white' : 'border-blue-200 bg-blue-50/50'
                      }`}
                    >
                      <div className="font-semibold">{n.title}</div>
                      {n.body && <div className="text-gray-500 mt-0.5">{n.body}</div>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="h-11 flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700"
          >
            <LogOut size={18} />
            {t('appShell.logOut')}
          </button>
        </div>
      </header>
      <main className="max-w-xl mx-auto p-4 pb-10">{children}</main>
    </div>
  );
}
