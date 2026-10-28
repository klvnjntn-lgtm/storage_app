'use client';

import { useBranches } from '@/lib/hooks/useBranches';
import { useLanguage } from '@/app/context/LanguageContext';

// A list's branch filter: MASTER of a multi-branch business only. Branch
// staff never see it — their lists are already their branch's.
export function BranchFilter({
  value,
  onChange,
  className = '',
  selectClassName,
}: {
  value: string;
  onChange: (branchId: string) => void;
  className?: string;
  // Given: a bare select styled to sit beside the page's other filters.
  selectClassName?: string;
}) {
  const { branches, multiBranch } = useBranches();
  const { t } = useLanguage();
  if (!multiBranch) return null;
  const options = (
    <>
      <option value="">{t('common.allBranches')}</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </>
  );
  if (selectClassName) {
    return (
      <select
        aria-label={t('common.branchFilterLabel')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClassName}
      >
        {options}
      </select>
    );
  }
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">
        {t('common.branchFilterLabel')}
      </p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-auto text-sm border border-blue-500/20 rounded-md px-2.5 py-1.5 bg-white outline-none focus:border-blue-500/50"
      >
        {options}
      </select>
    </div>
  );
}

// The branch a new document is booked to: MASTER of a multi-branch business picks it ('' = the stock
// location's branch, else the first). Branch staff don't see it — theirs is always used.
export function BranchPicker({ value, onChange }: { value: string; onChange: (branchId: string) => void }) {
  const { branches, multiBranch } = useBranches();
  const { t } = useLanguage();
  if (!multiBranch) return null;
  return (
    <label className="block mb-3">
      <span className="text-xs text-gray-500 mb-1 block">{t('sales.invoiceCart.branchLabel')}</span>
      <select
        value={branches.some((b) => b.id === value) ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-blue-500/20 rounded-lg p-2 text-sm bg-white outline-none focus:border-blue-500/50"
      >
        <option value="">{t('sales.invoiceCart.branchDefault')}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
