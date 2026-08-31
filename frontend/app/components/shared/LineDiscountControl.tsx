// components/shared/LineDiscountControl.tsx
'use client';

import { DiscountType } from '@/app/components/invoices/types';
import { formatIDR } from '@/lib/format';

export function LineDiscountControl({
  discountType,
  discountValue,
  discountAmount,
  onChange,
}: {
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  onChange: (discountType: DiscountType | null, rawValue?: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 pl-0.5">
      <span className="text-[11px] text-gray-400 shrink-0">Discount</span>
      <select
        value={discountType ?? ''}
        onChange={(e) => {
          const next = (e.target.value || null) as DiscountType | null;
          onChange(next, next ? String(discountValue ?? 0) : undefined);
        }}
        className="text-[11px] border border-gray-300 rounded-md px-1 py-0.5 outline-none"
      >
        <option value="">None</option>
        <option value="PERCENTAGE">%</option>
        <option value="FIXED">Rp</option>
      </select>
      {discountType && (
        <input
          type="number"
          min={0}
          value={discountValue ?? ''}
          onChange={(e) => onChange(discountType, e.target.value)}
          className="w-16 text-[11px] border border-gray-300 rounded-md px-1 py-0.5 outline-none"
        />
      )}
      {discountAmount > 0 && (
        <span className="text-[11px] text-gray-400">−{formatIDR(discountAmount)}</span>
      )}
    </div>
  );
}