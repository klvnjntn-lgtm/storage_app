'use client';

import { useEffect, useState } from 'react';
import { PauseCircle, MessageCircle, Mail, LogOut, RotateCcw } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { clearSession } from '@/lib/session';
import { CONTACT_EMAIL, WHATSAPP_URL } from '@/lib/support';
import { useLanguage } from '@/app/context/LanguageContext';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';
import ThemeToggle from '@/app/components/shared/ThemeToggle';

// Shown instead of the app while the platform owner has suspended this
// organization (backend OrgGuard answers ORG_SUSPENDED to everything but
// /auth/me). AuthGuard sends suspended sessions here and everyone else away.
export default function SuspendedPage() {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      const res = await apiFetch('/auth/me');
      const me = await res.json().catch(() => null);
      if (res.ok && me && !me.organization?.suspendedAt) {
        // Reactivated — a full load so AuthGuard re-reads the session.
        window.location.href = me.role === 'DRIVER' ? '/driver' : '/home';
        return;
      }
      setReason(me?.organization?.suspendedReason ?? null);
    } catch {
      // apiFetch already redirected on a 401
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    // check() only sets state after its fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    check();
  }, []);

  async function logOut() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // still clear local state below
    }
    clearSession();
    window.location.href = '/login';
  }

  return (
    <main className="min-h-screen bg-white text-black flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <div className="flex justify-end gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
        <div className="text-center space-y-2">
          <PauseCircle size={44} strokeWidth={1.5} className="mx-auto text-amber-500" />
          <h1 className="text-xl font-bold">{t('suspended.title')}</h1>
          <p className="text-sm text-gray-600">{t('suspended.message')}</p>
        </div>

        {reason && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800/70">
              {t('suspended.reasonLabel')}
            </p>
            <p className="mt-1 text-sm text-amber-900 whitespace-pre-line break-words">{reason}</p>
          </div>
        )}

        <div className="rounded-xl border border-gray-200 px-4 py-3 space-y-2">
          <p className="text-sm text-gray-700">{t('suspended.contact')}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-green-600 text-white text-sm font-semibold px-3 py-2.5"
            >
              <MessageCircle size={16} /> {t('suspended.whatsapp')}
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-gray-300 text-sm font-semibold px-3 py-2.5"
            >
              <Mail size={16} /> {t('suspended.email')}
            </a>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={check}
            disabled={checking}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-gray-300 text-sm font-medium px-3 py-2.5 disabled:opacity-50"
          >
            <RotateCcw size={15} /> {checking ? t('common.loading') : t('suspended.checkAgain')}
          </button>
          <button
            onClick={logOut}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 text-red-700 text-sm font-medium px-3 py-2.5"
          >
            <LogOut size={15} /> {t('suspended.logOut')}
          </button>
        </div>
      </div>
    </main>
  );
}
