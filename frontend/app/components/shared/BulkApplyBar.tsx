// app/components/shared/BulkApplyBar.tsx
'use client';

import { useState } from 'react';
import { DiscountType, TaxRate } from '@/app/components/invoices/types';

export function BulkApplyBar({
  taxRates,
  onApplyTaxToAll,
  onApplyDiscountToAll,
}: {
  taxRates: TaxRate[];
  onApplyTaxToAll: (taxRateId: string, checked: boolean) => void;
  onApplyDiscountToAll: (discountType: DiscountType | null, value: number) => void;
}) {
  const [discType, setDiscType] = useState<DiscountType>('PERCENTAGE');
  const [discValue, setDiscValue] = useState('');

  return (
    <div className="mb-3 p-2.5 bg-gray-50 rounded-md border border-gray-200 space-y-2">
      {taxRates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-gray-500 shrink-0">Tax, all lines:</span>
          {taxRates.map((rate) => (
            <button
              key={rate.id}
              type="button"
              onClick={() => onApplyTaxToAll(rate.id, true)}
              className="text-[11px] px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-black hover:bg-white"
            >
              + {rate.name} ({rate.percentage}%)
            </button>
          ))}
          <button
            type="button"
            onClick={() => taxRates.forEach((r) => onApplyTaxToAll(r.id, false))}
            className="text-[11px] px-2 py-1 rounded-md text-gray-400 hover:text-red-600"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-gray-500 shrink-0">Discount, all lines:</span>
        <select
          value={discType}
          onChange={(e) => setDiscType(e.target.value as DiscountType)}
          className="text-[11px] border border-gray-300 rounded-md px-1 py-1 outline-none"
        >
          <option value="PERCENTAGE">%</option>
          <option value="FIXED">Rp</option>
        </select>
        <input
          type="number"
          min={0}
          value={discValue}
          onChange={(e) => setDiscValue(e.target.value)}
          placeholder="0"
          className="w-16 text-[11px] border border-gray-300 rounded-md px-1.5 py-1 outline-none"
        />
        <button
          type="button"
          onClick={() => {
            const v = Number(discValue);
            if (Number.isFinite(v) && v >= 0) onApplyDiscountToAll(discType, v);
          }}
          className="text-[11px] px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-black hover:bg-white"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => {
            setDiscValue('');
            onApplyDiscountToAll(null, 0);
          }}
          className="text-[11px] px-2 py-1 rounded-md text-gray-400 hover:text-red-600"
        >
          Clear
        </button>
      </div>
    </div>
  );
}