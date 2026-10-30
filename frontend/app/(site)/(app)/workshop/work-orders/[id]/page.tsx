'use client';

import { SendDocumentDialog } from '@/app/components/messaging/SendDocumentDialog';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ClipboardList, Receipt, Play, Pause, CheckCircle2, XCircle, RotateCcw, Printer, Lightbulb, Wrench, MessageCircle, FileText, FilePlus2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { PageFrame, Card, ErrorNote, btnPrimary, btnSecondary, btnDanger } from '@/app/components/shared/PageFrame';
import { isOdometerBelowLast } from '@/lib/odometer';
import WorkOrderForm, { VehicleBadge, formToPayload, type WorkOrderFormValue } from '@/app/components/workshop/WorkOrderForm';
import Recommendations from '@/app/components/workshop/Recommendations';
import WorkOrderParts from '@/app/components/workshop/WorkOrderParts';
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
    branchId: wo.branchId ?? '',
    // A DATE column arrives as midnight UTC; the date part is the date.
    validUntil: wo.validUntil ? wo.validUntil.slice(0, 10) : '',
    customerPoNumber: wo.customerPoNumber ?? '',
    paymentTerms: wo.paymentTerms ?? '',
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

  const [readyOpen, setReadyOpen] = useState(false);
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

  // Parts found mid-job are quoted on a further quotation linked to the job's own; converting it adds
  // its lines here.
  async function additionalQuotation(originalId: string) {
    const addition = await call(`/sales-quotations/${originalId}/additions`, 'POST');
    if (addition?.id) router.push(`/sales/quotations/new?draftId=${addition.id}`);
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

  const source = wo.followedUp[0];
  // The quotation the job was made from (the others are its additions).
  const originalQuotation = wo.quotations?.find((q) => !q.parentQuotationId) ?? null;

  // The next sensible moves from each status; DONE can still be reopened.
  const transitions: { to: WorkOrderStatus; label: string; icon: typeof Play }[] =
    wo.status === 'QUEUED'
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
          {/* The parts catalogue on this car; each part found can be added to the job. */}
          {!locked && (
            <Link
              href={`/workshop/parts?${new URLSearchParams({
                workOrderId: wo.id,
                ...(wo.vehicle.carBrand && wo.vehicle.carModel
                  ? {
                      brand: wo.vehicle.carBrand,
                      model: wo.vehicle.carModel,
                      ...(wo.vehicle.carYear ? { year: String(wo.vehicle.carYear) } : {}),
                    }
                  : { plate: wo.vehicle.plateNumber }),
              }).toString()}`}
              className={btnSecondary}
            >
              <Wrench size={14} />
              {t('workshop.workOrders.findParts')}
            </Link>
          )}
          {/* Prints the saved job — unsaved edits aren't on it. */}
          <Link href={`/workshop/work-orders/${wo.id}/print`} className={btnSecondary}>
            <Printer size={14} />
            {t('workshop.workOrders.printSpk')}
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
            {wo.approvalNote && <span>{wo.approvalNote}</span>}
            {wo.completedAt && <span>{t('workshop.workOrders.finishedOn', { date: formatDMY(new Date(wo.completedAt)) })}</span>}
          </div>
        </div>
        {wo.comebackOf && (
          <p className="mt-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2 flex items-start gap-1.5">
            <RotateCcw size={14} className="mt-0.5 shrink-0" />
            <span>
              <Link className="underline" href={`/workshop/work-orders/${wo.comebackOf.id}`}>
                {t('workshop.workOrders.comebackOfBadge', { number: wo.comebackOf.number })}
              </Link>
              {wo.comebackOf.mechanic && ` · ${wo.comebackOf.mechanic.name}`}
              {wo.comebackReason && ` — ${wo.comebackReason}`}
            </span>
          </p>
        )}
        {(wo.comebacks?.length ?? 0) > 0 && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-1.5">
            <RotateCcw size={14} className="mt-0.5 shrink-0" />
            <span>
              {t('workshop.workOrders.comebacksBadge', { numbers: '' })}
              {wo.comebacks!.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ', '}
                  <Link className="underline" href={`/workshop/work-orders/${c.id}`}>
                    {c.number}
                  </Link>
                </span>
              ))}
            </span>
          </p>
        )}
        {wo.status === 'DONE' && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={btnSecondary} onClick={() => setReadyOpen(true)}>
              <MessageCircle size={14} />
              {t('workshop.workOrders.tellReady')}
            </button>
            {wo.readyNotifiedAt && (
              <span className="text-xs text-gray-500">
                {t('workshop.workOrders.toldReady', { date: formatDMY(new Date(wo.readyNotifiedAt)) })}
              </span>
            )}
            {/* The car is back for the same problem: a new job that counts as a comeback of this one. */}
            <Link href={`/workshop/work-orders/new?vehicleId=${wo.vehicleId}&comebackOf=${wo.id}`} className={btnSecondary}>
              <RotateCcw size={14} />
              {t('workshop.workOrders.cameBack')}
            </Link>
          </div>
        )}
        {(wo.quotations?.length ?? 0) > 0 && (
          <p className="mt-3 text-sm text-gray-700 flex flex-wrap items-center gap-x-1.5">
            <FileText size={14} className="shrink-0 text-blue-700" />
            {t('workshop.workOrders.fromQuotations')}
            {wo.quotations!.map((q, i) => (
              <span key={q.id}>
                {i > 0 && ', '}
                <Link className="underline" href={`/sales/quotations/${q.id}`}>
                  {q.quotationNumber ?? '—'}
                </Link>
                {q.parentQuotationId && ` (${t('workshop.workOrders.addition')}, ${q.status})`}
              </span>
            ))}
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
            {transitions.map(({ to, label, icon: Icon }) => (
              <button key={to} type="button" className={btnSecondary} disabled={busy || dirty} onClick={() => setStatus(to)}>
                <Icon size={14} />
                {label}
              </button>
            ))}
            {wo.status !== 'CANCELLED' && (
              <button type="button" className={btnDanger} disabled={busy} onClick={() => setStatus('CANCELLED')}>
                <XCircle size={14} />
                {t('workshop.workOrders.cancelJob')}
              </button>
            )}
            {originalQuotation && wo.status !== 'CANCELLED' && (
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => additionalQuotation(originalQuotation.id)}>
                <FilePlus2 size={14} />
                {t('sales.quotationWorkshop.additionalQuotation')}
              </button>
            )}
          </div>
        )}
      </Card>

      {/* Invoices made from this job (voided ones too) — same box as the
          quotation and sales order pages. */}
      {wo.invoices.length > 0 && (
        <div className="border-2 border-purple-200 bg-purple-50/50 rounded-md p-3 text-sm">
          <p className="font-semibold text-purple-900 mb-1">{t('workshop.workOrders.relatedDocuments')}</p>
          {wo.invoices.map((inv) => (
            <p key={inv.id}>
              {t('workshop.workOrders.invoiceLabel')}{' '}
              <Link
                className="underline font-medium"
                href={inv.status === 'DRAFT' ? `/sales/invoices/new?draftId=${inv.id}` : `/sales/invoices/${inv.id}`}
              >
                {inv.invoiceNumber ?? t('workshop.workOrders.draft')}
              </Link>{' '}
              — {inv.status}
            </p>
          ))}
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

      {/* Saved lines only: re-mounted when a save replaces them (new line ids). Ordering or receiving
          parts can change the status — only that is refreshed, so unsaved edits stay. */}
      <WorkOrderParts
        key={wo.items.map((i) => i.id).join()}
        workOrderId={wo.id}
        plate={wo.vehicle.plateNumber}
        model={wo.vehicle.vehicleModel}
        locked={locked}
        onStatusChange={() =>
          apiFetch(`/work-orders/${wo.id}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((fresh: WorkOrder | null) => fresh && setWo((prev) => (prev ? { ...prev, status: fresh.status } : prev)))
            .catch(() => {})
        }
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
            <button type="button" className={btnSecondary} disabled={busy || !dirty || isOdometerBelowLast(form.odometer, wo.vehicle.odometer)} onClick={save}>
              {busy ? t('workshop.workOrders.saving') : t('workshop.workOrders.save')}
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || form.lines.length === 0}
              onClick={createInvoice}
            >
              <Receipt size={14} />
              {t('workshop.workOrders.createInvoice')}
            </button>
          </div>
        )}
      </div>
      {readyOpen && (
        <SendDocumentDialog
          title={t('workshop.workOrders.readyTitle', { customer: wo.customer.name })}
          endpoint={`/messaging/work-orders/${wo.id}/ready`}
          defaultPhone={wo.customer.phone}
          onClose={() => {
            setReadyOpen(false);
            // Only the "told on" date changes; unsaved edits on the form stay.
            apiFetch(`/work-orders/${wo.id}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((fresh: WorkOrder | null) => fresh && setWo((prev) => (prev ? { ...prev, readyNotifiedAt: fresh.readyNotifiedAt } : prev)))
              .catch(() => {});
          }}
        />
      )}
    </PageFrame>
  );
}
