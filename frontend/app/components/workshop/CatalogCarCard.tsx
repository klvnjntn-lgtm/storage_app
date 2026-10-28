'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { YearSelect, type CatalogGeneration } from './YearSelect';

export type CatalogCar = {
  id: string;
  carBrand?: string | null;
  carModel?: string | null;
  carYear?: number | null;
  engine?: string | null;
};

type Facets = { brands: { brand: string; models: string[] }[]; generations?: CatalogGeneration[] };

// Which car in the parts catalogue a vehicle is — brand and model from the catalogue's own list, the
// year from the years it was built — so its plate opens straight to its parts.
export function CatalogCarCard({ vehicle, onSaved }: { vehicle: CatalogCar; onSaved: (v: CatalogCar) => void }) {
  const { t } = useLanguage();
  const [facets, setFacets] = useState<Facets | null>(null);
  const [brand, setBrand] = useState(vehicle.carBrand ?? '');
  const [model, setModel] = useState(vehicle.carModel ?? '');
  const [year, setYear] = useState(vehicle.carYear ? String(vehicle.carYear) : '');
  const [engine, setEngine] = useState(vehicle.engine ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/part-catalog/facets')
      .then((res) => (res.ok ? res.json() : null))
      .then((f: Facets | null) => f && setFacets(f))
      .catch(() => {});
  }, []);
  const models = useMemo(() => facets?.brands.find((b) => b.brand === brand)?.models ?? [], [facets, brand]);

  const dirty =
    brand !== (vehicle.carBrand ?? '') ||
    model !== (vehicle.carModel ?? '') ||
    year !== (vehicle.carYear ? String(vehicle.carYear) : '') ||
    engine.trim() !== (vehicle.engine ?? '');

  async function save() {
    setSaving(true);
    setError('');
    const body = {
      carBrand: brand && model ? brand : null,
      carModel: brand && model ? model : null,
      carYear: /^\d{4}$/.test(year) ? Number(year) : null,
      engine: engine.trim() || null,
    };
    const res = await apiFetch(`/vehicles/${vehicle.id}`, { method: 'PATCH', body: JSON.stringify(body) }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(t('workshop.vehicleDetail.saveCarFailed'));
      return;
    }
    onSaved({ ...vehicle, ...body });
  }

  const select = 'border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white disabled:opacity-50';
  const saved = vehicle.carBrand && vehicle.carModel;
  return (
    <div className="rounded-xl border border-blue-500/15 bg-white p-3 sm:p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-semibold">{t('workshop.vehicleDetail.catalogCar')}</p>
        {saved && (
          <Link
            href={`/workshop/parts?${new URLSearchParams({
              brand: vehicle.carBrand!,
              model: vehicle.carModel!,
              ...(vehicle.carYear ? { year: String(vehicle.carYear) } : {}),
            })}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
          >
            <Wrench size={13} />
            {t('workshop.vehicleDetail.openParts')}
          </Link>
        )}
      </div>
      {!saved && <p className="text-xs text-gray-500 mb-2">{t('workshop.vehicleDetail.catalogCarNotSet')}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_180px_1fr_auto] gap-2">
        <select
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value);
            setModel('');
            setYear('');
          }}
          className={select}
        >
          <option value="">{t('workshop.partsEpc.chooseBrand')}</option>
          {facets?.brands.map((b) => (
            <option key={b.brand} value={b.brand}>{b.brand}</option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setYear('');
          }}
          disabled={!brand}
          className={select}
        >
          <option value="">{t('workshop.partsEpc.chooseModel')}</option>
          {/* A saved model the catalogue has since dropped stays visible. */}
          {model && !models.includes(model) && <option value={model}>{model}</option>}
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <YearSelect generations={facets?.generations} brand={brand} model={model} value={year} onChange={setYear} className={select} />
        <input
          value={engine}
          onChange={(e) => setEngine(e.target.value)}
          maxLength={50}
          placeholder={t('workshop.vehicleDetail.engine')}
          className={select}
        />
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {t('workshop.vehicleDetail.saveCar')}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
