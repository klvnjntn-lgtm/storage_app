'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, X } from 'lucide-react';
import { apiFetch, PLAN_LIMIT_EVENT } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

type Status = {
  plan: string;
  effectivePlan: string;
  trialEndsAt: string | null;
  nextRenewal: { module: string; paidUntil: string } | null;
};

const DAY = 86_400_000;

// Thin strip above every page while a self-serve org is on its trial
// (last 7 days only) or has lapsed to the free limits. Hand-managed
// ("custom") orgs never see it.
export function PlanBanner({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [renewalDaysLeft, setRenewalDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/billing/status');
        if (!res.ok) return;
        const s: Status = await res.json();
        setStatus(s);
        setTrialDaysLeft(
          s.effectivePlan === 'trial' && s.trialEndsAt
            ? Math.max(0, Math.ceil((new Date(s.trialEndsAt).getTime() - Date.now()) / DAY))
            : null,
        );
        setRenewalDaysLeft(
          s.nextRenewal ? Math.ceil((new Date(s.nextRenewal.paidUntil).getTime() - Date.now()) / DAY) : null,
        );
      } catch {
        // banner is optional
      }
    })();
  }, []);

  if (!status || status.plan === 'custom') return null;

  // A trial that ended without a purchase.
  const lapsed = status.plan === 'trial' && status.effectivePlan === 'free';
  const trialEnding = trialDaysLeft !== null && trialDaysLeft <= 7;
  const renewing = renewalDaysLeft !== null && renewalDaysLeft <= 7;
  if (!lapsed && !trialEnding && !renewing) return null;

  return (
    <div
      className={`flex items-center justify-center gap-2 px-3 py-1.5 text-xs sm:text-sm ${
        lapsed ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900'
      }`}
    >
      {lapsed ? <AlertTriangle size={14} /> : <Clock size={14} />}
      <span>
        {lapsed
          ? t('billing.bannerLapsed')
          : trialEnding
            ? t('billing.bannerTrial', { n: trialDaysLeft ?? 0 })
            : renewalDaysLeft! < 0
              ? t('billing.bannerGrace', { module: t(`billing.module.${status.nextRenewal!.module}`) })
              : t('billing.bannerRenew', { module: t(`billing.module.${status.nextRenewal!.module}`), n: renewalDaysLeft ?? 0 })}
      </span>
      {isAdmin && (
        <Link href="/settings/billing" className="font-semibold underline">
          {t('billing.bannerCta')}
        </Link>
      )}
    </div>
  );
}

type LimitDetail = { resource: string; limit: number; plan: string };

// Shown whenever any request hits a plan limit (apiFetch broadcasts
// PLAN_LIMIT_EVENT), so every "add" button in the app gets an upgrade
// path without each page knowing about plans.
export function PlanLimitToast({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<LimitDetail | null>(null);

  useEffect(() => {
    const onLimit = (e: Event) => setDetail((e as CustomEvent<LimitDetail>).detail);
    window.addEventListener(PLAN_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, onLimit);
  }, []);

  if (!detail) return null;

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-50 bg-white border border-amber-300 shadow-lg rounded-xl p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{t('billing.limitTitle')}</p>
          <p className="text-sm text-gray-600 mt-0.5">
            {t('billing.limitBody', {
              limit: detail.limit,
              resource: t(`billing.resource.${detail.resource}`).toLowerCase(),
            })}
          </p>
          {isAdmin ? (
            <Link
              href="/settings/billing"
              onClick={() => setDetail(null)}
              className="inline-block mt-2 text-sm font-semibold text-blue-700 underline"
            >
              {t('billing.limitCta')}
            </Link>
          ) : (
            <p className="mt-2 text-xs text-gray-500">{t('billing.limitAskAdmin')}</p>
          )}
        </div>
        <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600" aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
