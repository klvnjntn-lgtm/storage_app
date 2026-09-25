// app/(app)/reminders/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Bell, Check, Clock, Trash2, Car } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { Reminder } from '@/app/components/invoices/types';
import { toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';


const DUE_SOON_DAYS = 7;

function daysBetween(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function formatDue(
  dueDate: string,
  status: Reminder['status'],
  t: (key: string, vars?: Record<string, string | number>) => string,
  dateLocale: string,
): { label: string; tone: 'overdue' | 'soon' | 'upcoming' | 'done' } {
  const due = new Date(dueDate);
  const now = new Date();
  const diff = daysBetween(due, now);

  if (status === 'COMPLETED') {
    return { label: t('workshop.reminders.completedWasDue', { date: due.toLocaleDateString(dateLocale) }), tone: 'done' };
  }
  if (diff < 0) {
    const count = Math.abs(diff);
    return {
      label: t(count === 1 ? 'workshop.reminders.overdueBy' : 'workshop.reminders.overdueByPlural', { count }),
      tone: 'overdue',
    };
  }
  if (diff === 0) {
    return { label: t('workshop.reminders.dueToday'), tone: 'soon' };
  }
  if (diff <= DUE_SOON_DAYS) {
    return {
      label: t(diff === 1 ? 'workshop.reminders.dueIn' : 'workshop.reminders.dueInPlural', { count: diff }),
      tone: 'soon',
    };
  }
  return { label: t('workshop.reminders.dueOn', { date: due.toLocaleDateString(dateLocale) }), tone: 'upcoming' };
}

function toneStyle(tone: 'overdue' | 'soon' | 'upcoming' | 'done') {
  switch (tone) {
    case 'overdue':
      return 'bg-red-50 text-red-700 border-red-300';
    case 'soon':
      return 'bg-amber-50 text-amber-700 border-amber-300';
    case 'upcoming':
      return 'bg-blue-50 text-blue-700 border-blue-300';
    case 'done':
      return 'bg-green-50 text-green-700 border-green-300';
  }
}

export default function RemindersPage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const dateLocale = language === 'id' ? 'id-ID' : 'en-US';

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [snoozeDate, setSnoozeDate] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/reminders');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('workshop.reminders.loadFailed', { status: res.status }));
        return;
      }
      setReminders(await res.json());
    } catch {
      setError(t('workshop.reminders.serverError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function complete(id: string) {
    setBusyId(id);
    try {
      const res = await apiFetch(`/reminders/${id}/complete`, { method: 'PATCH' });
      if (res.ok) load();
    } finally {
      setBusyId(null);
    }
  }

  async function snooze(id: string, dueDate: string) {
    if (!dueDate) return;
    setBusyId(id);
    try {
      const res = await apiFetch(`/reminders/${id}/snooze`, {
        method: 'PATCH',
        body: JSON.stringify({ dueDate: new Date(dueDate).toISOString() }),
      });
      if (res.ok) {
        setSnoozingId(null);
        setSnoozeDate('');
        load();
      }
    } finally {
      setBusyId(null);
    }
  }

  // FIX — was d.toISOString().slice(0, 10), which converts to UTC first
  // and rolls the date back one day in a timezone ahead of UTC.
  function snoozePreset(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setSnoozeDate(toCalendarDateString(d));
  }

  async function remove(id: string) {
    if (!confirm(t('workshop.reminders.deleteConfirm'))) return;
    setBusyId(id);
    try {
      const res = await apiFetch(`/reminders/${id}`, { method: 'DELETE' });
      if (res.ok) setReminders((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  const pending = reminders.filter((r) => r.status === 'PENDING');
  const completed = reminders.filter((r) => r.status === 'COMPLETED');

  const overdue = pending.filter((r) => daysBetween(new Date(r.dueDate), new Date()) < 0);
  const dueSoon = pending.filter((r) => {
    const d = daysBetween(new Date(r.dueDate), new Date());
    return d >= 0 && d <= DUE_SOON_DAYS;
  });
  const upcoming = pending.filter((r) => daysBetween(new Date(r.dueDate), new Date()) > DUE_SOON_DAYS);

  function ReminderRow({ r }: { r: Reminder }) {
    const due = formatDue(r.dueDate, r.status, t, dateLocale);
    const isSnoozing = snoozingId === r.id;

    return (
      <div className="border border-blue-500/15 rounded-xl p-3 bg-white shadow-sm">
        <div
          onClick={() => router.push(`/workshop/vehicles/${r.vehicle.id}`)}
          className="flex items-start justify-between gap-3 cursor-pointer"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Car size={14} strokeWidth={2} className="text-blue-600/60 shrink-0" />
              <span className="font-semibold">{r.vehicle.plateNumber} · {r.vehicle.vehicleModel}</span>
              <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${toneStyle(due.tone)}`}>
                {due.label}
              </span>
            </div>
            <p className="text-sm text-gray-700 mt-1">{r.note}</p>
            <p className="text-xs text-gray-400 mt-0.5">{r.vehicle.customer.name}</p>
          </div>

          {r.status === 'PENDING' && (
            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => complete(r.id)}
                disabled={busyId === r.id}
                title={t('workshop.reminders.markComplete')}
                className="w-7 h-7 flex items-center justify-center border border-blue-500/20 rounded-md hover:bg-green-50 hover:border-green-300 text-green-700 disabled:opacity-40 transition-colors"
              >
                <Check size={14} strokeWidth={2} />
              </button>
              <button
                onClick={() => {
                  setSnoozingId(isSnoozing ? null : r.id);
                  setSnoozeDate('');
                }}
                title={t('workshop.reminders.snooze')}
                className="w-7 h-7 flex items-center justify-center border border-blue-500/20 rounded-md hover:bg-amber-50 hover:border-amber-300 text-amber-700 transition-colors"
              >
                <Clock size={14} strokeWidth={2} />
              </button>
              <button
                onClick={() => remove(r.id)}
                disabled={busyId === r.id}
                title={t('workshop.reminders.delete')}
                className="w-7 h-7 flex items-center justify-center border border-blue-500/20 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600 disabled:opacity-40 transition-colors"
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>

        {isSnoozing && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-3 pt-3 border-t border-blue-500/10 flex flex-wrap items-center gap-2"
          >
            {[
              { label: t('workshop.reminders.plus1Day'), days: 1 },
              { label: t('workshop.reminders.plus3Days'), days: 3 },
              { label: t('workshop.reminders.plus1Week'), days: 7 },
              { label: t('workshop.reminders.plus1Month'), days: 30 },
            ].map((p) => (
              <button
                key={p.days}
                onClick={() => snoozePreset(p.days)}
                className="text-xs px-2.5 py-1 rounded-md border border-blue-500/20 text-gray-700 hover:border-blue-500/50 hover:bg-blue-50 transition-colors"
              >
                {p.label}
              </button>
            ))}
            <input
              type="date"
              value={snoozeDate}
              onChange={(e) => setSnoozeDate(e.target.value)}
              className="border border-blue-500/20 rounded-md p-1.5 text-xs outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
            />
            <button
              onClick={() => snooze(r.id, snoozeDate)}
              disabled={!snoozeDate || busyId === r.id}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
            >
              {t('workshop.reminders.snooze')}
            </button>
          </div>
        )}
      </div>
    );
  }

  function Section({ title, items, emptyText }: { title: string; items: Reminder[]; emptyText: string }) {
    if (items.length === 0) return null;
    return (
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-600 mb-2">
          {title} <span className="text-gray-400 font-normal">({items.length})</span>
        </h2>
        <div className="flex flex-col gap-2">
          {items.map((r) => (
            <ReminderRow key={r.id} r={r} />
          ))}
        </div>
      </div>
    );
  }

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
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Bell size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('workshop.reminders.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('workshop.reminders.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {loading && <p className="text-sm text-gray-500">{t('workshop.reminders.loading')}</p>}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</p>
        )}

        {!loading && reminders.length === 0 && !error && (
          <p className="text-sm text-gray-400">
            {t('workshop.reminders.empty')}
          </p>
        )}

        <Section title={t('workshop.reminders.overdueSection')} items={overdue} emptyText="" />
        <Section title={t('workshop.reminders.dueSoonSection')} items={dueSoon} emptyText="" />
        <Section title={t('workshop.reminders.upcomingSection')} items={upcoming} emptyText="" />
        <Section title={t('workshop.reminders.completedSection')} items={completed} emptyText="" />
      </div>
    </main>
  );
}