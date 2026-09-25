// app/accounting/fiscal-periods/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { CalendarClock, Lock, LockOpen, Loader2, Info } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';


const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

type FiscalPeriod = {
  id: string;
  year: number;
  month: number;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  closedAt: string | null;
};

const STATUS_COLOR: Record<FiscalPeriod['status'], string> = {
  OPEN: 'text-green-700 bg-green-50 border-green-200',
  CLOSED: 'text-amber-700 bg-amber-50 border-amber-200',
  LOCKED: 'text-red-700 bg-red-50 border-red-200',
};

const STATUS_LABEL_KEY: Record<FiscalPeriod['status'], string> = {
  OPEN: 'accounting.fiscalPeriods.statusOpen',
  CLOSED: 'accounting.fiscalPeriods.statusClosed',
  LOCKED: 'accounting.fiscalPeriods.statusLocked',
};

function now() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function FiscalPeriodsPage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const MONTH_NAMES = language === 'id' ? MONTH_NAMES_ID : MONTH_NAMES_EN;
  const { profile, loading: authLoading, error: authError } = useAuth();

  const [periods, setPeriods] = useState<FiscalPeriod[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [manualYear, setManualYear] = useState(now().year);
  const [manualMonth, setManualMonth] = useState(now().month);

  // Access gate — same pattern as the Settings page: redirect away as soon
  // as we know this user isn't an admin, before firing any request. The
  // backend already ADMIN-gates close/reopen (assertAdmin in
  // accounting.controller.ts), this just avoids showing the page at all.
  useEffect(() => {
    if (authLoading) return;
    // FIX — see settings/page.tsx's identical fix: a transient /auth/me
    // failure (authError) is not the same as being logged out, and
    // shouldn't force-redirect a valid admin to /login.
    if (!profile) {
      if (!authError) router.replace('/login');
      return;
    }
    if (profile.role !== 'ADMIN') {
      router.replace('/accounting');
    }
  }, [authLoading, profile, authError, router]);

  async function loadPeriods() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/accounting/fiscal-periods');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.fiscalPeriods.requestFailed', { status: res.status }));
        return;
      }
      setPeriods(await res.json());
    } catch {
      setError(t('accounting.fiscalPeriods.couldNotReachServer'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || profile?.role !== 'ADMIN') return;
    loadPeriods();
  }, [authLoading, profile]);

  async function handleClose(year: number, month: number) {
    const label = `${MONTH_NAMES[month - 1]} ${year}`;
    if (!confirm(t('accounting.fiscalPeriods.closeConfirm', { label }))) {
      return;
    }
    setActionError(null);
    setActingKey(`${year}-${month}`);
    try {
      const res = await apiFetch(`/accounting/fiscal-periods/${year}/${month}/close`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.message ?? t('accounting.fiscalPeriods.requestFailed', { status: res.status }));
        return;
      }
      await loadPeriods();
    } catch {
      setActionError(t('accounting.fiscalPeriods.couldNotReachServer'));
    } finally {
      setActingKey(null);
    }
  }

  async function handleReopen(year: number, month: number) {
    const label = `${MONTH_NAMES[month - 1]} ${year}`;
    if (!confirm(t('accounting.fiscalPeriods.reopenConfirm', { label }))) {
      return;
    }
    setActionError(null);
    setActingKey(`${year}-${month}`);
    try {
      const res = await apiFetch(`/accounting/fiscal-periods/${year}/${month}/reopen`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.message ?? t('accounting.fiscalPeriods.requestFailed', { status: res.status }));
        return;
      }
      await loadPeriods();
    } catch {
      setActionError(t('accounting.fiscalPeriods.couldNotReachServer'));
    } finally {
      setActingKey(null);
    }
  }

  // Periods only exist once something's been posted into them
  // (getOrCreateOpenFiscalPeriod creates them lazily) — closePeriod's
  // upsert can still create+close a period that's never had activity, so
  // this small form covers closing a month that isn't in the list yet.
  const manualKey = `${manualYear}-${manualMonth}`;
  const manualExists = periods?.some((p) => p.year === manualYear && p.month === manualMonth);

  if (authLoading || profile?.role !== 'ADMIN') {
    return null;
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
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <CalendarClock size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('nav.items.fiscalPeriods')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.fiscalPeriods.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}
        {actionError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{actionError}</p>}

        <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-3 mb-5">
          <Info size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>
            {t('accounting.fiscalPeriods.infoBanner')}
          </span>
        </div>

        {/* Close an arbitrary month, including one with no activity yet */}
        <div className="border-2 border-gray-300 rounded-md bg-white p-4 mb-5">
          <p className="text-xs font-semibold text-gray-600 mb-2">{t('accounting.fiscalPeriods.closeAPeriod')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-gray-500">{t('accounting.payroll.month')}</label>
              <select
                value={manualMonth}
                onChange={(e) => setManualMonth(Number(e.target.value))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-gray-500">{t('accounting.payroll.year')}</label>
              <input
                type="number"
                value={manualYear}
                onChange={(e) => setManualYear(Number(e.target.value))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white w-24"
              />
            </div>
            <button
              onClick={() => handleClose(manualYear, manualMonth)}
              disabled={actingKey === manualKey || (manualExists && periods?.find((p) => p.year === manualYear && p.month === manualMonth)?.status !== 'OPEN')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {actingKey === manualKey ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : <Lock size={12} strokeWidth={2} />}
              {t('accounting.fiscalPeriods.close')}
            </button>
          </div>
        </div>

        {loading && <p className="text-sm text-gray-500">{t('accounting.fiscalPeriods.loadingPeriods')}</p>}

        {!loading && periods && periods.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">
            {t('accounting.fiscalPeriods.noPeriodsYet')}
          </p>
        )}

        {!loading && periods && periods.length > 0 && (
          <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
            {periods.map((p) => {
              const key = `${p.year}-${p.month}`;
              const isActing = actingKey === key;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${STATUS_COLOR[p.status]}`}>
                      {t(STATUS_LABEL_KEY[p.status])}
                    </span>
                    <span className="text-sm font-semibold">{MONTH_NAMES[p.month - 1]} {p.year}</span>
                    {p.closedAt && (
                      <span className="text-xs text-gray-400">{t('accounting.fiscalPeriods.closedOn', { date: new Date(p.closedAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US') })}</span>
                    )}
                  </div>

                  <div className="shrink-0">
                    {p.status === 'OPEN' && (
                      <button
                        onClick={() => handleClose(p.year, p.month)}
                        disabled={isActing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-60 transition-colors"
                      >
                        {isActing ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : <Lock size={12} strokeWidth={2} />}
                        {t('accounting.fiscalPeriods.close')}
                      </button>
                    )}
                    {p.status === 'CLOSED' && (
                      <button
                        onClick={() => handleReopen(p.year, p.month)}
                        disabled={isActing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 border-green-200 text-green-700 text-xs font-semibold hover:bg-green-50 disabled:opacity-60 transition-colors"
                      >
                        {isActing ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : <LockOpen size={12} strokeWidth={2} />}
                        {t('accounting.fiscalPeriods.reopen')}
                      </button>
                    )}
                    {p.status === 'LOCKED' && (
                      <span className="text-[11px] text-gray-400">{t('accounting.fiscalPeriods.cannotBeReopened')}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
