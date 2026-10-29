'use client';

import { LayoutPanelLeft, ShoppingBasket } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import type { DocumentLayout } from '@/lib/hooks/useDocumentLayout';

// Office ⇄ Cashier switch for the document editors' header (see useDocumentLayout).
export function DocumentLayoutToggle({
  layout,
  onChange,
}: {
  layout: DocumentLayout;
  onChange: (layout: DocumentLayout) => void;
}) {
  const { t } = useLanguage();
  const options: { value: DocumentLayout; label: string; icon: typeof LayoutPanelLeft }[] = [
    { value: 'office', label: t('common.documentLayout.office'), icon: LayoutPanelLeft },
    { value: 'retail', label: t('common.documentLayout.retail'), icon: ShoppingBasket },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t('common.documentLayout.label')}
      className="hidden lg:inline-flex rounded-lg border border-blue-500/20 bg-white p-0.5"
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={layout === value}
          title={label}
          onClick={() => onChange(value)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
            layout === value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-blue-50'
          }`}
        >
          <Icon size={13} strokeWidth={2} />
          {label}
        </button>
      ))}
    </div>
  );
}
