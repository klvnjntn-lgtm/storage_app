'use client';

import { useEffect, useState } from 'react';
import { X, PauseCircle, PlayCircle, Check } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { downloadResponse } from '@/lib/download';
import ExportPasswordForm from '@/app/components/org-transfer/ExportPasswordForm';
import { useLanguage } from '@/app/context/LanguageContext';
import DatePicker from '@/app/components/shared/DatePicker';
import { parseCalendarDate, toCalendarDateString } from '@/lib/dates';
import {
  MODULE_KEYS,
  PLAN_KEYS,
  formatDate,
  formatDateTime,
  moduleIsOn,
  platformCall,
  type ModuleKey,
  type PlatformAuditEntry,
  type PlatformOrgDetail,
  type PlatformResult,
} from './api';

type Billing = { plan: string; seatLimit: string; paidUntil: string; trialEndsAt: string; billingNote: string };

function billingOf(org: PlatformOrgDetail): Billing {
  return {
    plan: org.plan,
    seatLimit: String(org.seatLimit),
    paidUntil: org.paidUntil ? toCalendarDateString(parseCalendarDate(org.paidUntil)) : '',
    trialEndsAt: org.trialEndsAt ? toCalendarDateString(new Date(org.trialEndsAt)) : '',
    billingNote: org.billingNote ?? '',
  };
}

// "YYYY-MM-DD" plus whole months, starting from today when the date is
// empty or already past (renewing a lapsed customer starts from now).
function extend(date: string, months: number) {
  const today = toCalendarDateString(new Date());
  const from = date && date >= today ? parseCalendarDate(date) : new Date();
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  return toCalendarDateString(d);
}

