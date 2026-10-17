'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Ban, Building2, ChevronRight, Lock, Search, Terminal, Upload, Users } from 'lucide-react';
import { display } from '@/lib/fonts';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';
import UnlockPanel from '@/app/components/platform/UnlockPanel';
import OrganizationDetail from '@/app/components/platform/OrganizationDetail';
import ImportOrganizationPanel from '@/app/components/platform/ImportOrganizationPanel';
import {
  formatDate,
  formatDateTime,
  moduleIsOn,
  paymentState,
  platformCall,
  type PaymentState,
  type PlatformOrg,
  type PlatformSession,
} from '@/app/components/platform/api';

type Filter = 'all' | 'overdue' | 'suspended';

// Colours come from the .console tokens in theme.css (light + dark).
const PAYMENT_STYLE: Record<PaymentState, string> = {
  paid: 'text-(--c-sub)',
  dueSoon: 'text-(--c-amber)',
  overdue: 'text-(--c-red) font-semibold',
  unpaid: 'text-(--c-faint)',
};

const GRID = 'md:grid-cols-[minmax(0,2fr)_90px_110px_120px_130px_110px_20px]';

// The WareSys owner's view of every customer organization. The backend
// decides who gets in (PlatformOwnerGuard); profile.platformOwner only
// decides whether to try, and a 404 from /platform sends anyone else away.
export default function PlatformPage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const { profile, loading } = useAuth();
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<PlatformOrg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);

  const onLocked = useCallback(() => {
    setSession((s) => (s ? { ...s, unlocked: false, unlockedUntil: null } : s));
    setSelected(null);
    setOrgs(null);
    setNotice(t('platform.sessionLocked'));
  }, [t]);

  useEffect(() => {
    if (loading) return;
    if (!profile?.platformOwner) {
      router.replace('/no-access');
      return;
    }
    platformCall<PlatformSession>('/session').then((r) => {
      if (r.ok) setSession(r.data);
      else if (r.status === 404 || r.status === 403) router.replace('/no-access');
      else setError(r.message || t('platform.couldNotReachServer'));
    });
  }, [loading, profile, router, t]);

  const loadOrgs = useCallback(async () => {
    const r = await platformCall<PlatformOrg[]>('/organizations');
    if (r.ok) {
      setOrgs(r.data);
      setError(null);
    } else if (r.code === 'PLATFORM_LOCKED') onLocked();
    else setError(r.message || t('platform.requestFailed', { status: r.status }));
  }, [onLocked, t]);

  useEffect(() => {
    // loadOrgs() only sets state after its fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (session?.unlocked) loadOrgs();
  }, [session?.unlocked, loadOrgs]);

  // Drop back to the unlock screen the moment the unlock runs out, rather
  // than on the next failed call.
  useEffect(() => {
    if (!session?.unlockedUntil) return;
    const ms = new Date(session.unlockedUntil).getTime() - Date.now();
    const timer = setTimeout(onLocked, Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [session?.unlockedUntil, onLocked]);

  // Ticks the session countdown in the header.
  useEffect(() => {
    if (!session?.unlockedUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.unlockedUntil]);

  // "/" jumps to search, unless you're already typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (!searchRef.current) return;
      e.preventDefault();
      searchRef.current.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function lock() {
    await platformCall('/lock', { method: 'POST' });
    setSession((s) => (s ? { ...s, unlocked: false, unlockedUntil: null } : s));
    setSelected(null);
    setOrgs(null);
    setNotice(null);
  }

  const counts = useMemo(() => {
    const list = orgs ?? [];
    return {
      all: list.length,
      overdue: list.filter((o) => ['overdue', 'dueSoon'].includes(paymentState(o.paidUntil))).length,
      suspended: list.filter((o) => o.suspendedAt).length,
      seatsUsed: list.reduce((n, o) => n + o.seatsUsed, 0),
      seatLimit: list.reduce((n, o) => n + o.seatLimit, 0),
    };
  }, [orgs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (orgs ?? []).filter((o) => {
      if (filter === 'suspended' && !o.suspendedAt) return false;
      if (filter === 'overdue' && !['overdue', 'dueSoon'].includes(paymentState(o.paidUntil))) return false;
      return !q || o.name.toLowerCase().includes(q) || o.plan.includes(q);
    });
  }, [orgs, query, filter]);

  if (loading || !profile?.platformOwner) {
    return <p className="text-sm text-gray-500 p-6">{t('common.loading')}</p>;
  }

  const unlockedUntil = session?.unlockedUntil
    ? new Date(session.unlockedUntil).toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const secondsLeft = session?.unlockedUntil
    ? Math.max(0, Math.floor((new Date(session.unlockedUntil).getTime() - now) / 1000))
    : 0;
  const countdown = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const seatPct = counts.seatLimit ? Math.min(100, Math.round((counts.seatsUsed / counts.seatLimit) * 100)) : 0;

  return (
    <main
      className="console relative min-h-screen text-(--c-text) bg-(--c-bg)"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 45% at 50% -5%, var(--c-glow), transparent 70%),' +
          'linear-gradient(var(--c-grid) 1px, transparent 1px),' +
          'linear-gradient(90deg, var(--c-grid) 1px, transparent 1px)',
        backgroundSize: '100% 100%, 32px 32px, 32px 32px',
      }}
    >
      <div className="sticky top-0 z-10 bg-(--c-bg)/75 backdrop-blur-xl px-3 sm:px-6 py-3 sm:py-4 border-b border-(--c-line)">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-(--c-sky)/25 to-blue-600/10 border border-(--c-sky)/30 shadow-[0_0_24px_-4px_rgba(56,189,248,0.45)] shrink-0">
              <Terminal size={18} strokeWidth={2} className="text-(--c-sky)" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[11px] text-(--c-sky) truncate">waresys://platform</p>
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate text-(--c-ink)`}>
                {t('platform.title')}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {session?.unlocked ? (
              <span
                className="flex items-center gap-2 rounded-full border border-(--c-emerald)/25 bg-(--c-emerald)/8 px-3 py-1.5 font-mono text-xs text-(--c-emerald)"
                title={unlockedUntil ? t('platform.unlockedUntil', { time: unlockedUntil }) : undefined}
              >
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-(--c-emerald) opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-(--c-emerald)" />
                </span>
                <span className="hidden sm:inline">{t('platform.sessionLive')} ·</span>
                <span className="tabular-nums">{t('platform.sessionLeft', { time: countdown })}</span>
              </span>
            ) : session ? (
              <span className="flex items-center gap-1.5 rounded-full border border-(--c-amber)/25 bg-(--c-amber)/8 px-3 py-1.5 font-mono text-xs text-(--c-amber)">
                <Lock size={12} aria-hidden />
                {t('platform.lockedBadge')}
              </span>
            ) : null}
            {session?.unlocked && (
              <button
                onClick={lock}
                aria-label={t('platform.lock')}
                className="flex items-center gap-1.5 text-sm font-medium rounded-lg border border-(--c-line) bg-(--c-fill) px-3 py-2 text-(--c-text) transition-colors hover:bg-(--c-fill-strong) hover:border-(--c-line-strong) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--c-sky)/60 cursor-pointer"
              >
                <Lock size={14} aria-hidden />
                <span className="hidden sm:inline">{t('platform.lock')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4">
        {error && (
          <div role="alert" className="border border-(--c-red)/30 bg-(--c-red)/10 text-(--c-red) text-sm rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {!session && !error && <p className="font-mono text-sm text-(--c-muted)">{t('common.loading')}</p>}

        {session && !session.unlocked && (
          <div className="space-y-3 pt-6 sm:pt-12">
            {notice && (
              <div className="max-w-md mx-auto border border-(--c-amber)/30 bg-(--c-amber)/10 text-(--c-amber) text-sm rounded-lg px-3 py-2">
                {notice}
              </div>
            )}
            <UnlockPanel
              email={session.email}
              onUnlocked={(s) => {
                setNotice(null);
                setSession(s);
              }}
            />
          </div>
        )}

        {session?.unlocked && (
          <>
            <p className="text-xs text-(--c-muted)">{t('platform.subtitle')}</p>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              <StatTile
                icon={Building2}
                tone="sky"
                label={t('platform.stat.organizations')}
                value={orgs ? counts.all : null}
                active={filter === 'all'}
                onClick={() => setFilter('all')}
              />
              <StatTile
                icon={AlertTriangle}
                tone="amber"
                label={t('platform.stat.paymentDue')}
                value={orgs ? counts.overdue : null}
                active={filter === 'overdue'}
                onClick={() => setFilter('overdue')}
              />
              <StatTile
                icon={Ban}
                tone="red"
                label={t('platform.stat.suspended')}
                value={orgs ? counts.suspended : null}
                active={filter === 'suspended'}
                onClick={() => setFilter('suspended')}
              />
              <div className="rounded-xl border border-(--c-line) bg-(--c-surface) backdrop-blur p-3 sm:p-4">
                <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-(--c-muted)">
                  <Users size={13} className="text-(--c-emerald)" aria-hidden />
                  {t('platform.stat.seats')}
                </div>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-mono text-2xl sm:text-3xl font-semibold tabular-nums text-(--c-ink)">
                    {orgs ? counts.seatsUsed : '—'}
                  </span>
                  {orgs && (
                    <span className="font-mono text-xs text-(--c-muted)">
                      {t('platform.stat.seatsOf', { limit: counts.seatLimit })}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 h-1 rounded-full bg-(--c-fill) overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-(--c-emerald) to-(--c-sky) transition-[width] duration-500"
                    style={{ width: `${seatPct}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <label className="group flex items-center gap-2 flex-1 rounded-lg border border-(--c-line) bg-(--c-surface) backdrop-blur px-3 transition-colors focus-within:border-(--c-sky)/50 focus-within:shadow-[0_0_0_3px_rgba(56,189,248,0.12)]">
                <Search size={15} className="text-(--c-faint) group-focus-within:text-(--c-sky) shrink-0" aria-hidden />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('platform.searchPlaceholder')}
                  aria-label={t('platform.searchPlaceholder')}
                  className="flex-1 min-w-0 py-2.5 text-base sm:text-sm outline-none bg-transparent text-(--c-text) placeholder:text-(--c-faint)"
                />
                <kbd className="hidden sm:inline-flex items-center rounded border border-(--c-line) bg-(--c-fill) px-1.5 font-mono text-[11px] text-(--c-muted)">
                  /
                </kbd>
              </label>
              <button
                onClick={() => setImporting((v) => !v)}
                aria-expanded={importing}
                className="shrink-0 flex items-center justify-center gap-1.5 text-sm font-medium rounded-lg border border-(--c-sky)/30 bg-(--c-sky)/8 px-4 py-2.5 text-(--c-sky) transition-colors hover:bg-(--c-sky)/15 hover:border-(--c-sky)/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--c-sky)/60 cursor-pointer"
              >
                <Upload size={15} aria-hidden />
                {t('orgTransfer.platform.importButton')}
              </button>
            </div>

            {importing && (
              <ImportOrganizationPanel
                onCancel={() => setImporting(false)}
                onLocked={onLocked}
                onImported={(r) => {
                  setImporting(false);
                  setImported(t('orgTransfer.platform.imported', { name: r.name, rows: r.rows, files: r.files }));
                  loadOrgs();
                  setSelected(r.organizationId);
                }}
              />
            )}
            {imported && (
              <div role="status" className="border border-(--c-emerald)/30 bg-(--c-emerald)/10 text-(--c-emerald) text-sm rounded-lg px-3 py-2">
                {imported}
              </div>
            )}

            <div className="rounded-xl border border-(--c-line) bg-(--c-surface) backdrop-blur overflow-hidden shadow-[0_24px_60px_-30px_var(--c-shadow)]">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-(--c-line)">
                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-(--c-muted)">
                  <span className="h-1.5 w-1.5 rounded-full bg-(--c-sky)" aria-hidden />
                  {t(`platform.filter.${filter}`)}
                </span>
                {orgs && (
                  <span className="font-mono text-[11px] tabular-nums text-(--c-muted)">
                    {t('platform.showingCount', { shown: visible.length, total: orgs.length })}
                  </span>
                )}
              </div>
              <div
                className={`hidden md:grid ${GRID} gap-3 px-4 py-2 font-mono text-[10.5px] uppercase tracking-wider text-(--c-faint) border-b border-(--c-line) bg-(--c-fill)`}
              >
                <span>{t('platform.col.organization')}</span>
                <span>{t('platform.col.plan')}</span>
                <span>{t('platform.col.seats')}</span>
                <span>{t('platform.col.paidUntil')}</span>
                <span>{t('platform.col.lastLogin')}</span>
                <span>{t('platform.col.status')}</span>
                <span />
              </div>
              {!orgs && !error && (
                <div className="p-4 space-y-2" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-10 rounded-md bg-(--c-fill) motion-safe:animate-pulse" />
                  ))}
                </div>
              )}
              {orgs && visible.length === 0 && (
                <p className="font-mono text-sm text-(--c-muted) px-4 py-8 text-center">{t('platform.empty')}</p>
              )}
              <ul className="divide-y divide-(--c-line)">
                {visible.map((o) => {
                  const pay = paymentState(o.paidUntil);
                  const modulesOn = o.modules.filter(moduleIsOn).length;
                  const seatsFull = o.seatsUsed >= o.seatLimit;
                  const seatsPct = o.seatLimit ? Math.min(100, (o.seatsUsed / o.seatLimit) * 100) : 100;
                  return (
                    <li key={o.id}>
                      <button
                        onClick={() => setSelected(o.id)}
                        className={`group relative w-full text-left px-4 py-3 grid grid-cols-2 ${GRID} gap-x-3 gap-y-1.5 items-center transition-colors hover:bg-(--c-sky)/4 focus-visible:outline-none focus-visible:bg-(--c-sky)/6 cursor-pointer`}
                      >
                        <span
                          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-(--c-sky) opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold truncate text-(--c-ink)">{o.name}</span>
                          <span className="block font-mono text-[11px] text-(--c-faint)">
                            {t('platform.detail.modules')}: {modulesOn}
                            {o.usage &&
                              ` · ${t('platform.usage.line', {
                                products: o.usage.products,
                                invoices: o.usage.invoices30d,
                                mb: (o.usage.mediaBytes / 1_048_576).toFixed(1),
                              })}`}
                          </span>
                        </span>
                        <span className="md:hidden justify-self-end">
                          <StatusBadge org={o} pay={pay} />
                        </span>
                        <span className="text-xs">
                          <span className="md:hidden text-(--c-muted)">{t('platform.col.plan')}: </span>
                          <span className="inline-block font-mono rounded border border-(--c-line) bg-(--c-fill) px-1.5 py-0.5 text-[11px] text-(--c-sub)">
                            {o.plan}
                          </span>
                          {o.effectivePlan && o.effectivePlan !== o.plan && (
                            <span className="ml-1 font-mono text-[11px] text-(--c-red)">→ {o.effectivePlan}</span>
                          )}
                        </span>
                        <span className="text-xs">
                          <span className="md:hidden text-(--c-muted)">{t('platform.col.seats')}: </span>
                          <span className={`font-mono tabular-nums ${seatsFull ? 'text-(--c-red)' : 'text-(--c-sub)'}`}>
                            {o.seatsUsed}/{o.seatLimit}
                          </span>
                          <span className="hidden md:block mt-1 h-1 w-16 rounded-full bg-(--c-fill) overflow-hidden" aria-hidden>
                            <span
                              className={`block h-full rounded-full ${seatsFull ? 'bg-(--c-red)' : 'bg-(--c-sky)'}`}
                              style={{ width: `${seatsPct}%` }}
                            />
                          </span>
                        </span>
                        <span className={`font-mono text-xs ${PAYMENT_STYLE[pay]}`}>
                          <span className="md:hidden font-sans font-normal text-(--c-muted)">{t('platform.col.paidUntil')}: </span>
                          {o.paidUntil ? formatDate(o.paidUntil, language, true) : t('platform.status.unpaid')}
                        </span>
                        <span className="font-mono text-xs text-(--c-muted)">
                          <span className="md:hidden font-sans">{t('platform.col.lastLogin')}: </span>
                          {o.lastActiveAt ? formatDateTime(o.lastActiveAt, language) : t('platform.never')}
                        </span>
                        <span className="hidden md:block">
                          <StatusBadge org={o} pay={pay} />
                        </span>
                        <ChevronRight
                          size={16}
                          className="hidden md:block text-(--c-faint) transition-transform group-hover:translate-x-0.5 group-hover:text-(--c-sky)"
                          aria-hidden
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>

      {selected && session?.unlocked && (
        <OrganizationDetail
          id={selected}
          ownOrganizationId={profile.organization?.id}
          onClose={() => setSelected(null)}
          onChanged={loadOrgs}
          onLocked={onLocked}
        />
      )}
    </main>
  );
}

const TONES = {
  sky: { icon: 'text-(--c-sky)', ring: 'border-(--c-sky)/40 shadow-[0_0_28px_-8px_rgba(56,189,248,0.55)]', glow: 'from-(--c-sky)/15' },
  amber: { icon: 'text-(--c-amber)', ring: 'border-(--c-amber)/40 shadow-[0_0_28px_-8px_rgba(251,191,36,0.5)]', glow: 'from-(--c-amber)/15' },
  red: { icon: 'text-(--c-red)', ring: 'border-(--c-red)/40 shadow-[0_0_28px_-8px_rgba(248,113,113,0.5)]', glow: 'from-(--c-red)/15' },
} as const;

// A count that doubles as the list filter.
function StatTile({
  icon: Icon,
  tone,
  label,
  value,
  active,
  onClick,
}: {
  icon: ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  tone: keyof typeof TONES;
  label: string;
  value: number | null;
  active: boolean;
  onClick: () => void;
}) {
  const c = TONES[tone];
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`relative overflow-hidden text-left rounded-xl border bg-(--c-surface) backdrop-blur p-3 sm:p-4 transition-[border-color,box-shadow,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--c-sky)/60 cursor-pointer ${
        active ? c.ring : 'border-(--c-line) hover:border-(--c-line-strong) hover:bg-(--c-surface-hover)'
      }`}
    >
      {active && <span className={`absolute inset-0 bg-gradient-to-b ${c.glow} to-transparent pointer-events-none`} aria-hidden />}
      <span className="relative flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-(--c-muted)">
        <Icon size={13} className={c.icon} aria-hidden />
        {label}
      </span>
      <span className="relative mt-2 block font-mono text-2xl sm:text-3xl font-semibold tabular-nums text-(--c-ink)">
        {value ?? '—'}
      </span>
    </button>
  );
}

function StatusBadge({ org, pay }: { org: PlatformOrg; pay: PaymentState }) {
  const { t } = useLanguage();
  const [text, style, dot] = org.suspendedAt
    ? [t('platform.status.suspended'), 'border-(--c-red)/30 bg-(--c-red)/10 text-(--c-red)', 'bg-(--c-red)']
    : pay === 'overdue'
      ? [t('platform.status.overdue'), 'border-(--c-amber)/30 bg-(--c-amber)/10 text-(--c-amber)', 'bg-(--c-amber)']
      : pay === 'dueSoon'
        ? [t('platform.status.dueSoon'), 'border-(--c-yellow)/30 bg-(--c-yellow)/10 text-(--c-yellow)', 'bg-(--c-yellow)']
        : [t('platform.status.active'), 'border-(--c-emerald)/30 bg-(--c-emerald)/10 text-(--c-emerald)', 'bg-(--c-emerald)'];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-medium ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  );
}
