// app/register/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    setError('');
    if (!organizationName.trim()) return setError(t('auth.register.orgNameRequired'));
    if (!email.trim()) return setError(t('auth.register.emailRequired'));
    if (password.length < 8) return setError(t('auth.register.passwordMinLength'));
    if (password !== confirmPassword) return setError(t('auth.register.passwordMismatch'));

    setLoading(true);
    try {
      // FIX — was hardcoded to http://localhost:3000, bypassing the
      // Next.js rewrite proxy every other auth call (login, forgot/reset
      // password) uses. Registration went nowhere outside a specific
      // local dev setup. '/api/...' matches login/page.tsx's pattern.
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationName: organizationName.trim(), email: email.trim(), password }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || t('auth.register.registrationFailed'));

      localStorage.setItem('accessToken', data.accessToken);
      // FIX — was router.push('/'), the public marketing page. '/' is in
      // AuthGuard's PUBLIC_PATHS, so a freshly-registered user landed
      // there instead of being routed into the app and had to click
      // "Login" again despite already having a valid token.
      router.replace('/home');
    } catch (err: any) {
      console.error(err);
      setError(err.message || t('auth.register.registrationFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-black flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>

        <header className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-gray-100 mb-3">
            <Building2 size={22} strokeWidth={2} className="text-gray-700" />
          </div>
          <h1 className="text-2xl font-bold">{t('auth.register.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('auth.register.subtitle')}</p>
        </header>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">{t('auth.register.orgName')}</label>
            <input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
              placeholder={t('auth.register.orgNamePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">{t('auth.register.email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
              placeholder="you@company.com"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">{t('auth.register.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
              placeholder={t('auth.register.passwordPlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">{t('auth.register.confirmPassword')}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
              placeholder={t('auth.register.confirmPasswordPlaceholder')}
            />
          </div>

          <button
            onClick={handleRegister}
            disabled={loading}
            className="w-full px-4 py-2.5 bg-black text-white rounded-md text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? t('auth.register.creating') : t('auth.register.createOrganization')}
          </button>
        </div>

        <p className="text-center text-sm text-gray-500">
          {t('auth.register.haveAccount')}{' '}
          <Link href="/login" className="text-black font-semibold hover:underline">
            {t('auth.register.signIn')}
          </Link>
        </p>
      </div>
    </main>
  );
}