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

  const label = 'block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1';
  const input = 'w-full border border-gray-300 rounded-md px-2.5 py-2 text-base sm:text-sm';

  return (
    <div className="max-w-md mx-auto bg-white border border-blue-500/15 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
          <KeyRound size={18} className="text-blue-700" />
        </span>
        <div>
          <h2 className="font-semibold">{t('platform.lockedTitle')}</h2>
          <p className="text-sm text-gray-600 mt-0.5">{t('platform.lockedHint', { email })}</p>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>}

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
            className="w-full bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 disabled:opacity-50"
          >
            {busy ? t('platform.sendingCode') : t('platform.sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm text-gray-700">{t('platform.codeSent', { email })}</p>
          <label className="block">
            <span className={label}>{t('platform.codeLabel')}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={`${input} tracking-[0.4em] font-mono text-lg`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 disabled:opacity-50"
          >
            {busy ? t('platform.unlocking') : t('platform.unlock')}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('password');
              setError(null);
            }}
            className="w-full text-sm text-blue-700 hover:underline"
          >
            {t('platform.resend')}
          </button>
        </form>
      )}
    </div>
  );
}
