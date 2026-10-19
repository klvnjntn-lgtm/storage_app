'use client';

import { useEffect, useMemo, useState } from 'react';
import { Hash, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useEscapeToClose } from '@/lib/hooks/useEscapeToClose';

type Available = { id: string; serialNumber: string };

// Picks which serial-numbered units a line covers, from those in stock at
// the line's location (GET /serials/available) — or, with `sessionId`, from
// those a move session picked and hasn't put away yet. Exactly `quantity`
// must be picked; the backend checks again when the document is posted.
export function SerialPicker({
  productId,
  productName,
  locationId,
  sessionId,
  quantity,
  value,
  onChange,
  onClose,
}: {
  productId: string;
  productName: string;
  locationId?: string;
  sessionId?: string;
  quantity: number;
  value: string[];
  onChange: (serials: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [available, setAvailable] = useState<Available[] | null>(null);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string[]>(value);

  useEffect(() => {
    (async () => {
      const url = sessionId
        ? `/sessions/${sessionId}/serials?${new URLSearchParams({ productId })}`
        : `/serials/available?${new URLSearchParams({ productId, locationId: locationId ?? '' })}`;
      const res = await apiFetch(url).catch(() => null);
      setAvailable(res?.ok ? await res.json() : []);
    })();
  }, [productId, locationId, sessionId]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    // Keep already-picked units visible even if they're no longer
    // returned (picked on another open tab, say) so they can be unticked.
    const all = [...(available ?? [])];
    for (const s of picked) if (!all.some((a) => a.serialNumber === s)) all.push({ id: s, serialNumber: s });
    return q ? all.filter((a) => a.serialNumber.toLowerCase().includes(q)) : all;
  }, [available, filter, picked]);

  function toggle(serial: string) {
    setPicked((cur) => (cur.includes(serial) ? cur.filter((s) => s !== serial) : cur.length >= quantity ? cur : [...cur, serial]));
  }

  useEscapeToClose(true, () => onClose());
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-md shadow-lg w-full max-w-md p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-blue-700">
            <Hash size={16} /> {t('serials.pickTitle', { name: productName })}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-black" aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-2">{t('serials.pickHint', { picked: picked.length, quantity })}</p>
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            // A barcode scanner types the serial and presses Enter.
            if (e.key === 'Enter') {
              const hit = (available ?? []).find((a) => a.serialNumber.toLowerCase() === filter.trim().toLowerCase());
              if (hit) {
                toggle(hit.serialNumber);
                setFilter('');
              }
            }
          }}
          placeholder={t('serials.scanOrType')}
          className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 mb-2"
        />
        <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
          {available === null && <p className="p-3 text-sm text-gray-500">{t('common.loading')}</p>}
          {available !== null && shown.length === 0 && <p className="p-3 text-sm text-gray-500">{t('serials.noneAvailable')}</p>}
          {shown.map((a) => (
            <label key={a.serialNumber} className="flex items-center gap-2 px-3 py-1.5 text-sm font-mono cursor-pointer hover:bg-blue-50">
              <input
                type="checkbox"
                checked={picked.includes(a.serialNumber)}
                disabled={!picked.includes(a.serialNumber) && picked.length >= quantity}
                onChange={() => toggle(a.serialNumber)}
              />
              {a.serialNumber}
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="flex-1 text-sm px-3 py-2 rounded-md border-2 border-gray-300 font-semibold hover:bg-gray-100">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => {
              onChange(picked);
              onClose();
            }}
            className="flex-1 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700"
          >
            {t('serials.usePicked', { n: picked.length })}
          </button>
        </div>
      </div>
    </div>
  );
}

// A small "S/N 2/3" button for a line, red until every unit has a serial.
export function SerialButton({ count, quantity, onClick }: { count: number; quantity: number; onClick: () => void }) {
  const complete = count === quantity;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded px-1.5 py-0.5 border ${
        complete ? 'border-green-300 text-green-700 bg-green-50' : 'border-red-300 text-red-700 bg-red-50'
      }`}
    >
      <Hash size={11} /> S/N {count}/{quantity}
    </button>
  );
}
