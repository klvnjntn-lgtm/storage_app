'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Car, Plus, Trash2, Wrench, Package, Building2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { ProductPicker, useLocations } from '@/app/components/shared/ProductPicker';
import { Card, inputCls } from '@/app/components/shared/PageFrame';
import type { DraftLine, Mechanic } from './workOrders';
import { useWarehouseOps } from '@/lib/hooks/useWarehouseOps';
import { defaultLocation } from '@/lib/locations';
import { useBranches } from '@/lib/hooks/useBranches';
import { isOdometerBelowLast } from '@/lib/odometer';

export type WorkOrderFormValue = {
  mechanicId: string;
  odometer: string;
  complaint: string;
  notes: string;
  // Multi-branch workshops: the branch doing the job ('' = default).
  branchId: string;
  // Formal-estimate details for fleet/company customers ('' = none).
  validUntil: string;
  customerPoNumber: string;
  paymentTerms: string;
  lines: DraftLine[];
};

export const EMPTY_FORM: WorkOrderFormValue = {
  mechanicId: '',
  odometer: '',
  complaint: '',
  notes: '',
  branchId: '',
  validUntil: '',
  customerPoNumber: '',
  paymentTerms: '',
  lines: [],
};

let keySeq = 0;
const newKey = () => `new-${++keySeq}`;

export function useMechanics() {
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  useEffect(() => {
    apiFetch('/work-orders/mechanics')
      .then((res) => (res.ok ? res.json() : []))
      .then(setMechanics)
      .catch(() => {});
  }, []);
  return mechanics;
}

// Without POS pricing a part is always invoiced at the catalogue price,
// so its price box is locked (the server drops a typed one too).
export function usePosPricing() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    apiFetch('/work-orders/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((c) => setEnabled(!!c?.posPricingEnabled))
      .catch(() => {});
  }, []);
  return enabled;
}

