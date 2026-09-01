// app/register/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, AlertTriangle } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    setError('');
    if (!organizationName.trim()) return setError('Organization name is required');
    if (!email.trim()) return setError('Email is required');
    if (password.length < 8) return setError('Password must be at least 8 characters');

    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationName: organizationName.trim(), email: email.trim(), password }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || 'Registration failed');

      localStorage.setItem('accessToken', data.accessToken);
      router.push('/');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-black flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <header className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-gray-100 mb-3">
            <Building2 size={22} strokeWidth={2} className="text-gray-700" />
          </div>
          <h1 className="text-2xl font-bold">Create your organization</h1>
          <p className="text-sm text-gray-500 mt-1">You'll be the first admin</p>
        </header>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Organization name</label>
            <input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
              placeholder="Acme Warehouse"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
              placeholder="you@company.com"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
              className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
              placeholder="At least 8 characters"
            />
          </div>

          <button
            onClick={handleRegister}
            disabled={loading}
            className="w-full px-4 py-2.5 bg-black text-white rounded-md text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create organization'}
          </button>
        </div>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="text-black font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}