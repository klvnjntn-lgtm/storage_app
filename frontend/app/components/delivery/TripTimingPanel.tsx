'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

type Timing = { travelFactor: number; stopMinutes: number };
type Suggestion = {
  travelFactor: number | null;
  stopMinutes: number | null;
  neighbourPairs: number;
  tripPairs: number;
  routes: number;
  sinceDate: string;
};

const fieldLabel = 'block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1';
const input = 'w-full sm:w-28 border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm tabular-nums';

// The business's trip timing (backend trip-timing.ts): a multiplier on the
// road map's travel times and the minutes spent at each stop. Every ETA is
// worked out from these, so the office can match them to how its drivers
// really drive, by hand or from what past deliveries took.
export default function TripTimingPanel() {
  const { t } = useLanguage();
  const [factor, setFactor] = useState('');
  const [minutes, setMinutes] = useState('');
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/delivery-routes/timing')
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body: Timing = await res.json();
        if (!alive) return;
        setFactor(String(body.travelFactor));
        setMinutes(String(body.stopMinutes));
      })
      .catch(() => alive && setStatus({ tone: 'error', text: t('delivery.trip.loadFailed') }));
    return () => {
      alive = false;
    };
  }, [t]);

  const factorNum = Number(factor.replace(',', '.'));
  const minutesNum = Number(minutes);
  const valid =
    factor.trim() !== '' && Number.isFinite(factorNum) && factorNum >= 0.5 && factorNum <= 5 &&
    minutes.trim() !== '' && Number.isInteger(minutesNum) && minutesNum >= 0 && minutesNum <= 120;

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await apiFetch('/delivery-routes/timing', {
        method: 'PUT',
        body: JSON.stringify({ travelFactor: factorNum, stopMinutes: minutesNum }),
      });
      setStatus(
        res.ok
          ? { tone: 'ok', text: t('delivery.trip.saved') }
          : { tone: 'error', text: t('delivery.trip.saveFailed', { status: res.status }) },
      );
    } finally {
      setSaving(false);
    }
  }

  async function suggest() {
    setSuggesting(true);
    setSuggestion(null);
    try {
      const res = await apiFetch('/delivery-routes/timing/suggestion');
      if (res.ok) setSuggestion(await res.json());
      else setStatus({ tone: 'error', text: t('delivery.trip.loadFailed') });
    } finally {
      setSuggesting(false);
    }
  }

  const hasSuggestion = suggestion && (suggestion.travelFactor != null || suggestion.stopMinutes != null);

  return (
    <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{t('delivery.trip.title')}</h2>
        <p className="text-xs text-gray-600 mt-0.5">{t('delivery.trip.hint')}</p>
      </div>
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3">
        <label className="block">
          <span className={fieldLabel}>{t('delivery.trip.factorLabel')}</span>
          <input
            type="text"
            inputMode="decimal"
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
            className={input}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>{t('delivery.trip.stopLabel')}</span>
          <input
            type="text"
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className={input}
          />
        </label>
        <button
          type="button"
          disabled={!valid || saving}
          onClick={save}
          className="col-span-2 sm:col-span-1 bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
        >
          {saving ? t('delivery.trip.saving') : t('delivery.trip.save')}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        {t('delivery.trip.factorHint')} · {t('delivery.trip.breaksNote')}
      </p>

      <div className="border-t border-blue-500/10 pt-3 space-y-2">
        <button
          type="button"
          disabled={suggesting}
          onClick={suggest}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-blue-300 text-blue-700 bg-blue-50 font-semibold hover:bg-blue-100 disabled:opacity-50"
        >
          <Sparkles size={14} />
          {suggesting ? t('delivery.trip.suggesting') : t('delivery.trip.suggest')}
        </button>
        {suggestion && !hasSuggestion && <p className="text-xs text-gray-600">{t('delivery.trip.notEnough')}</p>}
        {suggestion && hasSuggestion && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-700">
              {t('delivery.trip.suggestionFrom', {
                pairs: suggestion.neighbourPairs + suggestion.tripPairs,
                routes: suggestion.routes,
                since: suggestion.sinceDate,
              })}{' '}
              <strong>
                {[
                  suggestion.travelFactor != null && t('delivery.trip.suggestFactor', { factor: suggestion.travelFactor }),
                  suggestion.stopMinutes != null && t('delivery.trip.suggestStop', { minutes: suggestion.stopMinutes }),
                ]
                  .filter(Boolean)
                  .join(', ')}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => {
                if (suggestion.travelFactor != null) setFactor(String(suggestion.travelFactor));
                if (suggestion.stopMinutes != null) setMinutes(String(suggestion.stopMinutes));
              }}
              className="text-xs font-semibold text-blue-700 underline"
            >
              {t('delivery.trip.useSuggestion')}
            </button>
          </div>
        )}
      </div>

      {status && (
        <p role="status" className={`text-xs ${status.tone === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
