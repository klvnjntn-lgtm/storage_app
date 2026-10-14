'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { platformCall, type PlatformSession } from './api';

// Step-up before the console opens: password again, then the code the
// backend emails (PlatformAuthService). Wrong answers come back as 400s,
// so they never trip apiFetch's log-out-on-401.
export default function UnlockPanel({
  email,
  onUnlocked,
}: {
  email: string;
  onUnlocked: (s: PlatformSession) => void;
}) {
  const { t } = useLanguage();
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function failMessage(r: { status: number; message: string }) {
    if (r.status === 0) return t('platform.couldNotReachServer');
    return r.message || t('platform.requestFailed', { status: r.status });
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    const r = await platformCall('/unlock/request', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(failMessage(r));
      return;
    }
    setCode('');
    setStep('code');
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError(null);
    const r = await platformCall<{ unlockedUntil: string }>('/unlock/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (!r.ok) {
      setError(failMessage(r));
      return;
    }
    setPassword('');
    onUnlocked({ email, unlocked: true, unlockedUntil: r.data.unlockedUntil });
  }

  const label = 'block font-mono text-[11px] uppercase tracking-wider text-(--c-muted) mb-1.5';
  const input =
    'w-full rounded-lg border border-(--c-line) bg-(--c-input) px-3 py-2.5 text-base sm:text-sm text-(--c-text) outline-none transition-colors focus:border-(--c-sky)/60 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.15)]';
  const primary =
    'w-full rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 px-3 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(56,189,248,0.6)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--c-sky)/60 disabled:opacity-40 disabled:shadow-none cursor-pointer disabled:cursor-not-allowed';

  return (
    <div className="relative max-w-md mx-auto rounded-2xl border border-(--c-line) bg-(--c-surface) backdrop-blur-xl p-6 space-y-5 shadow-[0_0_0_1px_rgba(56,189,248,0.06),0_30px_80px_-30px_rgba(56,189,248,0.35)]">
      <span className="absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-(--c-sky)/70 to-transparent" aria-hidden />
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-(--c-sky)/25 to-blue-600/10 border border-(--c-sky)/30 shadow-[0_0_24px_-4px_rgba(56,189,248,0.45)] shrink-0">
          <KeyRound size={18} className="text-(--c-sky)" aria-hidden />
        </span>
        <div>
          <h2 className="font-semibold text-(--c-ink)">{t('platform.lockedTitle')}</h2>
          <p className="text-sm text-(--c-muted) mt-1 leading-relaxed">{t('platform.lockedHint', { email })}</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="border border-(--c-red)/30 bg-(--c-red)/10 text-(--c-red) text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {step === 'password' ? (
        <form onSubmit={sendCode} className="space-y-3">
          <label className="block">
            <span className={label}>{t('platform.passwordLabel')}</span>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={input}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !password}
            className={primary}
          >
            {busy ? t('platform.sendingCode') : t('platform.sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm text-(--c-sub)">{t('platform.codeSent', { email })}</p>
          <label className="block">
            <span className={label}>{t('platform.codeLabel')}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={`${input} text-center tracking-[0.5em] font-mono text-xl`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className={primary}
          >
            {busy ? t('platform.unlocking') : t('platform.unlock')}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('password');
              setError(null);
            }}
            className="w-full text-sm text-(--c-sky) hover:opacity-80 hover:underline cursor-pointer"
          >
            {t('platform.resend')}
          </button>
        </form>
      )}
    </div>
  );
}
