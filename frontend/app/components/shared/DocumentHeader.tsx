'use client';

import type { ReactNode } from 'react';
import { CalendarDays, Wrench } from 'lucide-react';
import DatePicker from '@/app/components/shared/DatePicker';
import { BranchPicker } from '@/app/components/shared/BranchFilter';
import { useMechanics } from '@/app/components/workshop/WorkOrderForm';
import { useLanguage } from '@/app/context/LanguageContext';

const labelCls = 'text-xs text-gray-500 mb-1 flex items-center gap-1';
const selectCls =
  'w-full border border-blue-500/20 rounded-lg p-2 text-sm bg-white outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]';

// The top of every document editor (quotation, sales order, invoice, purchase order, work order):
// date, who it's for (customer or supplier picker, passed in), mechanic (workshops) and branch (MASTER
// of a multi-branch business), side by side. Anything else the header needs goes in `children`, full
// width underneath; extra side-by-side fields (e.g. a quotation's valid-until) go in `fields`.
export function DocumentHeader({
  date,
  onDateChange,
  datePlaceholder,
  party,
  mechanic,
  branch,
  fields,
  children,
  bare,
}: {
  // "YYYY-MM-DD"; left out where the document has no editable date.
  date?: string;
  onDateChange?: (v: string) => void;
  // Set where a blank date means something (an invoice's '' = today): the date can be cleared back to it.
  datePlaceholder?: string;
  party?: ReactNode;
  // Only passed for businesses with the Workshop module.
  mechanic?: { value: string; onChange: (id: string) => void };
  branch?: { value: string; onChange: (id: string) => void };
  fields?: ReactNode;
  children?: ReactNode;
  // Inside a card the page draws (Office layout's single document card): no border of its own.
  bare?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className={`p-4 pb-1 ${bare ? '' : 'border border-blue-500/15 rounded-xl bg-white shadow-sm'}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 [&>*]:min-w-0">
        {onDateChange && (
          <div className="mb-3">
            <label className={labelCls}>
              <CalendarDays size={12} strokeWidth={2} className="text-blue-600/70" />
              {t('common.docHeader.date')}
            </label>
            <DatePicker
              value={date ?? ''}
              onChange={onDateChange}
              clearable={!!datePlaceholder}
              placeholder={datePlaceholder}
              className="w-full"
            />
          </div>
        )}
        {party && <div className="lg:col-span-1">{party}</div>}
        {mechanic && <MechanicSelect value={mechanic.value} onChange={mechanic.onChange} />}
        {branch && <BranchPicker value={branch.value} onChange={branch.onChange} />}
        {fields}
      </div>
      {children}
    </div>
  );
}

function MechanicSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useLanguage();
  const mechanics = useMechanics();
  return (
    <div className="mb-3">
      <label className={labelCls}>
        <Wrench size={12} strokeWidth={2} className="text-blue-600/70" />
        {t('common.docHeader.mechanic')}
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        <option value="">{t('common.docHeader.noMechanic')}</option>
        {mechanics.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.position ? ` · ${m.position}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
