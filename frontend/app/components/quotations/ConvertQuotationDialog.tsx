'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

// One quotation line's progress (from GET /sales-quotations/:id → conversion).
export type ConversionLine = { id: string; name: string; quoted: number; ordered: number; invoiced: number; remaining: number };

// Picks how much of each line to order / invoice now — a quotation converts in parts, never past what
// was quoted. Starts at everything that's left.
export function ConvertQuotationDialog({
  target,
  lines,
  busy,
  onClose,
  onConfirm,
}: {
  target: 'order' | 'invoice';
  lines: ConversionLine[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (picks: { quotationItemId: string; quantity: number }[]) => void;
}) {
  const { t } = useLanguage();
  const c = (key: string) => t(`sales.quotationConvert.${key}`);
  const open = lines.filter((l) => l.remaining > 0);
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((l) => [l.id, String(l.remaining)])),
  );

  const picks = open
    .map((l) => ({ quotationItemId: l.id, quantity: Number(qty[l.id]) }))
    .filter((p) => Number.isFinite(p.quantity) && p.quantity > 0);
  const tooMuch = open.some((l) => Number(qty[l.id]) > l.remaining || Number(qty[l.id]) < 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold">{target === 'order' ? c('titleOrder') : c('titleInvoice')}</h2>
          <button type="button" aria-label={t('common.close')} onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-auto px-5 py-3">
          <p className="text-xs text-gray-500 mb-3">{c('hint')}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-2">{c('item')}</th>
                <th className="py-2 px-2 text-right">{c('quoted')}</th>
                <th className="py-2 px-2 text-right">{c('done')}</th>
                <th className="py-2 px-2 text-right">{c('left')}</th>
                <th className="py-2 pl-2 text-right">{c('now')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const value = qty[l.id] ?? '';
                const over = Number(value) > l.remaining;
                return (
                  <tr key={l.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-2 break-words">{l.name}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{l.quoted}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-500">{l.ordered + l.invoiced}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold">{l.remaining}</td>
                    <td className="py-2 pl-2 text-right">
                      {l.remaining > 0 ? (
                        <input
                          type="number"
                          min={0}
                          max={l.remaining}
                          step="any"
                          aria-label={`${c('now')}: ${l.name}`}
                          value={value}
                          onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                          className={`w-24 border rounded-md px-2 py-1 text-right tabular-nums outline-none ${
                            over ? 'border-red-400 text-red-700' : 'border-gray-300 focus:border-blue-500'
                          }`}
                        />
                      ) : (
                        <span className="text-xs text-gray-400">{c('fullyDone')}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          {tooMuch && <p className="mr-auto text-xs text-red-700">{c('tooMuch')}</p>}
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy || tooMuch || picks.length === 0}
            onClick={() => onConfirm(picks)}
            className="text-sm px-4 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {target === 'order' ? c('confirmOrder') : c('confirmInvoice')}
          </button>
        </div>
      </div>
    </div>
  );
}