export default function OrganizationDetail({
  id,
  ownOrganizationId,
  onClose,
  onChanged,
  onLocked,
}: {
  id: string;
  ownOrganizationId: string | undefined;
  onClose: () => void;
  onChanged: () => void;
  onLocked: () => void;
}) {
  const { t, language } = useLanguage();
  const [org, setOrg] = useState<PlatformOrgDetail | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [wa, setWa] = useState({ amount: '', note: '' });

  // Shared handling for every call: a lapsed unlock goes back to the
  // unlock screen; anything else shows the backend's message.
  function failed<T>(r: PlatformResult<T>): r is Extract<PlatformResult<T>, { ok: false }> {
    if (r.ok) return false;
    if (r.code === 'PLATFORM_LOCKED') onLocked();
    else if (r.status === 0) setError(t('platform.couldNotReachServer'));
    else setError(r.message || t('platform.requestFailed', { status: r.status }));
    return true;
  }

  async function load() {
    const r = await platformCall<PlatformOrgDetail>(`/organizations/${id}`);
    if (failed(r)) return;
    setOrg(r.data);
    setBilling(billingOf(r.data));
  }

  useEffect(() => {
    // load() only sets state after its fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function act(key: string, path: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    setSaved(false);
    const r = await platformCall(path, init);
    setBusy(null);
    if (failed(r)) return false;
    await load();
    onChanged();
    return true;
  }

  async function saveBilling(e: React.FormEvent) {
    e.preventDefault();
    if (!org || !billing) return;
    // Only what changed, so the audit log records only real changes.
    const was = billingOf(org);
    const body: Record<string, unknown> = {};
    if (billing.plan.trim() !== was.plan) body.plan = billing.plan.trim();
    if (billing.seatLimit !== was.seatLimit) body.seatLimit = Number(billing.seatLimit);
    if (billing.paidUntil !== was.paidUntil) body.paidUntil = billing.paidUntil || null;
    if (billing.trialEndsAt !== was.trialEndsAt) body.trialEndsAt = billing.trialEndsAt || null;
    if (billing.billingNote.trim() !== was.billingNote) body.billingNote = billing.billingNote.trim() || null;
    if (Object.keys(body).length === 0) return;
    if (await act('billing', `/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(body) })) {
      setSaved(true);
    }
  }

  // Goodwill credit or a correction to the org's WhatsApp balance.
  async function adjustWa(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(wa.amount.replace(/[^\d.-]/g, ''));
    if (!amount) return;
    if (await act('wa', `/organizations/${id}/wa-balance`, { method: 'POST', body: JSON.stringify({ amount, note: wa.note.trim() }) })) {
      setWa({ amount: '', note: '' });
    }
  }

  function toggleModule(module: ModuleKey, on: boolean) {
    act(`module-${module}`, `/organizations/${id}/modules/${module}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !on }),
    });
  }

  // A file download, so not platformCall (which reads JSON).
  async function exportOrg(password: string) {
    setBusy('export');
    setError(null);
    try {
      const res = await apiFetch(`/platform/organizations/${id}/export`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        await downloadResponse(res, 'business.wsexport');
        await load();
        return;
      }
      const body = await res.json().catch(() => null);
      failed({ ok: false, status: res.status, message: String(body?.message ?? ''), code: body?.code });
    } finally {
      setBusy(null);
    }
  }

  async function suspend() {
    if (!org || !reason.trim()) return;
    if (!confirm(t('platform.detail.confirmSuspend', { name: org.name }))) return;
    if (
      await act('suspend', `/organizations/${id}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      })
    ) {
      setReason('');
    }
  }

  function reactivate() {
    act('reactivate', `/organizations/${id}/reactivate`, { method: 'POST' });
  }

  const label = 'block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1';
  const input = 'w-full border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm';
  const section = 'bg-white border border-gray-200 rounded-xl p-4 space-y-3';
  const isOwnOrg = id === ownOrganizationId;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button aria-label={t('common.close')} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-xl h-full overflow-y-auto bg-gray-50 shadow-xl">
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-gray-200 px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-lg truncate">{org?.name ?? t('common.loading')}</h2>
            {org && (
              <p className="text-xs text-gray-500">
                {t('platform.createdOn', { date: formatDate(org.createdAt, language) })}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="p-1.5 rounded-md hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>
          )}

          {org && billing && (
            <>
              <form onSubmit={saveBilling} className={section}>
                <h3 className="text-sm font-semibold">{t('platform.detail.billing')}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={label}>{t('platform.detail.plan')}</span>
                    <select
                      value={billing.plan}
                      onChange={(e) => setBilling({ ...billing, plan: e.target.value })}
                      className={input}
                    >
                      {PLAN_KEYS.map((p) => (
                        <option key={p} value={p}>
                          {t(`billing.plan.${p}`)}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-gray-500">{t('platform.detail.planHint')}</span>
                  </label>
                  <label className="block">
                    <span className={label}>{t('platform.detail.seatLimit')}</span>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      required
                      value={billing.seatLimit}
                      onChange={(e) => setBilling({ ...billing, seatLimit: e.target.value })}
                      className={input}
                    />
                    <span className="text-[11px] text-gray-500">
                      {t('platform.detail.seatsInUse', { used: org.seatsUsed })}
                    </span>
                  </label>
                </div>
                <div>
                  <span className={label}>{t('platform.detail.paidUntil')}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <DatePicker
                      clearable
                      value={billing.paidUntil}
                      onChange={(v) => setBilling({ ...billing, paidUntil: v })}
                      className="w-44"
                    />
                    <button
                      type="button"
                      onClick={() => setBilling({ ...billing, paidUntil: extend(billing.paidUntil, 1) })}
                      className="text-xs font-medium border border-gray-300 rounded-full px-3 py-1.5 hover:bg-gray-50"
                    >
                      {t('platform.detail.addMonth')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBilling({ ...billing, paidUntil: extend(billing.paidUntil, 12) })}
                      className="text-xs font-medium border border-gray-300 rounded-full px-3 py-1.5 hover:bg-gray-50"
                    >
                      {t('platform.detail.addYear')}
                    </button>
                  </div>
                </div>
                {billing.plan === 'trial' && (
                  <div>
                    <span className={label}>{t('platform.detail.trialEndsAt')}</span>
                    <DatePicker
                      clearable
                      value={billing.trialEndsAt}
                      onChange={(v) => setBilling({ ...billing, trialEndsAt: v })}
                      className="w-44"
                    />
                  </div>
                )}
                <label className="block">
                  <span className={label}>{t('platform.detail.billingNote')}</span>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={billing.billingNote}
                    onChange={(e) => setBilling({ ...billing, billingNote: e.target.value })}
                    className={input}
                  />
                  <span className="text-[11px] text-gray-500">{t('platform.detail.billingNoteHint')}</span>
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={busy === 'billing'}
                    className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2 disabled:opacity-50"
                  >
                    {busy === 'billing' ? t('common.saving') : t('platform.detail.save')}
                  </button>
                  {saved && (
                    <span className="flex items-center gap-1 text-sm text-green-700">
                      <Check size={14} /> {t('platform.detail.saved')}
                    </span>
                  )}
                </div>
              </form>

              <form onSubmit={adjustWa} className={section}>
                <h3 className="text-sm font-semibold">{t('platform.detail.waTitle')}</h3>
                <p className="text-sm">
                  {t('platform.detail.waBalance')}: <span className="font-semibold tabular-nums">Rp {Number(org.waBalance ?? 0).toLocaleString('id-ID')}</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={label}>{t('platform.detail.waAmount')}</span>
                    <input inputMode="decimal" required value={wa.amount} onChange={(e) => setWa({ ...wa, amount: e.target.value })} className={input} placeholder="50000 / -10000" />
                  </label>
                  <label className="block">
                    <span className={label}>{t('platform.detail.waNote')}</span>
                    <input required maxLength={500} value={wa.note} onChange={(e) => setWa({ ...wa, note: e.target.value })} className={input} />
                  </label>
                </div>
                <button disabled={busy === 'wa'} className="text-sm font-semibold bg-blue-600 text-white rounded-md px-3 py-1.5 disabled:opacity-50">
                  {t('platform.detail.waApply')}
                </button>
              </form>

              <div className={section}>
                <h3 className="text-sm font-semibold">{t('platform.detail.modules')}</h3>
                <ul className="divide-y divide-gray-100">
                  {MODULE_KEYS.map((key) => {
                    const row = org.modules.find((m) => m.module === key);
                    const on = !!row && moduleIsOn(row);
                    return (
                      <li key={key} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm">{t(`platform.modules.${key}`)}</p>
                          {on && row?.expiresAt && (
                            <p className="text-[11px] text-gray-500">
                              {t('platform.detail.moduleExpires', { date: formatDate(row.expiresAt, language) })}
                            </p>
                          )}
                        </div>
                        <button
                          role="switch"
                          aria-checked={on}
                          aria-label={t(`platform.modules.${key}`)}
                          disabled={busy === `module-${key}`}
                          onClick={() => toggleModule(key, on)}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
                            on ? 'bg-blue-600' : 'bg-gray-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
                              on ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className={section}>
                <h3 className="text-sm font-semibold">{t('orgTransfer.platform.exportTitle', { name: org.name })}</h3>
                <p className="text-xs text-gray-500">{t('orgTransfer.platform.exportHelp')}</p>
                <ExportPasswordForm busy={busy === 'export'} onExport={exportOrg} />
              </div>

              <div className={section}>
                <h3 className="text-sm font-semibold">{t('platform.detail.suspension')}</h3>
                {org.suspendedAt ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                        <PauseCircle size={15} />
                        {t('platform.detail.suspendedSince', { date: formatDate(org.suspendedAt, language) })}
                      </p>
                      {org.suspendedReason && (
                        <p className="text-sm text-amber-900 mt-1 whitespace-pre-line break-words">
                          {org.suspendedReason}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={reactivate}
                      disabled={busy === 'reactivate'}
                      className="flex items-center gap-1.5 bg-green-600 text-white text-sm font-medium rounded-md px-3 py-2 disabled:opacity-50"
                    >
                      <PlayCircle size={15} />
                      {busy === 'reactivate' ? t('platform.detail.reactivating') : t('platform.detail.reactivate')}
                    </button>
                  </div>
                ) : isOwnOrg ? (
                  <p className="text-sm text-gray-600">{t('platform.detail.ownOrgHint')}</p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">{t('platform.detail.activeHint')}</p>
                    <label className="block">
                      <span className={label}>{t('platform.detail.suspendReason')}</span>
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={t('platform.detail.suspendReasonPlaceholder')}
                        className={input}
                      />
                    </label>
                    <button
                      onClick={suspend}
                      disabled={busy === 'suspend' || !reason.trim()}
                      className="flex items-center gap-1.5 border border-red-300 bg-red-50 text-red-700 text-sm font-medium rounded-md px-3 py-2 disabled:opacity-50"
                    >
                      <PauseCircle size={15} />
                      {busy === 'suspend' ? t('platform.detail.suspending') : t('platform.detail.suspend')}
                    </button>
                  </div>
                )}
              </div>

              <div className={section}>
                <h3 className="text-sm font-semibold">
                  {t('platform.detail.users')} <span className="text-gray-400 font-normal">{org.users.length}</span>
                </h3>
                {org.users.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('platform.detail.noUsers')}</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {org.users.map((u) => (
                      <li key={u.id} className="py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm truncate">{u.displayName || u.email}</p>
                          {u.displayName && <p className="text-xs text-gray-500 truncate">{u.email}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs">
                            {t(`admin.members.role.${u.role}`)}
                            {!u.active && <span className="ml-1 text-red-600">· {t('platform.detail.inactive')}</span>}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            {u.lastActiveAt ? formatDateTime(u.lastActiveAt, language) : t('platform.never')}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className={section}>
                <h3 className="text-sm font-semibold">{t('platform.detail.history')}</h3>
                {org.recentAudit.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('platform.detail.noHistory')}</p>
                ) : (
                  <ul className="space-y-2">
                    {org.recentAudit.map((entry) => (
                      <AuditRow key={entry.id} entry={entry} />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: PlatformAuditEntry }) {
  const { t, language } = useLanguage();
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDate(v, language, true);
    return String(v);
  };

  let detail = '';
  if (entry.action === 'organization.update' && entry.after) {
    detail = Object.keys(entry.after)
      .map((k) => `${t(`platform.detail.${k}`)}: ${show(entry.before?.[k])} → ${show(entry.after?.[k])}`)
      .join(' · ');
  } else if (entry.action.startsWith('module.') && entry.after?.module) {
    detail = t(`platform.modules.${String(entry.after.module)}`);
  } else if (entry.action === 'organization.suspend') {
    detail = show(entry.after?.suspendedReason);
  }

  return (
    <li className="text-sm border-l-2 border-gray-200 pl-3">
      <p>
        <span className="font-medium">{t(`platform.audit.${entry.action.replace('.', '_')}`)}</span>
        {detail && <span className="text-gray-600"> — {detail}</span>}
      </p>
      <p className="text-[11px] text-gray-500">
        {formatDateTime(entry.createdAt, language)} · {entry.actorEmail}
      </p>
    </li>
  );
}
