'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Lock, Search, ChevronRight, Upload } from 'lucide-react';
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

const PAYMENT_STYLE: Record<PaymentState, string> = {
  paid: 'text-gray-700',
  dueSoon: 'text-amber-700',
  overdue: 'text-red-700 font-semibold',
  unpaid: 'text-gray-400',
};

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

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Building2 size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('platform.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">
                {session?.unlocked && unlockedUntil
                  ? t('platform.unlockedUntil', { time: unlockedUntil })
                  : t('platform.subtitle')}
              </p>
            </div>
          </div>
          {session?.unlocked && (
            <button
              onClick={lock}
              className="shrink-0 flex items-center gap-1.5 text-sm font-medium border border-gray-300 bg-white rounded-md px-3 py-2 hover:bg-gray-50"
            >
              <Lock size={14} />
              <span className="hidden sm:inline">{t('platform.lock')}</span>
            </button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>}

        {!session && !error && <p className="text-sm text-gray-500">{t('common.loading')}</p>}

        {session && !session.unlocked && (
          <div className="space-y-3">
            {notice && (
              <div className="max-w-md mx-auto bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-md px-3 py-2">
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
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-md px-2.5 flex-1">
                <Search size={14} className="text-gray-400 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('platform.searchPlaceholder')}
                  className="flex-1 min-w-0 py-2 sm:py-1.5 text-base sm:text-sm outline-none bg-transparent"
                />
              </div>
              <button
                onClick={() => setImporting((v) => !v)}
                className="shrink-0 flex items-center justify-center gap-1.5 text-sm font-medium border border-gray-300 bg-white rounded-md px-3 py-1.5 hover:bg-gray-50"
              >
                <Upload size={14} />
                {t('orgTransfer.platform.importButton')}
              </button>
              <div className="flex gap-1.5 overflow-x-auto">
                {(['all', 'overdue', 'suspended'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`shrink-0 text-xs font-medium rounded-full border px-3 py-1.5 ${
                      filter === f
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {t(`platform.filter.${f}`)}
                    {orgs && <span className="ml-1 opacity-70">{counts[f]}</span>}
                  </button>
                ))}
              </div>
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
              <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-md px-3 py-2">{imported}</div>
            )}

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="hidden md:grid grid-cols-[minmax(0,2fr)_90px_80px_120px_130px_100px_20px] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <span>{t('platform.col.organization')}</span>
                <span>{t('platform.col.plan')}</span>
                <span>{t('platform.col.seats')}</span>
                <span>{t('platform.col.paidUntil')}</span>
                <span>{t('platform.col.lastLogin')}</span>
                <span>{t('platform.col.status')}</span>
                <span />
              </div>
              {!orgs && !error && <p className="text-sm text-gray-500 p-4">{t('common.loading')}</p>}
              {orgs && visible.length === 0 && <p className="text-sm text-gray-500 p-4">{t('platform.empty')}</p>}
              <ul className="divide-y divide-gray-100">
                {visible.map((o) => {
                  const pay = paymentState(o.paidUntil);
                  const modulesOn = o.modules.filter(moduleIsOn).length;
                  const seatsFull = o.seatsUsed >= o.seatLimit;
                  return (
                    <li key={o.id}>
                      <button
                        onClick={() => setSelected(o.id)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 grid grid-cols-2 md:grid-cols-[minmax(0,2fr)_90px_80px_120px_130px_100px_20px] gap-x-3 gap-y-1 items-center"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold truncate">{o.name}</span>
                          <span className="block text-[11px] text-gray-500">
                            {t('platform.detail.modules')}: {modulesOn}
                          </span>
                        </span>
                        <span className="md:hidden justify-self-end">
                          <StatusBadge org={o} pay={pay} />
                        </span>
                        <span className="text-xs md:text-sm">
                          <span className="md:hidden text-gray-500">{t('platform.col.plan')}: </span>
                          {o.plan}
                        </span>
                        <span className={`text-xs md:text-sm tabular-nums ${seatsFull ? 'text-red-700' : ''}`}>
                          <span className="md:hidden text-gray-500">{t('platform.col.seats')}: </span>
                          {o.seatsUsed}/{o.seatLimit}
                        </span>
                        <span className={`text-xs md:text-sm ${PAYMENT_STYLE[pay]}`}>
                          <span className="md:hidden text-gray-500 font-normal">{t('platform.col.paidUntil')}: </span>
                          {o.paidUntil ? formatDate(o.paidUntil, language, true) : t('platform.status.unpaid')}
                        </span>
                        <span className="text-xs text-gray-600">
                          <span className="md:hidden text-gray-500">{t('platform.col.lastLogin')}: </span>
                          {o.lastLoginAt ? formatDateTime(o.lastLoginAt, language) : t('platform.never')}
                        </span>
                        <span className="hidden md:block">
                          <StatusBadge org={o} pay={pay} />
                        </span>
                        <ChevronRight size={16} className="hidden md:block text-gray-400" />
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

function StatusBadge({ org, pay }: { org: PlatformOrg; pay: PaymentState }) {
  const { t } = useLanguage();
  const [text, style] = org.suspendedAt
    ? [t('platform.status.suspended'), 'bg-red-100 text-red-800 border-red-300']
    : pay === 'overdue'
      ? [t('platform.status.overdue'), 'bg-amber-100 text-amber-800 border-amber-300']
      : pay === 'dueSoon'
        ? [t('platform.status.dueSoon'), 'bg-yellow-50 text-yellow-800 border-yellow-300']
        : [t('platform.status.active'), 'bg-green-100 text-green-800 border-green-300'];
  return <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${style}`}>{text}</span>;
}
