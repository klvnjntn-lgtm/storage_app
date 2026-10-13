'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

type Imported = { organizationId: string; name: string; rows: number; files: number };

// Platform console: a business from a .wsexport (e.g. a desktop customer
// moving to the web). Streamed through app/api/platform/organizations/
// import (it can be large); arrives with no modules and default billing.
export default function ImportOrganizationPanel({
  onImported,
  onLocked,
  onCancel,
}: {
  onImported: (result: Imported) => void;
  onLocked: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !password) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('password', password);
      body.append('file', file);
      const res = await apiFetch('/platform/organizations/import', { method: 'POST', body });
      const json = await res.json().catch(() => null);
      if (res.ok) return onImported(json as Imported);
      if (json?.code === 'PLATFORM_LOCKED') return onLocked();
      setError(String(json?.message ?? t('platform.requestFailed', { status: res.status })));
    } catch {
      setError(t('platform.couldNotReachServer'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold">{t('orgTransfer.platform.importTitle')}</h2>
      <p className="text-xs text-gray-500">{t('orgTransfer.platform.importHelp')}</p>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-gray-700">{t('orgTransfer.file')}</span>
          <input type="file" accept=".wsexport" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block text-sm" />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-gray-700">{t('orgTransfer.password')}</span>
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !file || !password}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          <Upload size={15} />
          {busy ? t('orgTransfer.import.importing') : t('orgTransfer.import.button')}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium hover:bg-gray-50">
          {t('orgTransfer.cancel')}
        </button>
      </div>
    </form>
  );
}
