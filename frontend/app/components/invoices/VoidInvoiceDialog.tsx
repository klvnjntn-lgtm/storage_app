// app/components/invoices/VoidInvoiceDialog.tsx
'use client';

import { useState } from 'react';
import { AlertCircle, Ban, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

export function VoidInvoiceDialog({
  invoiceId,
  onVoided,
  onClose,
}: {
  invoiceId: string;
  onVoided: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleVoid() {
    if (!reason.trim()) {
      setError('A reason is required to void an invoice.');
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
        throw new Error(body?.message ?? `Failed to void invoice (${res.status})`);
      }
      onVoided();
    } catch (e: any) {
      setError(e.message || 'Could not void invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
          <Ban size={16} strokeWidth={2} />
          Void invoice
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-black">
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-3">
        This cannot be undone. The invoice will be marked VOID and any deducted stock will be
        returned. This is only possible before any payment has been recorded.
      </p>

      <label className="text-xs text-gray-500 mb-1 block">Reason</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="e.g. Wrong customer, entered by mistake"
        className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black resize-none mb-3"
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
          Cancel
        </button>
        <button
          onClick={handleVoid}
          disabled={saving || !reason.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:bg-gray-300"
        >
          <Ban size={14} strokeWidth={2} />
          {saving ? 'Voiding...' : 'Void invoice'}
        </button>
      </div>
    </div>
  );
}