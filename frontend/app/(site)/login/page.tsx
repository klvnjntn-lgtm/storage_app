'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { display } from '@/lib/fonts';
import { LogIn, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';
import { getDeviceId } from '@/lib/apifetch';


// FIX — useSearchParams() (below, in LoginForm) requires a Suspense
// boundary for static prerendering, or `next build` fails outright with
// "useSearchParams() should be wrapped in a suspense boundary at page
// /login" — this wasn't a lint nitpick, it broke the production build
// entirely. Mirrors the standard Next.js App Router fix.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    if (searchParams.get('reset') === 'success') {
      setResetSuccess(true);
    }
  }, [searchParams]);

  async function handleLogin() {
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
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const loginData = await loginRes.json();

      if (!loginRes.ok) {
        // Device/access-hours rejections come back as specific, already
        // human-readable messages (see AuthService.login) — surfaced as-is
        // rather than folded into the generic "invalid credentials" copy.
        throw new Error(loginData?.message || t('auth.login.loginFailed'));
      }

      localStorage.setItem('accessToken', loginData.accessToken);

      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${loginData.accessToken}` },
      });

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
      router.replace(meData?.role === 'DRIVER' ? '/driver' : '/home');
    } catch (err: any) {
      console.error(err);
      setError(err.message || t('auth.login.loginFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen text-black flex items-center justify-center p-6"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="w-full max-w-sm space-y-6 bg-white/80 backdrop-blur-md border border-blue-500/15 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(37,99,235,0.08)] p-6 sm:p-8">
        <div className="flex justify-end">
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

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

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
            disabled={loading}
            className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? t('auth.login.signingIn') : t('auth.login.signIn')}
          </button>
        </div>

        <p className="text-center text-sm text-gray-500">{t('auth.login.needAccess')}</p>
      </div>
    </main>
  );
}