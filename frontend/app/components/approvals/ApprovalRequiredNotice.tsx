'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

export type ApprovalRequiredError = {
  error: 'ApprovalRequired';
  documentType: 'PURCHASE_ORDER' | 'INVOICE';
  documentId: string;
  pendingRequestId: string | null;
  message: string;
};

export function isApprovalRequired(body: unknown): body is ApprovalRequiredError {
  return !!body && typeof body === 'object' && (body as { error?: string }).error === 'ApprovalRequired';
}

// Shown where a send/issue was refused for needing an admin's approval
// (backend ApprovalsService.assertApproved): explains why and lets the user
// ask for it right there.
export function ApprovalRequiredNotice({ error }: { error: ApprovalRequiredError }) {
  const { t } = useLanguage();
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>(error.pendingRequestId ? 'sent' : 'idle');

  async function request() {
    setState('sending');
    const res = await apiFetch('/approvals', {
      method: 'POST',
      body: JSON.stringify({ documentType: error.documentType, documentId: error.documentId, note: note.trim() || undefined }),
    });
    setState(res.ok ? 'sent' : 'failed');
  }

  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-md p-3 text-sm">
      <p className="flex items-start gap-2 text-amber-900">
        <ShieldAlert size={16} className="shrink-0 mt-0.5" />
        {error.message}
      </p>
      {state === 'sent' ? (
        <p className="mt-2 text-amber-900">
          {t('approvals.requestSent')}{' '}
          <Link href="/approvals" className="font-semibold underline">
            {t('approvals.viewRequests')}
          </Link>
        </p>
      ) : (
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={t('approvals.notePlaceholder')}
            className="flex-1 border-2 border-amber-300 rounded-md px-2 py-1.5 text-sm bg-white outline-none focus:border-amber-500"
          />
          <button
            onClick={request}
            disabled={state === 'sending'}
            className="text-sm px-3 py-1.5 rounded-md bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50"
          >
            {t('approvals.requestButton')}
          </button>
        </div>
      )}
      {state === 'failed' && <p className="mt-1 text-xs text-red-700">{t('approvals.requestFailed')}</p>}
    </div>
  );
}
