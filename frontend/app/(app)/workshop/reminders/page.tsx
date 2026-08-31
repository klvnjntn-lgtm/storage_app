// app/(app)/reminders/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bell, Check, Clock, Trash2, Car } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { Reminder } from '@/app/components/invoices/types';

const DUE_SOON_DAYS = 7;

function daysBetween(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function formatDue(dueDate: string, status: Reminder['status']): { label: string; tone: 'overdue' | 'soon' | 'upcoming' | 'done' } {
  const due = new Date(dueDate);
  const now = new Date();
  const diff = daysBetween(due, now);

  if (status === 'COMPLETED') {
    return { label: `Completed · was due ${due.toLocaleDateString('id-ID')}`, tone: 'done' };
  }
  if (diff < 0) {
    return { label: `Overdue by ${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'}`, tone: 'overdue' };
  }
  if (diff === 0) {
    return { label: 'Due today', tone: 'soon' };
  }
  if (diff <= DUE_SOON_DAYS) {
    return { label: `Due in ${diff} day${diff === 1 ? '' : 's'}`, tone: 'soon' };
  }
  return { label: `Due ${due.toLocaleDateString('id-ID')}`, tone: 'upcoming' };
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
        setError(body?.message ?? `Failed to load reminders (${res.status})`);
        return;
      }
      setReminders(await res.json());
    } catch {
      setError('Could not reach the server.');
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

  function snoozePreset(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setSnoozeDate(d.toISOString().slice(0, 10));
  }

  async function remove(id: string) {
    if (!confirm('Delete this reminder? It will be hidden from this list.')) return;
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
    const due = formatDue(r.dueDate, r.status);
    const isSnoozing = snoozingId === r.id;

    return (
      <div className="border-2 border-gray-300 rounded-md p-3">
        <div
          onClick={() => router.push(`/workshop/vehicles/${r.vehicle.id}`)}
          className="flex items-start justify-between gap-3 cursor-pointer"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Car size={14} strokeWidth={2} className="text-gray-500 shrink-0" />
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
                title="Mark complete"
                className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-green-50 hover:border-green-300 text-green-700 disabled:opacity-40"
              >
                <Check size={14} strokeWidth={2} />
              </button>
              <button
                onClick={() => {
                  setSnoozingId(isSnoozing ? null : r.id);
                  setSnoozeDate('');
                }}
                title="Snooze"
                className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-amber-50 hover:border-amber-300 text-amber-700"
              >
                <Clock size={14} strokeWidth={2} />
              </button>
              <button
                onClick={() => remove(r.id)}
                disabled={busyId === r.id}
                title="Delete"
                className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600 disabled:opacity-40"
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>

        {isSnoozing && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-3 pt-3 border-t border-gray-200 flex flex-wrap items-center gap-2"
          >
            {[
              { label: '+1 day', days: 1 },
              { label: '+3 days', days: 3 },
              { label: '+1 week', days: 7 },
              { label: '+1 month', days: 30 },
            ].map((p) => (
              <button
                key={p.days}
                onClick={() => snoozePreset(p.days)}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-black hover:bg-gray-50"
              >
                {p.label}
              </button>
            ))}
            <input
              type="date"
              value={snoozeDate}
              onChange={(e) => setSnoozeDate(e.target.value)}
              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-black"
            />
            <button
              onClick={() => snooze(r.id, snoozeDate)}
              disabled={!snoozeDate || busyId === r.id}
              className="text-xs px-3 py-1.5 rounded-md bg-black text-white font-semibold disabled:bg-gray-300"
            >
              Snooze
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
    <main className="min-h-screen bg-white text-black">
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Hub
          </button>

          <div className="flex items-center gap-2">
            <Bell size={22} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">Reminders</h1>
              <p className="text-xs text-gray-500">Follow-ups for vehicles — oil changes, checkups, and the like</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>
        )}

        {!loading && reminders.length === 0 && !error && (
          <p className="text-sm text-gray-400">
            No reminders yet — set one from a vehicle's page or while creating an invoice.
          </p>
        )}

        <Section title="Overdue" items={overdue} emptyText="" />
        <Section title="Due soon" items={dueSoon} emptyText="" />
        <Section title="Upcoming" items={upcoming} emptyText="" />
        <Section title="Completed" items={completed} emptyText="" />
      </div>
    </main>
  );
}