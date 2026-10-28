'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, Check, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, btnPrimary, btnSecondary, btnDanger, inputCls } from '@/app/components/shared/PageFrame';
import { isAdminRole } from '@/lib/roles';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Request = {
  id: string;
  documentType: 'PURCHASE_ORDER' | 'INVOICE';
  documentId: string;
  value: string;
  reason: string;
  note: string | null;
  status: Status;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  document: { number: string | null; total: number; party: string | null } | null;
};

const STATUS_STYLE: Record<Status, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-600',
};

export default function ApprovalsPage() {
  const { user } = useCurrentUser();
  const { t } = useLanguage();
  const isAdmin = isAdminRole(user?.role);

  const [status, setStatus] = useState<Status | ''>('PENDING');
  const [rows, setRows] = useState<Request[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ poApprovalThreshold: string; discountApprovalPercent: string } | null>(null);
  const [savedSettings, setSavedSettings] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/approvals${status ? `?status=${status}` : ''}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.message ?? t('approvals.loadFailed'));
    else setRows(body);
  }, [status, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const res = await apiFetch('/approvals/settings');
      if (!res.ok) return;
      const s = await res.json();
      setSettings({
        poApprovalThreshold: s.poApprovalThreshold?.toString() ?? '',
        discountApprovalPercent: s.discountApprovalPercent?.toString() ?? '',
      });
    })();
  }, [isAdmin]);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setError(null);
    const res = await apiFetch(`/approvals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ approve, note: notes[id]?.trim() || undefined }),
    });
    const body = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) setError(body?.message ?? t('approvals.decideFailed'));
    else load();
  }

  async function cancel(id: string) {
    setBusy(id);
    await apiFetch(`/approvals/${id}/cancel`, { method: 'POST' });
    setBusy(null);
    load();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, '')));
    const res = await apiFetch('/approvals/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        poApprovalThreshold: num(settings.poApprovalThreshold),
        discountApprovalPercent: num(settings.discountApprovalPercent),
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.message ?? t('approvals.settingsFailed'));
    else setSavedSettings(true);
  }

  const docLink = (r: Request) =>
    r.documentType === 'PURCHASE_ORDER' ? `/purchasing/purchase-orders/${r.documentId}` : `/sales/invoices/${r.documentId}`;

  return (
    <PageFrame icon={ShieldCheck} title={t('approvals.title')} subtitle={isAdmin ? t('approvals.subtitleAdmin') : t('approvals.subtitleStaff')}>
      <ErrorNote message={error} />

      <div className="flex flex-wrap gap-1.5">
        {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`text-sm px-3 py-1.5 rounded-full border ${status === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300'}`}
          >
            {s ? t(`approvals.status.${s}`) : t('approvals.all')}
          </button>
        ))}
      </div>

      {rows && rows.length === 0 && <p className="text-sm text-gray-500">{t('approvals.empty')}</p>}

      <div className="space-y-3">
        {rows?.map((r) => (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={docLink(r)} className="font-semibold text-blue-700 hover:underline">
                  {t(`approvals.docType.${r.documentType}`)} {r.document?.number ?? t('approvals.draft')}
                </Link>
                <p className="text-xs text-gray-500">
                  {r.document?.party ?? '—'} · {r.document ? formatIDR(r.document.total) : '—'} · {t('approvals.by', { name: r.requestedBy ?? '?' })} ·{' '}
                  {formatDMY(new Date(r.createdAt))}
                </p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>{t(`approvals.status.${r.status}`)}</span>
            </div>
            <p className="mt-2 text-sm">{r.reason}</p>
            {r.note && <p className="mt-1 text-sm text-gray-600 italic">“{r.note}”</p>}
            {r.decidedAt && (
              <p className="mt-1 text-xs text-gray-500">
                {t('approvals.decidedBy', { name: r.decidedBy ?? '?', date: formatDMY(new Date(r.decidedAt)) })}
                {r.decisionNote && ` — ${r.decisionNote}`}
              </p>
            )}

            {r.status === 'PENDING' && isAdmin && (
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <input
                  value={notes[r.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  placeholder={t('approvals.decisionNote')}
                  className={inputCls}
                />
                <div className="flex gap-2 shrink-0">
                  <button className={btnDanger} disabled={busy === r.id} onClick={() => decide(r.id, false)}>
                    <X size={14} /> {t('approvals.reject')}
                  </button>
                  <button className={btnPrimary} disabled={busy === r.id} onClick={() => decide(r.id, true)}>
                    <Check size={14} /> {t('approvals.approve')}
                  </button>
                </div>
              </div>
            )}
            {r.status === 'PENDING' && !isAdmin && (
              <button className={`${btnSecondary} mt-3`} disabled={busy === r.id} onClick={() => cancel(r.id)}>
                {t('approvals.withdraw')}
              </button>
            )}
          </Card>
        ))}
      </div>

      {isAdmin && settings && (
        <Card title={t('approvals.settingsTitle')}>
          <form onSubmit={saveSettings} className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">{t('approvals.poThreshold')}</span>
              <input
                inputMode="decimal"
                value={settings.poApprovalThreshold}
                onChange={(e) => {
                  setSavedSettings(false);
                  setSettings({ ...settings, poApprovalThreshold: e.target.value });
                }}
                placeholder={t('approvals.off')}
                className={inputCls}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">{t('approvals.discountThreshold')}</span>
              <input
                inputMode="decimal"
                value={settings.discountApprovalPercent}
                onChange={(e) => {
                  setSavedSettings(false);
                  setSettings({ ...settings, discountApprovalPercent: e.target.value });
                }}
                placeholder={t('approvals.off')}
                className={inputCls}
              />
            </label>
            <p className="sm:col-span-2 text-xs text-gray-500">{t('approvals.settingsHint')}</p>
            <div className="sm:col-span-2 flex items-center gap-3">
              <button className={btnPrimary}>{t('common.save')}</button>
              {savedSettings && <span className="text-sm text-green-700">{t('approvals.saved')}</span>}
            </div>
          </form>
        </Card>
      )}
    </PageFrame>
  );
}
