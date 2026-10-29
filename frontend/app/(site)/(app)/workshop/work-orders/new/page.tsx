'use client';

import Link from 'next/link';
import { formatDMY } from '@/lib/dates';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { PageFrame, ErrorNote, btnPrimary, btnSecondary, inputCls } from '@/app/components/shared/PageFrame';
import WorkOrderForm, {
  EMPTY_FORM,
  VehicleBadge,
  formToPayload,
  usePosPricing,
  type WorkOrderFormValue,
} from '@/app/components/workshop/WorkOrderForm';
import { toPayloadLines, type DraftLine } from '@/app/components/workshop/workOrders';
import { DocumentHeader } from '@/app/components/shared/DocumentHeader';
import { LineItemsTable, type TableLine } from '@/app/components/shared/LineItemsTable';
import { describeSalesProduct, searchSalesProducts } from '@/app/components/shared/salesLineTable';
import { useLocations } from '@/app/components/shared/ProductPicker';
import { useWarehouseOps } from '@/lib/hooks/useWarehouseOps';
import { defaultLocation } from '@/lib/locations';
import { lineProblem } from '@/app/components/workshop/lineProblem';
import { isOdometerBelowLast } from '@/lib/odometer';

type PickedVehicle = { id: string; plateNumber: string; vehicleModel: string; odometer?: number | null; customer: { name: string } };
// /vehicles/search returns a flat customerName and no odometer.
type SearchResult = { id: string; plateNumber: string; vehicleModel: string; customerName: string };

let lineSeq = 0;
const newLineKey = () => `new-${++lineSeq}`;

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
  const locations = useLocations();
  // Only warehouse orgs pick where a part comes from; the rest use CENTRE.
  const warehouseOps = useWarehouseOps();
  // Without POS pricing a part is invoiced at the catalogue price, so its price can't be typed.
  const posPricing = usePosPricing();
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

  function setLines(lines: DraftLine[]) {
    setForm((f) => ({ ...f, lines }));
  }
  function updateLine(key: string, patch: Partial<DraftLine>) {
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? ({ ...l, ...patch } as DraftLine) : l)) }));
  }

  const linePrice = (l: DraftLine) => (l.kind === 'part' ? (l.unitPrice ?? l.catalogPrice ?? null) : l.unitPrice);
  const tableLines: TableLine[] = form.lines.map((l) =>
    l.kind === 'part'
      ? {
          key: l.key,
          kind: 'product',
          name: l.name,
          sub: l.sku,
          quantity: l.quantity,
          unit: null,
          unitPrice: linePrice(l),
          priceLocked: !posPricing,
          discountType: null,
          discountValue: null,
          discountAmount: 0,
          total: Math.round(l.quantity * (linePrice(l) ?? 0) * 100) / 100,
          extra: warehouseOps && (
            <select
              className="h-8 border border-gray-300 rounded-md px-2 text-xs bg-white outline-none focus:border-blue-500/60"
              value={l.locationId}
              aria-label={t('workshop.workOrders.location')}
              onChange={(e) => updateLine(l.key, { locationId: e.target.value })}
            >
              <option value="">{t('workshop.workOrders.pickLocation')}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          ),
        }
      : {
          key: l.key,
          kind: 'service',
          name: l.description,
          quantity: l.quantity,
          unit: null,
          unitPrice: l.unitPrice,
          discountType: null,
          discountValue: null,
          discountAmount: 0,
          total: Math.round(l.quantity * l.unitPrice * 100) / 100,
        },
  );
  const linesTotal = tableLines.reduce((sum, l) => sum + l.total, 0);

  const vehiclePicker = (
    <div className="mb-3">
      <label className="text-xs text-gray-500 mb-1 block">{t('workshop.workOrders.vehicle')}</label>
      {vehicle ? (
        <div className="flex items-center justify-between gap-3 border border-blue-500/20 rounded-lg bg-blue-600/5 px-3 py-[7px]">
          <VehicleBadge plate={vehicle.plateNumber} model={vehicle.vehicleModel} customer={vehicle.customer.name} />
          <button
            type="button"
            onClick={() => setVehicle(null)}
            aria-label={t('workshop.workOrders.changeVehicle')}
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50"
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
    </div>
  );

  return (
    <PageFrame icon={ClipboardList} title={t('workshop.workOrders.newTitle')} subtitle={t('workshop.workOrders.newSubtitle')}>
      {/* One document card: vehicle (and so the customer), mechanic and branch on top, the job's details,
          then its parts and labour. */}
      <div className="border border-blue-500/15 rounded-xl bg-white shadow-sm divide-y divide-blue-500/15">
        <DocumentHeader
          bare
          party={vehiclePicker}
          mechanic={{ value: form.mechanicId, onChange: (mechanicId) => setForm((f) => ({ ...f, mechanicId })) }}
          branch={{ value: form.branchId, onChange: (branchId) => setForm((f) => ({ ...f, branchId })) }}
        >
          {vehicle && pastJobs.length > 0 && (
            <div className="mb-3">
              <label className="text-xs text-gray-500 mb-1 block">{t('workshop.workOrders.comebackTitle')}</label>
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
            </div>
          )}
        </DocumentHeader>

        {vehicle && <WorkOrderForm inDocument value={form} onChange={setForm} vehicleOdometer={vehicle.odometer} />}

        <LineItemsTable
          bare
          hideUnit
          lines={tableLines}
          search={searchSalesProducts}
          // A job can wait for parts, so nothing is greyed out; the stock is shown.
          describe={(p) => describeSalesProduct(p, (qty) => t('common.lineTable.inStock', { qty }))}
          onPick={(p) =>
            setLines([
              ...form.lines,
              {
                kind: 'part',
                key: newLineKey(),
                productId: p.id,
                name: p.name,
                sku: p.sku,
                locationId: warehouseOps
                  ? locations.length === 1
                    ? locations[0].id
                    : ''
                  : (defaultLocation(locations)?.id ?? ''),
                quantity: 1,
                unitPrice: null,
                catalogPrice: p.sellingPrice,
              },
            ])
          }
          onChangeQty={(key, quantity) => updateLine(key, { quantity })}
          onChangePrice={(key, raw) => {
            const line = form.lines.find((l) => l.key === key);
            if (!line) return;
            updateLine(key, {
              unitPrice: raw === '' ? (line.kind === 'part' ? null : 0) : Math.max(0, Number(raw) || 0),
            });
          }}
          onChangeDescription={(key, description) => updateLine(key, { description })}
          onRemove={(key) => setLines(form.lines.filter((l) => l.key !== key))}
          onAddService={() =>
            setLines([...form.lines, { kind: 'labour', key: newLineKey(), description: '', quantity: 1, unitPrice: 0 }])
          }
          addServiceLabel={t('workshop.workOrders.addLabour')}
          totals={{ subtotal: linesTotal, discount: 0, total: linesTotal }}
        />
      </div>

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
