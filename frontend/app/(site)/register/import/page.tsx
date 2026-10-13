'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';
import ThemeToggle from '@/app/components/shared/ThemeToggle';
import { apiFetch } from '@/lib/apifetch';
import { readErrorMessage } from '@/lib/api-error';

// Desktop app, first launch: instead of registering, bring the business in
// from a WareSys export (made in Settings on the web, or on another PC).
// The backend only allows this while the install has no business yet.
export default function ImportBusinessPage() {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<string | null>(null);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !password) return;
    setError('');
    setLoading(true);
    try {
      const body = new FormData();
      body.append('password', password);
      body.append('file', file);
      const res = await apiFetch('/org-transfer/import', { method: 'POST', body });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const result: { name: string } = await res.json();
      setImported(result.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const input = 'border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-black';
  return (
    <main className="min-h-screen bg-white text-black flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-end gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>

        <header className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-gray-100 mb-3">
            <ArrowRightLeft size={22} strokeWidth={2} className="text-gray-700" />
          </div>
          <h1 className="text-2xl font-bold">{t('orgTransfer.import.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('orgTransfer.import.subtitle')}</p>
        </header>

        {imported ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
              <CheckCircle2 size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
              {t('orgTransfer.import.done', { name: imported })}
            </div>
            <Link
              href="/login"
              className="block w-full text-center px-4 py-2.5 bg-black text-white rounded-md text-sm font-semibold"
            >
              {t('orgTransfer.import.toLogin')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleImport} className="space-y-3">
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
                <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="import-file" className="text-xs font-semibold text-gray-600">{t('orgTransfer.file')}</label>
              <input
                id="import-file"
                type="file"
                accept=".wsexport"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="import-password" className="text-xs font-semibold text-gray-600">{t('orgTransfer.password')}</label>
              <input
                id="import-password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !file || !password}
              className="w-full px-4 py-2.5 bg-black text-white rounded-md text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? t('orgTransfer.import.importing') : t('orgTransfer.import.button')}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-gray-500">
          <Link href="/register" className="text-black font-semibold hover:underline">
            {t('orgTransfer.import.back')}
          </Link>
        </p>
      </div>
    </main>
  );
}
