'use client';

import Link from 'next/link';
import { formatDMY } from '@/lib/dates';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { PageFrame, Card, ErrorNote, btnPrimary, btnSecondary, inputCls } from '@/app/components/shared/PageFrame';
import WorkOrderForm, {
  EMPTY_FORM,
  VehicleBadge,
  formToPayload,
  type WorkOrderFormValue,
} from '@/app/components/workshop/WorkOrderForm';
import { toPayloadLines } from '@/app/components/workshop/workOrders';
import { lineProblem } from '@/app/components/workshop/lineProblem';
import { isOdometerBelowLast } from '@/lib/odometer';

type PickedVehicle = { id: string; plateNumber: string; vehicleModel: string; odometer?: number | null; customer: { name: string } };
// /vehicles/search returns a flat customerName and no odometer.
type SearchResult = { id: string; plateNumber: string; vehicleModel: string; customerName: string };

// useSearchParams() needs a Suspense boundary (same as NewInvoicePage).
export default function NewWorkOrderPageWrapper() {
  return (
    <Suspense fallback={null}>
      <NewWorkOrderPage />
    </Suspense>
  );
}

function NewWorkOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const [vehicle, setVehicle] = useState<PickedVehicle | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [form, setForm] = useState<WorkOrderFormValue>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The car came back for the same problem: the earlier job this one redoes (?comebackOf=… from
  // that job's "Came back" button), counted against its mechanic in the performance report.
  const [comebackOfId, setComebackOfId] = useState<string>(() => searchParams.get('comebackOf') ?? '');
  const [comebackReason, setComebackReason] = useState('');
  const [pastJobs, setPastJobs] = useState<{ id: string; number: string; completedAt: string | null; mechanic: { name: string } | null }[]>([]);
  useEffect(() => {
    if (!vehicle) return;
    apiFetch(`/work-orders?${new URLSearchParams({ vehicleId: vehicle.id, status: 'DONE' })}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => setPastJobs(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [vehicle]);

  function loadVehicle(id: string) {
    apiFetch(`/vehicles/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((v) => v && setVehicle(v))
      .catch(() => {});
  }

  // Opened from a vehicle's page: ?vehicleId=…
  const initialVehicleId = searchParams.get('vehicleId');
  useEffect(() => {
    if (initialVehicleId) loadVehicle(initialVehicleId);
  }, [initialVehicleId]);

  // Started from recommended work (a vehicle reminder): ?reminderId=… —
  // its note becomes the complaint, and saving completes the reminder.
  const reminderId = searchParams.get('reminderId');
  const [reminderNote, setReminderNote] = useState<string | null>(null);
  useEffect(() => {
    if (!reminderId) return;
    apiFetch('/reminders')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: { id: string; note: string; status: string }[]) => {
        // Already done (e.g. a second tab) — start a plain job instead.
        const r = list.find((x) => x.id === reminderId && x.status === 'PENDING');
        if (!r) return;
        setReminderNote(r.note);
        setForm((f) => (f.complaint ? f : { ...f, complaint: r.note }));
      })
      .catch(() => {});
  }, [reminderId]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const res = await apiFetch(`/vehicles/search?q=${encodeURIComponent(q)}`).catch(() => null);
      if (!cancelled && res?.ok) setResults(await res.json());
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  async function save() {
    if (!vehicle) return;
    const problem = lineProblem(form.lines, t);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/work-orders', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: vehicle.id,
          ...formToPayload(form),
          items: toPayloadLines(form.lines),
          ...(reminderNote && reminderId && { fromReminderId: reminderId }),
          ...(comebackOfId && { comebackOfId, comebackReason: comebackReason.trim() || undefined }),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? t('workshop.workOrders.saveFailed')));
        return;
      }
      router.replace(`/workshop/work-orders/${body.id}`);
    } catch {
      setError(t('workshop.workOrders.serverError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageFrame icon={ClipboardList} title={t('workshop.workOrders.newTitle')} subtitle={t('workshop.workOrders.newSubtitle')}>
      <Card title={t('workshop.workOrders.vehicle')}>
        {vehicle ? (
          <div className="flex items-center justify-between gap-3">
            <VehicleBadge plate={vehicle.plateNumber} model={vehicle.vehicleModel} customer={vehicle.customer.name} />
            <button
              type="button"
              onClick={() => setVehicle(null)}
              aria-label={t('workshop.workOrders.changeVehicle')}
              className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-200 hover:bg-gray-50"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              className={`${inputCls} pl-8`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim()) setResults([]);
              }}
              placeholder={t('workshop.workOrders.vehicleSearch')}
            />
            {results.length > 0 && (
              <ul className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
                {results.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => {
                        loadVehicle(v.id);
                        setQuery('');
                        setResults([]);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                    >
                      <span className="font-medium">{v.plateNumber}</span>
                      <span className="text-gray-500"> · {v.vehicleModel} · {v.customerName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {vehicle && pastJobs.length > 0 && (
        <Card title={t('workshop.workOrders.comebackTitle')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select value={comebackOfId} onChange={(e) => setComebackOfId(e.target.value)} className={inputCls}>
              <option value="">{t('workshop.workOrders.notComeback')}</option>
              {pastJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.number}
                  {j.completedAt ? ` · ${formatDMY(new Date(j.completedAt))}` : ''}
                  {j.mechanic ? ` · ${j.mechanic.name}` : ''}
                </option>
              ))}
            </select>
            {comebackOfId && (
              <input
                value={comebackReason}
                onChange={(e) => setComebackReason(e.target.value)}
                maxLength={300}
                placeholder={t('workshop.workOrders.comebackReason')}
                className={inputCls}
              />
            )}
          </div>
        </Card>
      )}

      {vehicle && <WorkOrderForm value={form} onChange={setForm} vehicleOdometer={vehicle.odometer} />}

      <ErrorNote message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={() => router.back()}>
          {t('workshop.workOrders.cancel')}
        </button>
        {/* Needs the customer's go-ahead first: quote it — the quotation becomes this job later. */}
        <Link href="/sales/quotations/new" className={btnSecondary}>
          {t('workshop.workOrders.quoteFirst')}
        </Link>
        <button type="button" className={btnPrimary} disabled={!vehicle || saving || isOdometerBelowLast(form.odometer, vehicle.odometer)} onClick={save}>
          {saving ? t('workshop.workOrders.saving') : t('workshop.workOrders.create')}
        </button>
      </div>
    </PageFrame>
  );
}
