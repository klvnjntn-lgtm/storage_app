'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Rocket, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { btnPrimary, btnSecondary } from '@/app/components/shared/PageFrame';

type Step = { key: string; done: boolean; optional?: boolean };
type Status = { completedAt: string | null; show: boolean; steps: Step[] };

// Where each step is done. Steps are checked against the data itself on
// the backend (OnboardingService), so coming back here after doing one
// ticks it off with no extra bookkeeping.
const STEP_LINK: Record<string, string> = {
  company: '/settings#business-identity',
  location: '/inventory/warehouse',
  products: '/admin/products',
  bankAccount: '/settings#bank-accounts',
  team: '/admin/members',
  firstInvoice: '/sales/invoices/new',
};

// The getting-started list for a new self-serve organization. Renders
// nothing for anyone else (non-admins get a 403, hand-managed orgs and
// finished ones get show=false).
export function OnboardingChecklist({ variant = 'card' }: { variant?: 'card' | 'page' }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/onboarding');
      if (res.ok) setStatus(await res.json());
    } catch {
      // Non-essential: the home page works without it.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function finish() {
    const res = await apiFetch('/onboarding/complete', { method: 'POST' });
    if (res.ok) setStatus(await res.json());
  }

  if (!status || (!status.show && variant === 'card')) return null;

  const required = status.steps.filter((s) => !s.optional);
  const done = status.steps.filter((s) => s.done).length;
  const allRequiredDone = required.every((s) => s.done);

  return (
    <section className="bg-white border border-blue-500/20 rounded-xl p-4 sm:p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 text-white shrink-0">
            <Rocket size={18} />
          </span>
          <div>
            <h2 className="font-bold">{t('onboarding.title')}</h2>
            <p className="text-xs text-gray-500">
              {t('onboarding.progress', { done, total: status.steps.length })}
            </p>
          </div>
        </div>
        {variant === 'card' && (
          <button onClick={finish} className="text-gray-400 hover:text-gray-600" aria-label={t('onboarding.dismiss')}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="mt-3 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-blue-600 rounded-full" style={{ width: `${(done / status.steps.length) * 100}%` }} />
      </div>

      <ol className="mt-4 space-y-2">
        {status.steps.map((s) => (
          <li key={s.key}>
            <Link
              href={STEP_LINK[s.key]}
              className="flex items-start gap-3 rounded-lg border border-gray-100 hover:border-blue-300 hover:bg-blue-50/40 p-3"
            >
              {s.done ? (
                <CheckCircle2 size={18} className="text-green-600 shrink-0 mt-0.5" />
              ) : (
                <Circle size={18} className="text-gray-300 shrink-0 mt-0.5" />
              )}
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${s.done ? 'text-gray-500 line-through' : ''}`}>
                  {t(`onboarding.step.${s.key}.title`)}
                  {s.optional && <span className="ml-1.5 text-xs font-normal text-gray-400">{t('onboarding.optional')}</span>}
                </span>
                {!s.done && <span className="block text-xs text-gray-500">{t(`onboarding.step.${s.key}.description`)}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {status.show && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={finish} className={allRequiredDone ? btnPrimary : btnSecondary}>
            {allRequiredDone ? t('onboarding.finish') : t('onboarding.skip')}
          </button>
        </div>
      )}
    </section>
  );
}
