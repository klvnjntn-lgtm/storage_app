'use client';

import { homeFor } from '@/lib/roles';
import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { display } from '@/lib/fonts';
import { LogIn, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';
import ThemeToggle from '@/app/components/shared/ThemeToggle';
import { authReason, getDeviceId } from '@/lib/apifetch';
import { CSRF_HEADERS, markSignedIn } from '@/lib/session';
import { errorMessage } from '@/lib/api-error';


// The URL params are read after mount rather than with useSearchParams(): that
// hook makes the whole form client-rendered, so the server would send an empty
// page and a slow device showed nothing until all the JavaScript had run.
export default function LoginPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Two-factor sign-in: set when the password was right and the backend
  // wants an authenticator (or recovery) code before issuing the session.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  // Why the previous session ended (set by apifetch on a 401).
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);

  // The form is visible before the JavaScript has run; the button stays greyed
  // until then, so a tap can't look like it was ignored.
  const [ready, setReady] = useState(false);

  // Stays true until the next page has actually rendered. The sign-in request
  // finishes long before that on a slow device, and a button re-enabled in the
  // gap gets tapped again, which signs in again and restarts the navigation.
  const [navigating, startNavigating] = useTransition();
  const busy = loading || navigating;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect -- reads browser-only values once after mount */
    if (params.get('reset') === 'success') setResetSuccess(true);
    setSignedOutReason(params.get('reason'));
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function handleLogin() {
    if (busy) return;
    setError('');

    if (!email.trim() || !password) {
      setError(t('auth.login.emailPasswordRequired'));
      return;
    }

    setLoading(true);

    try {
      // X-Device-Id lets the backend recognize this browser across logins
      // for DRIVER device-binding/approval — see apifetch.ts's getDeviceId.
      // A non-DRIVER login carries the same header harmlessly; the backend
      // only acts on it for role === 'DRIVER'.
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId(), ...CSRF_HEADERS },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      // A gateway error page isn't JSON.
      const loginData = await loginRes.json().catch(() => null);

      if (!loginRes.ok) {
        // Device/access-hours rejections come back as specific, already
        // human-readable messages (see AuthService.login) — surfaced as-is
        // rather than folded into the generic "invalid credentials" copy.
        // Known driver restrictions get a translated, plain-language
        // message; anything else is shown as the server sent it.
        const reason = authReason(String(loginData?.message ?? ''));
        throw new Error(reason ? t(`auth.login.reason.${reason}`) : loginData?.message || t('auth.login.loginFailed'));
      }

      if (loginData?.mfaRequired) {
        setMfaToken(loginData.mfaToken);
        return;
      }

      await finishLogin();
    } catch (err) {
      console.error(err);
      // TypeError = the request never got through, usually the phone's signal.
      setError(err instanceof TypeError ? t('auth.login.connectionProblem') : errorMessage(err) || t('auth.login.loginFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleMfa() {
    if (busy || !mfaToken || !code.trim()) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId(), ...CSRF_HEADERS },
        body: JSON.stringify({ mfaToken, code: code.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // An expired challenge means starting again from the password.
        if (String(body?.message ?? '').includes('expired')) setMfaToken(null);
        throw new Error(body?.message || t('auth.login.loginFailed'));
      }
      await finishLogin();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('auth.login.loginFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function finishLogin() {
    // The backend set the session as an httpOnly cookie on this response;
    // only a "signed in" marker is kept client-side (lib/session.ts).
    markSignedIn();

    const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });

    if (!meRes.ok) {
      throw new Error(t('auth.login.profileLoadFailed'));
    }

    // FIX — was `localStorage.setItem('user', JSON.stringify(await
    // meRes.json()))`. Nothing anywhere reads localStorage['user'] —
    // AuthContext always fetches a fresh /auth/me on load instead —
    // so this just persisted profile data (email, role, org name)
    // with no functional purpose. The meRes request itself stays: it
    // still validates the freshly-issued token actually works before
    // redirecting into the app.
    //
    // A DRIVER account has no use for the admin AppShell — it lands on
    // the dedicated /driver route instead (own minimal layout, no
    // sidebar). Every other role keeps the existing /home redirect.
    const meData = await meRes.json();
    startNavigating(() => router.replace(homeFor(meData?.role)));
  }

  return (
    <main
      className="min-h-dvh text-black flex items-center justify-center p-6"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="w-full max-w-sm space-y-6 bg-white/80 backdrop-blur-md border border-blue-500/15 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(37,99,235,0.08)] p-6 sm:p-8">
        <div className="flex justify-end gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>

        <header className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-blue-600/10 border border-blue-600/20 mb-3">
            <LogIn size={22} strokeWidth={2} className="text-blue-700" />
          </div>

          <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>{t('auth.login.title')}</h1>

          <p className="text-sm text-gray-500 mt-1">{t('auth.login.subtitle')}</p>
        </header>

        {resetSuccess && (
          <div className="flex items-start gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {t('auth.login.resetSuccess')}
          </div>
        )}

        {signedOutReason && !error && (
          <div className="flex items-start gap-2 bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-md p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {t(`auth.login.reason.${signedOutReason}`)}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {mfaToken ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{t('security.loginPrompt')}</p>
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleMfa()}
              className="w-full border-2 border-gray-300 rounded-md px-3 py-2 text-lg tracking-[0.3em] text-center outline-none focus:border-blue-500 bg-white"
              placeholder="123456"
            />
            <p className="text-xs text-gray-500">{t('security.loginRecoveryHint')}</p>
            <button
              onClick={handleMfa}
              disabled={busy || !code.trim()}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-40"
            >
              {busy ? t('auth.login.signingIn') : t('security.verify')}
            </button>
            <button
              onClick={() => {
                setMfaToken(null);
                setCode('');
              }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              {t('common.back')}
            </button>
          </div>
        ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">{t('auth.login.email')}</label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none transition-colors focus:border-blue-500 bg-white"
              placeholder="you@company.com"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-600">{t('auth.login.password')}</label>
              <Link
                href="/forgot-password"
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
              >
                {t('auth.login.forgotPassword')}
              </Link>
            </div>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none transition-colors focus:border-blue-500 bg-white"
              placeholder="••••••••"
            />
          </div>

          <button
            onClick={handleLogin}
            disabled={busy || !ready}
            className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? t('auth.login.signingIn') : t('auth.login.signIn')}
          </button>
        </div>
        )}

        <p className="text-center text-sm text-gray-500">{t('auth.login.needAccess')}</p>
      </div>
    </main>
  );
}