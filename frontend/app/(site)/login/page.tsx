'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { LogIn, AlertTriangle } from 'lucide-react';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    setError('');

    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }

    setLoading(true);

    try {
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const loginData = await loginRes.json();

      if (!loginRes.ok) {
        throw new Error(loginData?.message || 'Login failed');
      }

      localStorage.setItem('accessToken', loginData.accessToken);

      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${loginData.accessToken}` },
      });

      if (!meRes.ok) {
        throw new Error('Failed to load profile');
      }

      const me = await meRes.json();
      localStorage.setItem('user', JSON.stringify(me));
      router.replace('/home');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Login failed');
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
        <header className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-blue-600/10 border border-blue-600/20 mb-3">
            <LogIn size={22} strokeWidth={2} className="text-blue-700" />
          </div>

          <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>Sign in</h1>

          <p className="text-sm text-gray-500 mt-1">Warehouse Management System</p>
        </header>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Email</label>

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
            <label className="text-xs font-semibold text-gray-600">Password</label>

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
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>

        <p className="text-center text-sm text-gray-500">Need access? Contact your administrator.</p>
      </div>
    </main>
  );
}