'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ClipboardList, Receipt, Play, Pause, CheckCircle2, XCircle, RotateCcw, Printer, ThumbsUp, Lightbulb, Link2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { PageFrame, Card, ErrorNote, btnPrimary, btnSecondary, btnDanger } from '@/app/components/shared/PageFrame';
import WorkOrderForm, { VehicleBadge, formToPayload, type WorkOrderFormValue } from '@/app/components/workshop/WorkOrderForm';
import Recommendations from '@/app/components/workshop/Recommendations';
import {
  statusStyle,
  toDraftLines,
  toPayloadLines,
  type WorkOrder,
  type WorkOrderStatus,
} from '@/app/components/workshop/workOrders';
import { lineProblem } from '@/app/components/workshop/lineProblem';
import { useDialog } from '@/app/components/shared/DialogProvider';

function toForm(wo: WorkOrder): WorkOrderFormValue {
  return {
    mechanicId: wo.mechanicId ?? '',
    odometer: wo.odometer != null ? String(wo.odometer) : '',
    complaint: wo.complaint ?? '',
    notes: wo.notes ?? '',
    lines: toDraftLines(wo.items),
  };
}

function errorText(body: { message?: string | string[] } | null, fallback: string) {
  if (Array.isArray(body?.message)) return body.message.join(', ');
  return body?.message ?? fallback;
}

