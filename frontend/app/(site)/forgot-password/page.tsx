'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    setError('');
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Something went wrong');
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-black flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <header className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-gray-100 mb-3">
            <Mail size={22} strokeWidth={2} className="text-gray-700" />
          </div>
          <h1 className="text-2xl font-bold">Reset password</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enter your email and we'll send you a reset link.
          </p>
        </header>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {sent ? (
          <div className="flex items-start gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            If an account exists for that email, a reset link is on its way.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
                placeholder="you@company.com"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full px-4 py-2.5 bg-black text-white rounded-md text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </div>
        )}

        <p className="text-center text-sm text-gray-500">
          <Link href="/login" className="underline hover:text-black">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}