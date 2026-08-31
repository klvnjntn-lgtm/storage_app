'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, AlertTriangle } from 'lucide-react';

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
return ( <main className="min-h-screen bg-white text-black flex items-center justify-center p-6"> <div className="w-full max-w-sm space-y-6"> <header className="text-center"> <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-gray-100 mb-3"> <LogIn
           size={22}
           strokeWidth={2}
           className="text-gray-700"
         /> </div>


      <h1 className="text-2xl font-bold">
        Sign in
      </h1>

      <p className="text-sm text-gray-500 mt-1">
        Warehouse Management System
      </p>
    </header>

    {error && (
      <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
        <AlertTriangle
          size={18}
          strokeWidth={2}
          className="shrink-0 mt-0.5"
        />
        {error}
      </div>
    )}

    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600">
          Email
        </label>

        <input
          type="email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
          onKeyDown={(e) =>
            e.key === 'Enter' && handleLogin()
          }
          className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
          placeholder="you@company.com"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600">
          Password
        </label>

        <input
          type="password"
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
          onKeyDown={(e) =>
            e.key === 'Enter' && handleLogin()
          }
          className="border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black"
          placeholder="••••••••"
        />
      </div>

      <button
        onClick={handleLogin}
        disabled={loading}
        className="w-full px-4 py-2.5 bg-black text-white rounded-md text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading
          ? 'Signing in...'
          : 'Sign in'}
      </button>
    </div>

    <p className="text-center text-sm text-gray-500">
      Need access? Contact your administrator.
    </p>
  </div>
</main>


);
}
