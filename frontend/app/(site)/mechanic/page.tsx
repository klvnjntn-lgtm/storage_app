'use client';

import { useEffect, useState } from 'react';
import { Wrench, PauseCircle, Clock, Package, User, StickyNote, LogOut } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { formatDMY } from '@/lib/dates';
import { apiFetch } from '@/lib/apifetch';
import { clearSession } from '@/lib/session';

type Job = {
  id: string;
  number: string;
  status: 'IN_PROGRESS' | 'WAITING_PARTS' | 'QUEUED';
  plateNumber: string;
  vehicleModel: string;
  complaint: string | null;
  notes: string | null;
  mechanic: string | null;
  branch: string | null;
  createdAt: string;
  startedAt: string | null;
  lines: { name: string; isPart: boolean; quantity: number }[];
};
type Board = { business: { name: string; logoUrl: string | null }; generatedAt: string; jobs: Job[] };

const REFRESH_MS = 30_000;

const COLUMNS: { status: Job['status']; icon: typeof Wrench; tone: string }[] = [
  { status: 'IN_PROGRESS', icon: Wrench, tone: 'text-sky-300 border-sky-400/40' },
  { status: 'WAITING_PARTS', icon: PauseCircle, tone: 'text-amber-300 border-amber-400/40' },
  { status: 'QUEUED', icon: Clock, tone: 'text-slate-300 border-slate-400/30' },
];

// The Mechanic account's screen on the shared shop PC: every job on the floor, what to fit, who's on it.
// Read-only — the front desk (admin/staff) assigns mechanics and moves jobs along; this just follows,
// refreshing every 30 seconds. Not in AppShell: this login has no other page (see AuthGuard).
export default function MechanicBoardPage() {
  const { t } = useLanguage();
  const b = (key: string, vars?: Record<string, string | number>) => t(`workshopBoard.${key}`, vars);
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState<'invalid' | 'offline' | null>(null);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await apiFetch('/work-orders/board');
        if (!alive) return;
        if (!res.ok) {
          // 403: work orders turned off, or the Workshop module ended.
          setFailed(res.status === 403 ? 'invalid' : 'offline');
          return;
        }
        setBoard(await res.json());
        setFailed(null);
      } catch {
        // Keep showing the last board; just say it's stale.
        if (alive) setFailed('offline');
      }
    };
    load();
    const poll = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setClock(new Date()), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  if (failed === 'invalid') {
    return (
      <main className="min-h-dvh bg-slate-950 text-slate-200 flex items-center justify-center p-6 text-center">
        <p className="text-lg">{b('invalid')}</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">{board?.business.name ?? b('title')}</h1>
          <p className="text-sm text-slate-400">{b('title')}</p>
        </div>
        <div className="text-right flex items-start gap-4">
          <button
            type="button"
            onClick={async () => {
              await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
              clearSession();
              window.location.href = '/login';
            }}
            aria-label={t('appShell.logOut')}
            title={t('appShell.logOut')}
            className="mt-1 rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-slate-100"
          >
            <LogOut size={16} />
          </button>
          <div>
          <p className="font-mono text-3xl sm:text-4xl tabular-nums">
            {clock.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className={`text-xs ${failed === 'offline' ? 'text-amber-300' : 'text-slate-500'}`}>
            {failed === 'offline'
              ? b('offline')
              : board
                ? b('updated', { time: new Date(board.generatedAt).toLocaleTimeString('id-ID') })
                : b('loading')}
          </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {COLUMNS.map(({ status, icon: Icon, tone }) => {
          const jobs = board?.jobs.filter((j) => j.status === status) ?? [];
          return (
            <section key={status} className="min-w-0">
              <h2 className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wider border-b pb-2 mb-3 ${tone}`}>
                <Icon size={16} />
                {b(`status.${status}`)}
                <span className="ml-auto font-mono">{jobs.length}</span>
              </h2>
              <div className="space-y-3">
                {jobs.map((job) => (
                  <article key={job.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-2xl font-bold tracking-wide">{job.plateNumber}</p>
                        <p className="text-sm text-slate-400 truncate">{job.vehicleModel}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-xs text-slate-500">{job.number}</p>
                        <p className="text-xs text-slate-500">{formatDMY(new Date(job.createdAt))}</p>
                        {job.branch && <p className="text-xs text-slate-500">{job.branch}</p>}
                      </div>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-sm">
                      <User size={14} className="text-slate-500" />
                      {job.mechanic ?? <span className="text-amber-300">{b('unassigned')}</span>}
                    </p>
                    {job.complaint && <p className="mt-2 text-base text-slate-200 whitespace-pre-wrap">{job.complaint}</p>}
                    {job.lines.length > 0 && (
                      <ul className="mt-3 space-y-1 border-t border-slate-800 pt-2">
                        {job.lines.map((l, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            {l.isPart ? (
                              <Package size={14} className="mt-0.5 text-sky-400 shrink-0" />
                            ) : (
                              <Wrench size={14} className="mt-0.5 text-slate-500 shrink-0" />
                            )}
                            <span className="flex-1 min-w-0">{l.name}</span>
                            <span className="font-mono text-slate-400">× {l.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {job.notes && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-400 whitespace-pre-wrap">
                        <StickyNote size={12} className="mt-0.5 shrink-0" />
                        {job.notes}
                      </p>
                    )}
                  </article>
                ))}
                {board && jobs.length === 0 && <p className="text-sm text-slate-600">{b('empty')}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
