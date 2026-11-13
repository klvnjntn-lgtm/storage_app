'use client';

import { useEffect, useState } from 'react';
import { MailCheck, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';

const DISMISS_KEY = 'waresys:verify-email-dismissed';

// Strip above every page until the signed-in user proves their email
// address with the 6-digit code sent at sign-up (backend
// auth/email-verification.ts). Until the business owner verifies, team
// invites and document emails are refused, so the banner says how to get
// unblocked. Hiding it lasts for this browser tab only.
export function EmailVerifyBanner() {
  const { t } = useLanguage();
  const { profile, refreshProfile } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [justVerified, setJustVerified] = useState(false);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      // storage blocked: the banner just stays
    }
  }, []);

  if (justVerified) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs sm:text-sm bg-green-100 text-green-900">
        <MailCheck size={14} aria-hidden="true" />
        {t('appShell.verifyEmailDone')}
      </div>
    );
  }

  if (!profile || profile.emailVerified !== false || profile.emailVerificationEnforced !== true || dismissed) {
    return null;
  }

  async function submit() {
    if (!/^\d{6}$/.test(code.trim())) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch('/auth/verify-email/confirm', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ tone: 'error', text: typeof data.message === 'string' ? data.message : t('appShell.verifyEmailFailed') });
        return;
      }
      setJustVerified(true);
      await refreshProfile();
      setTimeout(() => setJustVerified(false), 5000);
    } catch {
      setNotice({ tone: 'error', text: t('appShell.verifyEmailFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch('/auth/verify-email/send', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setNotice(
        res.ok
          ? { tone: 'ok', text: t('appShell.verifyEmailSent') }
          : { tone: 'error', text: typeof data.message === 'string' ? data.message : t('appShell.verifyEmailSendFailed') },
      );
    } catch {
      setNotice({ tone: 'error', text: t('appShell.verifyEmailSendFailed') });
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // storage blocked: hidden until the next page load
    }
  }

  return (
    <div className="bg-amber-100 text-amber-900 px-3 py-2 text-xs sm:text-sm">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <MailCheck size={14} aria-hidden="true" className="shrink-0" />
        <span>{t('appShell.verifyEmailPrompt', { email: profile.email })}</span>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={t('appShell.verifyEmailCodeLabel')}
            placeholder="000000"
            className="w-24 rounded border border-amber-400 bg-white px-2 py-1 text-center tracking-widest text-black"
          />
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="rounded bg-amber-800 px-3 py-1 font-semibold text-white disabled:opacity-50"
          >
            {t('appShell.verifyEmailSubmit')}
          </button>
        </form>
        <button type="button" onClick={resend} disabled={busy} className="font-semibold underline disabled:opacity-50">
          {t('appShell.verifyEmailResend')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('appShell.verifyEmailDismiss')}
          title={t('appShell.verifyEmailDismiss')}
          className="rounded p-1 hover:bg-amber-200"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`mt-1 text-center ${notice.tone === 'error' ? 'text-red-700' : ''}`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