export default function WorkOrderDetailPage() {
  const dialog = useDialog();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLanguage();

  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [form, setForm] = useState<WorkOrderFormValue | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: WorkOrder) => {
    setWo(next);
    setForm(toForm(next));
    setDirty(false);
  }, []);

  useEffect(() => {
    apiFetch(`/work-orders/${params.id}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) setError(errorText(body, t('workshop.workOrders.loadFailed')));
        else apply(body);
      })
      .catch(() => setError(t('workshop.workOrders.serverError')));
  }, [params.id, apply, t]);

  async function call(path: string, method: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, { method, body: payload ? JSON.stringify(payload) : undefined });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorText(body, t('workshop.workOrders.saveFailed')));
        return null;
      }
      return body;
    } catch {
      setError(t('workshop.workOrders.serverError'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form) return;
    const problem = lineProblem(form.lines, t);
    if (problem) {
      setError(problem);
      return;
    }
    const next = await call(`/work-orders/${params.id}`, 'PATCH', { ...formToPayload(form), items: toPayloadLines(form.lines) });
    if (next) apply(next);
  }

  async function setStatus(status: WorkOrderStatus) {
    if (status === 'CANCELLED' && !(await dialog.confirm(t('workshop.workOrders.cancelConfirm'), { danger: true }))) return;
    const next = await call(`/work-orders/${params.id}/status`, 'PATCH', { status });
    if (next) apply(next);
  }

  async function approve() {
    const note = await dialog.prompt(t('workshop.workOrders.approvePrompt'), {
      confirmLabel: t('workshop.workOrders.approve'),
    });
    if (note === null) return;
    const next = await call(`/work-orders/${params.id}/approve`, 'POST', { note });
    if (next) apply(next);
  }

  // The customer approves on their phone; staff paste the link by hand.
  const [linkNote, setLinkNote] = useState<string | null>(null);
  async function copyApprovalLink() {
    const result = await call(`/work-orders/${params.id}/approval-link`, 'POST');
    if (!result?.token) return;
    const url = `${window.location.origin}/estimate/${result.token}`;
    const until = formatDMY(new Date(result.expiresAt));
    try {
      await navigator.clipboard.writeText(url);
      setLinkNote(t('workshop.workOrders.linkCopied', { date: until }));
    } catch {
      // No clipboard access (e.g. plain http): show it to copy by hand.
      await dialog.prompt(t('workshop.workOrders.linkManual'), { defaultValue: url });
    }
  }

  async function createInvoice() {
    if (dirty) {
      setError(t('workshop.workOrders.saveFirst'));
      return;
    }
    const result = await call(`/work-orders/${params.id}/invoice`, 'POST', {});
    if (result?.invoiceId) router.push(`/sales/invoices/new?draftId=${result.invoiceId}`);
  }

  if (!wo || !form) {
    return (
      <PageFrame icon={ClipboardList} title={t('workshop.workOrders.title')}>
        {error ? <ErrorNote message={error} /> : <p className="text-sm text-gray-500">{t('workshop.workOrders.loading')}</p>}
      </PageFrame>
    );
  }

  const locked = !!wo.invoicedId || wo.status === 'CANCELLED';
  const liveInvoice = wo.invoices.find((i) => i.id === wo.invoicedId);

  const isEstimate = wo.status === 'ESTIMATE';
  // Approved later than check-in, i.e. it started as an estimate.
  const approvedLater =
    !!wo.approvedAt && new Date(wo.approvedAt).getTime() - new Date(wo.createdAt).getTime() > 60_000;
  const source = wo.followedUp[0];

  // The next sensible moves from each status; DONE can still be reopened.
  // An estimate moves on only by approval (its own button).
  const transitions: { to: WorkOrderStatus; label: string; icon: typeof Play }[] =
    isEstimate
      ? []
      : wo.status === 'QUEUED'
      ? [{ to: 'IN_PROGRESS', label: t('workshop.workOrders.start'), icon: Play }]
      : wo.status === 'IN_PROGRESS'
        ? [
            { to: 'WAITING_PARTS', label: t('workshop.workOrders.waitParts'), icon: Pause },
            { to: 'DONE', label: t('workshop.workOrders.finish'), icon: CheckCircle2 },
          ]
        : wo.status === 'WAITING_PARTS'
          ? [{ to: 'IN_PROGRESS', label: t('workshop.workOrders.resume'), icon: Play }]
          : wo.status === 'DONE'
            ? [{ to: 'IN_PROGRESS', label: t('workshop.workOrders.reopen'), icon: RotateCcw }]
            : [{ to: 'QUEUED', label: t('workshop.workOrders.reopen'), icon: RotateCcw }];

  return (
    <PageFrame
      icon={ClipboardList}
      title={wo.number}
      subtitle={`${wo.vehicle.plateNumber} · ${wo.customer.name}`}
      actions={
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-md border font-medium ${statusStyle(wo.status)}`}>
            {t(`workshop.workOrders.status.${wo.status}`)}
          </span>
          {/* Prints the saved job — unsaved edits aren't on it. */}
          <Link href={`/workshop/work-orders/${wo.id}/print`} className={btnSecondary}>
            <Printer size={14} />
            {isEstimate ? t('workshop.workOrders.printEstimate') : t('workshop.workOrders.printSpk')}
          </Link>
        </div>
      }
    >
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Link href={`/workshop/vehicles/${wo.vehicleId}`} className="hover:underline min-w-0">
            <VehicleBadge plate={wo.vehicle.plateNumber} model={wo.vehicle.vehicleModel} customer={wo.customer.name} />
          </Link>
          <div className="text-xs text-gray-500 flex gap-3 flex-wrap">
            <span>{t('workshop.workOrders.checkedIn', { date: formatDMY(new Date(wo.createdAt)) })}</span>
            {approvedLater && (
              <span>
                {t('workshop.workOrders.approvedOn', { date: formatDMY(new Date(wo.approvedAt!)) })}
                {wo.approvalNote && ` · ${wo.approvalNote}`}
              </span>
            )}
            {wo.completedAt && <span>{t('workshop.workOrders.finishedOn', { date: formatDMY(new Date(wo.completedAt)) })}</span>}
          </div>
        </div>
        {isEstimate && linkNote && <p className="mt-3 text-sm text-green-800">{linkNote}</p>}
        {isEstimate && (
          <p className="mt-3 text-sm text-purple-800 bg-purple-50 border border-purple-200 rounded-md px-3 py-2">
            {t('workshop.workOrders.estimateHint')}
          </p>
        )}
        {source && (
          <p className="mt-3 text-sm text-gray-700 flex items-start gap-1.5">
            <Lightbulb size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              {source.sourceWorkOrder ? (
                <>
                  {t('workshop.workOrders.followUpOf')}{' '}
                  <Link className="underline" href={`/workshop/work-orders/${source.sourceWorkOrder.id}`}>
                    {source.sourceWorkOrder.number}
                  </Link>
                  {': '}
                </>
              ) : (
                `${t('workshop.workOrders.fromReminder')}: `
              )}
              {source.note}
            </span>
          </p>
        )}
        {!wo.invoicedId && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
            {isEstimate && (
              <button type="button" className={btnPrimary} disabled={busy || dirty} onClick={approve}>
                <ThumbsUp size={14} />
                {t('workshop.workOrders.approve')}
              </button>
            )}
            {isEstimate && (
              <button type="button" className={btnSecondary} disabled={busy || dirty} onClick={copyApprovalLink}>
                <Link2 size={14} />
                {t('workshop.workOrders.copyLink')}
              </button>
            )}
            {transitions.map(({ to, label, icon: Icon }) => (
              <button key={to} type="button" className={btnSecondary} disabled={busy || dirty} onClick={() => setStatus(to)}>
                <Icon size={14} />
                {label}
              </button>
            ))}
            {wo.status !== 'CANCELLED' && (
              <button type="button" className={btnDanger} disabled={busy} onClick={() => setStatus('CANCELLED')}>
                <XCircle size={14} />
                {isEstimate ? t('workshop.workOrders.decline') : t('workshop.workOrders.cancelJob')}
              </button>
            )}
          </div>
        )}
      </Card>

      {liveInvoice && (
        <div className="flex items-center justify-between gap-3 bg-violet-50 border border-violet-200 text-violet-800 text-sm rounded-md px-3 py-2">
          <span className="flex items-center gap-1.5">
            <Receipt size={14} />
            {t('workshop.workOrders.invoicedAs', { number: liveInvoice.invoiceNumber ?? t('workshop.workOrders.draft') })}
          </span>
          <Link
            className="font-medium underline"
            href={liveInvoice.status === 'DRAFT' ? `/sales/invoices/new?draftId=${liveInvoice.id}` : `/sales/invoices/${liveInvoice.id}`}
          >
            {t('workshop.workOrders.openInvoice')}
          </Link>
        </div>
      )}

      <WorkOrderForm
        value={form}
        readOnly={locked}
        vehicleOdometer={wo.vehicle.odometer}
        onChange={(next) => {
          setForm(next);
          setDirty(true);
        }}
      />

      {/* Only the list is refreshed — unsaved edits to the job stay. */}
      <Recommendations
        workOrderId={wo.id}
        vehicleId={wo.vehicleId}
        items={wo.recommendations}
        onChange={(next) => setWo((prev) => (prev ? { ...prev, recommendations: next.recommendations } : prev))}
      />

      <ErrorNote message={error} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {t('workshop.workOrders.estimate')}{' '}
          <span className="font-semibold text-gray-900">{formatIDR(Number(wo.estimatedTotal))}</span>
          {dirty && <span className="text-xs text-amber-700 ml-2">{t('workshop.workOrders.unsaved')}</span>}
        </p>
        {!locked && (
          <div className="flex gap-2 justify-end">
            <button type="button" className={btnSecondary} disabled={busy || !dirty} onClick={save}>
              {busy ? t('workshop.workOrders.saving') : t('workshop.workOrders.save')}
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || form.lines.length === 0 || isEstimate}
              title={isEstimate ? t('workshop.workOrders.approveFirst') : undefined}
              onClick={createInvoice}
            >
              <Receipt size={14} />
              {t('workshop.workOrders.createInvoice')}
            </button>
          </div>
        )}
      </div>
    </PageFrame>
  );
}