// Job details + parts/labour lines. Shared by the new and detail pages;
// `readOnly` once the job is invoiced or cancelled. `inDocument` (the new page's single document card):
// just the job's details — the mechanic and branch are in its header, the lines in its table.
export default function WorkOrderForm({
  value,
  onChange,
  readOnly,
  vehicleOdometer,
  inDocument,
}: {
  value: WorkOrderFormValue;
  onChange: (next: WorkOrderFormValue) => void;
  readOnly?: boolean;
  vehicleOdometer?: number | null;
  inDocument?: boolean;
}) {
  const { t } = useLanguage();
  const mechanics = useMechanics();
  const locations = useLocations();
  // Only warehouse orgs pick where a part comes from; the rest use CENTRE.
  const warehouseOps = useWarehouseOps();
  const { branches, multiBranch } = useBranches();
  const posPricing = usePosPricing();
  // Retail jobs rarely need these, so they stay folded away unless used.
  const [showFormal, setShowFormal] = useState(false);
  const formalOpen = showFormal || !!(value.validUntil || value.customerPoNumber || value.paymentTerms);
  const set = (patch: Partial<WorkOrderFormValue>) => onChange({ ...value, ...patch });

  function updateLine(key: string, patch: Partial<DraftLine>) {
    set({ lines: value.lines.map((l) => (l.key === key ? ({ ...l, ...patch } as DraftLine) : l)) });
  }

  const Details = inDocument ? DocumentSection : Card;
  return (
    <>
      <Details title={t('workshop.workOrders.jobDetails')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!inDocument && (
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('workshop.workOrders.mechanic')}</span>
            <select
              className={`${inputCls} mt-1`}
              value={value.mechanicId}
              disabled={readOnly}
              onChange={(e) => set({ mechanicId: e.target.value })}
            >
              <option value="">{t('workshop.workOrders.unassigned')}</option>
              {mechanics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.position ? ` · ${m.position}` : ''}
                </option>
              ))}
            </select>
            {mechanics.length === 0 && !readOnly && (
              <span className="text-xs text-gray-400 mt-1 block">{t('workshop.workOrders.noMechanics')}</span>
            )}
          </label>
          )}
          {multiBranch && !inDocument && (
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">{t('workshop.workOrders.branch')}</span>
              <select
                className={`${inputCls} mt-1`}
                value={value.branchId}
                disabled={readOnly}
                onChange={(e) => set({ branchId: e.target.value })}
              >
                <option value="">{t('workshop.workOrders.defaultBranch')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('workshop.workOrders.odometer')}</span>
            <input
              type="number"
              min={vehicleOdometer ?? 0}
              inputMode="numeric"
              className={`${inputCls} mt-1 ${!readOnly && isOdometerBelowLast(value.odometer, vehicleOdometer) ? '!border-red-300' : ''}`}
              value={value.odometer}
              disabled={readOnly}
              aria-invalid={!readOnly && isOdometerBelowLast(value.odometer, vehicleOdometer)}
              placeholder={vehicleOdometer != null ? t('workshop.workOrders.lastOdometer', { km: vehicleOdometer }) : 'km'}
              onChange={(e) => set({ odometer: e.target.value })}
            />
            {!readOnly && isOdometerBelowLast(value.odometer, vehicleOdometer) && (
              <span className="block text-xs text-red-600 mt-1">{t('common.odometerTooLow', { km: vehicleOdometer ?? 0 })}</span>
            )}
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-gray-600">{t('workshop.workOrders.complaint')}</span>
            <textarea
              rows={2}
              className={`${inputCls} mt-1`}
              value={value.complaint}
              disabled={readOnly}
              placeholder={t('workshop.workOrders.complaintPlaceholder')}
              onChange={(e) => set({ complaint: e.target.value })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-gray-600">{t('workshop.workOrders.notes')}</span>
            <textarea
              rows={2}
              className={`${inputCls} mt-1`}
              value={value.notes}
              disabled={readOnly}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </label>
        </div>

        {formalOpen ? (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5 mb-2">
              <Building2 size={13} />
              {t('workshop.workOrders.formalDetails')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-gray-600">{t('workshop.workOrders.validUntil')}</span>
                <input
                  type="date"
                  className={`${inputCls} mt-1`}
                  value={value.validUntil}
                  disabled={readOnly}
                  onChange={(e) => set({ validUntil: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">{t('workshop.workOrders.customerPo')}</span>
                <input
                  className={`${inputCls} mt-1`}
                  value={value.customerPoNumber}
                  maxLength={100}
                  disabled={readOnly}
                  onChange={(e) => set({ customerPoNumber: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">{t('workshop.workOrders.paymentTerms')}</span>
                <input
                  className={`${inputCls} mt-1`}
                  value={value.paymentTerms}
                  maxLength={200}
                  disabled={readOnly}
                  placeholder={t('workshop.workOrders.paymentTermsPlaceholder')}
                  onChange={(e) => set({ paymentTerms: e.target.value })}
                />
              </label>
            </div>
          </div>
        ) : (
          !readOnly && (
            <button
              type="button"
              onClick={() => setShowFormal(true)}
              className="mt-3 text-xs text-blue-700 hover:underline flex items-center gap-1.5"
            >
              <Building2 size={13} />
              {t('workshop.workOrders.addFormalDetails')}
            </button>
          )
        )}
      </Details>

      {!inDocument && (
      <Card title={t('workshop.workOrders.partsAndLabour')}>
        {value.lines.length === 0 && <p className="text-sm text-gray-400 mb-3">{t('workshop.workOrders.noLines')}</p>}
        <div className="space-y-2">
          {value.lines.map((l) => (
            <div key={l.key} className="border border-gray-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-end gap-2">
              <div className="flex-1 min-w-0">
                {l.kind === 'part' ? (
                  <>
                    <p className="text-sm font-medium flex items-center gap-1.5 truncate">
                      <Package size={14} className="text-blue-600 shrink-0" />
                      {l.name}
                      {l.sku && <span className="text-xs text-gray-500">{l.sku}</span>}
                    </p>
                    {warehouseOps && (
                      <select
                        className={`${inputCls} mt-1.5`}
                        value={l.locationId}
                        disabled={readOnly}
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
                    )}
                  </>
                ) : (
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                      <Wrench size={12} className="text-blue-600" />
                      {t('workshop.workOrders.labour')}
                    </span>
                    <input
                      className={`${inputCls} mt-1`}
                      value={l.description}
                      disabled={readOnly}
                      placeholder={t('workshop.workOrders.labourPlaceholder')}
                      onChange={(e) => updateLine(l.key, { description: e.target.value })}
                    />
                  </label>
                )}
              </div>
              <label className="block sm:w-20">
                <span className="text-xs font-semibold text-gray-600">{t('workshop.workOrders.qty')}</span>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  className={`${inputCls} mt-1`}
                  value={l.quantity}
                  disabled={readOnly}
                  onChange={(e) => updateLine(l.key, { quantity: Number(e.target.value) })}
                />
              </label>
              <label className="block sm:w-36">
                <span className="text-xs font-semibold text-gray-600">{t('workshop.workOrders.price')}</span>
                <input
                  type="number"
                  min={0}
                  className={`${inputCls} mt-1`}
                  value={l.kind === 'part' && !posPricing ? '' : (l.unitPrice ?? '')}
                  disabled={readOnly || (l.kind === 'part' && !posPricing)}
                  placeholder={l.kind === 'part' ? t('workshop.workOrders.cataloguePrice') : '0'}
                  onChange={(e) =>
                    updateLine(l.key, {
                      unitPrice: e.target.value === '' ? (l.kind === 'part' ? null : 0) : Number(e.target.value),
                    })
                  }
                />
              </label>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => set({ lines: value.lines.filter((x) => x.key !== l.key) })}
                  title={t('workshop.workOrders.removeLine')}
                  aria-label={t('workshop.workOrders.removeLine')}
                  className="self-end w-9 h-9 flex items-center justify-center border border-gray-200 rounded-md text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {!readOnly && (
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <ProductPicker
                placeholder={t('workshop.workOrders.addPart')}
                onPick={(p) =>
                  set({
                    lines: [
                      ...value.lines,
                      {
                        kind: 'part',
                        key: newKey(),
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
                      },
                    ],
                  })
                }
              />
            </div>
            <button
              type="button"
              onClick={() =>
                set({
                  lines: [...value.lines, { kind: 'labour', key: newKey(), description: '', quantity: 1, unitPrice: 0 }],
                })
              }
              className="inline-flex items-center justify-center gap-1.5 text-sm font-medium bg-white border border-gray-300 text-gray-800 rounded-md px-3 py-2 hover:bg-gray-50"
            >
              <Plus size={14} />
              {t('workshop.workOrders.addLabour')}
            </button>
          </div>
        )}
      </Card>
      )}
    </>
  );
}

// Card's heading and spacing without its border, for a section inside a card the page draws.
function DocumentSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="p-4">
      {title && <h2 className="text-sm font-semibold mb-3">{title}</h2>}
      {children}
    </section>
  );
}

export function formToPayload(value: WorkOrderFormValue) {
  return {
    mechanicId: value.mechanicId || null,
    odometer: value.odometer === '' ? null : Number(value.odometer),
    complaint: value.complaint,
    notes: value.notes,
    ...(value.branchId && { branchId: value.branchId }),
    validUntil: value.validUntil || null,
    customerPoNumber: value.customerPoNumber,
    paymentTerms: value.paymentTerms,
  };
}

export function VehicleBadge({ plate, model, customer }: { plate: string; model: string; customer: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <Car size={16} className="text-blue-600 shrink-0" />
      <span className="font-semibold truncate">
        {plate} · {model}
      </span>
      <span className="text-sm text-gray-500 truncate">{customer}</span>
    </div>
  );
}
