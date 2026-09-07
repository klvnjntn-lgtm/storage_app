'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Car } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { Reminder } from '@/app/components/invoices/types';

const DUE_SOON_DAYS = 7;

function daysUntil(dueDate: string) {
  const ms = new Date(dueDate).getTime() - new Date().getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export default function NotificationDrawer({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  if (!enabled) return null;

  const pending = reminders.filter((r) => r.status === 'PENDING');
  const overdue = pending.filter((r) => daysUntil(r.dueDate) < 0);
  const dueSoon = pending.filter((r) => {
    const d = daysUntil(r.dueDate);
    return d >= 0 && d <= DUE_SOON_DAYS;
  });
  const attention = [...overdue, ...dueSoon];
  const count = attention.length;

  function openPanel() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }

  function statusLabel(r: Reminder) {
    const d = daysUntil(r.dueDate);
    if (d < 0) return { text: `Overdue by ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'}`, cls: 'bg-red-50 text-red-700 border-red-300' };
    if (d === 0) return { text: 'Due today', cls: 'bg-amber-50 text-amber-700 border-amber-300' };
    return { text: `Due in ${d} day${d === 1 ? '' : 's'}`, cls: 'bg-amber-50 text-amber-700 border-amber-300' };
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
        onClick={() => (open ? setOpen(false) : setOpen(true))}
        aria-label="Notifications"
        className="fixed bottom-5 right-5 z-40 w-11 h-11 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center hover:bg-blue-700 active:scale-95 transition-all"
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
            <span className="font-semibold text-sm">Reminders</span>
          </div>

          {count === 0 && (
            <p className="text-sm text-gray-400">Nothing needs attention right now.</p>
          )}

          <div className="flex flex-col gap-2">
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

          <button
            onClick={() => {
              setOpen(false);
              router.push('/workshop/reminders');
            }}
            className="mt-4 w-full text-xs px-3 py-2 rounded-lg border border-blue-500/20 text-blue-700 font-semibold bg-white hover:bg-blue-50 transition-colors"
          >
            View all reminders
          </button>
        </div>
      </div>
    </>
  );
}