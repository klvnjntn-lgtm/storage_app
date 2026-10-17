'use client';

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

type PickedVehicle = { id: string; plateNumber: string; vehicleModel: string; odometer?: number | null; customer: { name: string } };

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
  const [results, setResults] = useState<PickedVehicle[]>([]);
  const [form, setForm] = useState<WorkOrderFormValue>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opened from a vehicle's page: ?vehicleId=…
  const initialVehicleId = searchParams.get('vehicleId');
  useEffect(() => {
    if (!initialVehicleId) return;
    apiFetch(`/vehicles/${initialVehicleId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((v) => v && setVehicle(v))
      .catch(() => {});
  }, [initialVehicleId]);

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
        body: JSON.stringify({ vehicleId: vehicle.id, ...formToPayload(form), items: toPayloadLines(form.lines) }),
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
                        setVehicle(v);
                        setQuery('');
                        setResults([]);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                    >
                      <span className="font-medium">{v.plateNumber}</span>
                      <span className="text-gray-500"> · {v.vehicleModel} · {v.customer.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {vehicle && <WorkOrderForm value={form} onChange={setForm} vehicleOdometer={vehicle.odometer} />}

      <ErrorNote message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={() => router.back()}>
          {t('workshop.workOrders.cancel')}
        </button>
        <button type="button" className={btnPrimary} disabled={!vehicle || saving} onClick={save}>
          {saving ? t('workshop.workOrders.saving') : t('workshop.workOrders.create')}
        </button>
      </div>
    </PageFrame>
  );
}
