// app/components/invoices/VoidInvoiceDialog.tsx
'use client';

import { useState } from 'react';
import { AlertCircle, Ban, Lock, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

export function VoidInvoiceDialog({
  invoiceId,
  periodClosed = false,
  periodLabel,
  onVoided,
  onClose,
}: {
  invoiceId: string;
  // Proactive disclosure — the backend blocks voiding anything dated in a
  // CLOSED/LOCKED fiscal period (journal.service.ts's voidEntryInner), but
  // that used to be a surprise only discovered on submit. Passing this in
  // lets the dialog warn up front and skip the round trip.
  periodClosed?: boolean;
  periodLabel?: string;
  onVoided: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleVoid() {
    if (!reason.trim()) {
      setError(t('sales.voidInvoice.reasonRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/invoices/${invoiceId}/void`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? t('sales.voidInvoice.failedToVoid', { status: res.status }));
      }
      onVoided();
    } catch (e: any) {
      setError(e.message || t('sales.voidInvoice.couldNotVoid'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
          <Ban size={16} strokeWidth={2} />
          {t('sales.voidInvoice.title')}
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-black">
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-3">
        {t('sales.voidInvoice.description')}
      </p>

      {periodClosed && (
        <div className="flex items-start gap-2 bg-gray-100 border-2 border-gray-300 text-gray-700 rounded-md p-2.5 text-xs mb-3">
          <Lock size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>
            {periodLabel
              ? t('sales.voidInvoice.periodClosedWithLabel', { period: periodLabel })
              : t('sales.voidInvoice.periodClosedGeneric')}
          </span>
        </div>
      )}

      <label className="text-xs text-gray-500 mb-1 block">{t('sales.voidInvoice.reasonLabel')}</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder={t('sales.voidInvoice.reasonPlaceholder')}
        disabled={periodClosed}
        className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black resize-none mb-3 disabled:bg-gray-50 disabled:text-gray-400"
      />

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-2.5 text-xs mb-3">
          <AlertCircle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 text-sm px-3 py-2 rounded-md border-2 border-gray-300 font-semibold hover:bg-gray-100"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={handleVoid}
          disabled={saving || !reason.trim() || periodClosed}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:bg-gray-300"
        >
          <Ban size={14} strokeWidth={2} />
          {saving ? t('sales.voidInvoice.voiding') : t('sales.voidInvoice.voidInvoice')}
        </button>
      </div>
    </div>
  );
}