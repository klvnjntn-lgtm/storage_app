'use client';

import { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { readErrorMessage } from '@/lib/api-error';
import { downloadResponse } from '@/lib/download';
import { useLanguage } from '@/app/context/LanguageContext';
import ExportPasswordForm from '@/app/components/org-transfer/ExportPasswordForm';

// Settings → Export business data: the whole business as an encrypted
// .wsexport, to move between WareSys web and the desktop app (imported on
// the desktop app's first launch, or by the platform console on the web).
export default function ExportBusinessSettings() {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function exportData(password: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch('/org-transfer/export', { method: 'POST', body: JSON.stringify({ password }) });
      if (!res.ok) {
        setMessage({ ok: false, text: await readErrorMessage(res) });
        return;
      }
      await downloadResponse(res, 'business.wsexport');
      setMessage({ ok: true, text: t('orgTransfer.export.done') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <ArrowRightLeft size={18} strokeWidth={2} className="text-blue-600" aria-hidden="true" />
        <h2 className="font-bold">{t('orgTransfer.export.heading')}</h2>
      </div>
      <p className="text-sm text-gray-600">{t('orgTransfer.export.description')}</p>
      <ExportPasswordForm busy={busy} onExport={exportData} />
      {message && <p className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}
    </section>
  );
}
