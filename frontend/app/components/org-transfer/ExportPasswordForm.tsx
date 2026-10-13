'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

const MIN_PASSWORD = 8;

// The password a .wsexport is encrypted with, typed twice. Shared by the
// business's own export (Settings) and the platform console's.
export default function ExportPasswordForm({
  busy,
  onExport,
  onCancel,
}: {
  busy: boolean;
  onExport: (password: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useLanguage();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(t('orgTransfer.passwordTooShort'));
    if (password !== repeat) return setError(t('orgTransfer.passwordMismatch'));
    setError('');
    onExport(password);
  }

  const input =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-gray-700">{t('orgTransfer.password')}</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} mt-1`} />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-gray-700">{t('orgTransfer.passwordRepeat')}</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={`${input} mt-1`} />
        </label>
      </div>
      <p className="text-xs text-gray-500">{t('orgTransfer.passwordHint')}</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          <Download size={16} strokeWidth={2} />
          {busy ? t('orgTransfer.export.exporting') : t('orgTransfer.export.button')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">
            {t('orgTransfer.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
