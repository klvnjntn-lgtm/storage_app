'use client';

import { useEffect, useState } from 'react';
import { Percent } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

// A row from GET /organization/tax-rates. Settings manages a list of
// these (add / set default / remove) instead of a single Yes/No default —
// this same list populates the per-item tax picker on invoice/new.
type OrgTaxRate = {
  id: string;
  name: string;
  percentage: number;
  isDefault: boolean;
  archivedAt: string | null;
};

// Tax rates — full list, not a single on/off default. Whichever rate is
// marked "Default" here is what pre-fills new invoice lines; staff can
// still pick a different rate (or several) per line item on invoice/new.
// A rate can also have no default set at all — "Unset default" clears the
// flag without promoting anything else.
// Loads its own list on mount; a failed load is reported to the settings
// page through onLoadError.
export default function TaxRatesSection({ onLoadError }: { onLoadError: (message: string) => void }) {
  const { t } = useLanguage();

  // Tax — backed by full CRUD on /organization/tax-rates (GET/POST list,
  // PATCH/DELETE :id). Any number of rates, each independently active or
  // archived, with at most one flagged isDefault (used to pre-fill new
  // invoice lines). This is the same list the invoice/new tax picker reads.
  const [taxRates, setTaxRates] = useState<OrgTaxRate[] | null>(null);
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxPercentage, setNewTaxPercentage] = useState('');
  const [savingTaxId, setSavingTaxId] = useState<string | 'new' | null>(null);
  const [taxError, setTaxError] = useState('');

  useEffect(() => {
    apiFetch('/organization/tax-rates')
      .then((res) => res.json())
      .then((data: OrgTaxRate[]) => setTaxRates(data.filter((rate) => !rate.archivedAt)))
      .catch(() => onLoadError(t('settings.couldNotLoadTaxRates')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTaxRate() {
    setTaxError('');
    const name = newTaxName.trim();
    const percentage = Number(newTaxPercentage);

    if (!name) {
      setTaxError(t('settings.taxRates.enterTaxName'));
      return;
    }
    if (newTaxPercentage.trim() === '' || Number.isNaN(percentage) || percentage < 0 || percentage > 100) {
      setTaxError(t('settings.taxRates.percentageRange'));
      return;
    }

    setSavingTaxId('new');
    try {
      const res = await apiFetch('/organization/tax-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, percentage }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTaxError(data?.message || t('settings.taxRates.addFailed'));
        return;
      }
      setTaxRates((prev) => [...(prev ?? []), data]);
      setNewTaxName('');
      setNewTaxPercentage('');
    } finally {
      setSavingTaxId(null);
    }
  }

  // Handles both directions now: pass `true` to make a rate the default
  // (which clears the flag on every other rate, since only one default can
  // exist at a time), or `false` to unset it as default without promoting
  // anything else — leaving the list with no default at all.
  async function setDefaultTaxRate(id: string, isDefault: boolean) {
    setTaxError('');
    setSavingTaxId(id);
    try {
      const res = await apiFetch(`/organization/tax-rates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTaxError(data?.message || (isDefault ? t('settings.taxRates.setDefaultFailed') : t('settings.taxRates.unsetDefaultFailed')));
        return;
      }
      setTaxRates(
        (prev) =>
          prev?.map((rate) => {
            if (rate.id === id) return { ...rate, isDefault };
            // When promoting a new default, every other rate loses the flag.
            // When just unsetting one, leave the others untouched.
            return isDefault ? { ...rate, isDefault: false } : rate;
          }) ?? prev,
      );
    } finally {
      setSavingTaxId(null);
    }
  }

  async function archiveTaxRate(id: string) {
    setTaxError('');
    setSavingTaxId(id);
    try {
      const res = await apiFetch(`/organization/tax-rates/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setTaxError(data?.message || t('settings.taxRates.removeFailed'));
        return;
      }
      setTaxRates((prev) => prev?.filter((rate) => rate.id !== id) ?? prev);
    } finally {
      setSavingTaxId(null);
    }
  }

  return (
    <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Percent size={16} strokeWidth={2} className="text-blue-700" />
        <h2 className="font-bold">{t('settings.taxRates.heading')}</h2>
      </div>
      <p className="text-sm text-gray-600 max-w-md">
        {t('settings.taxRates.description')}
      </p>

      {taxError && <p className="text-xs text-red-700">{taxError}</p>}

      <div className="flex flex-col divide-y divide-blue-500/10">
        {taxRates?.map((rate) => (
          <div key={rate.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <span className="text-sm font-medium">{rate.name}</span>
              <span className="text-sm text-gray-500 ml-2">{rate.percentage}%</span>
              {rate.isDefault && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 font-medium ml-2">
                  {t('settings.default')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDefaultTaxRate(rate.id, !rate.isDefault)}
                disabled={savingTaxId === rate.id}
                className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-gray-600 hover:border-blue-500/50 hover:text-blue-700 disabled:opacity-50 transition-colors"
              >
                {rate.isDefault ? t('settings.unsetDefault') : t('settings.setDefault')}
              </button>
              <button
                type="button"
                onClick={() => archiveTaxRate(rate.id)}
                disabled={savingTaxId === rate.id}
                className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {t('common.remove')}
              </button>
            </div>
          </div>
        ))}
        {taxRates?.length === 0 && (
          <p className="text-sm text-gray-400 py-2">{t('settings.taxRates.noneYet')}</p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
        <input
          value={newTaxName}
          onChange={(e) => setNewTaxName(e.target.value)}
          placeholder={t('settings.taxRates.taxNamePlaceholder')}
          className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all flex-1 min-w-0"
        />
        <div className="relative">
          <input
            value={newTaxPercentage}
            onChange={(e) => setNewTaxPercentage(e.target.value)}
            placeholder="11"
            inputMode="decimal"
            className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 pr-7 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all w-full sm:w-24"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
            %
          </span>
        </div>
        <button
          type="button"
          onClick={addTaxRate}
          disabled={savingTaxId === 'new'}
          className="text-sm px-4 py-2.5 sm:py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm disabled:bg-gray-300 transition-colors"
        >
          {savingTaxId === 'new' ? t('settings.taxRates.adding') : t('settings.taxRates.addButton')}
        </button>
      </div>
    </section>
  );
}
