'use client';

import { useEffect, useMemo, useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import type { DocType, PaperSize, PrintTemplate } from '@/lib/print-designer/types';

// 'builtin' = the app's own layout; null = whatever the branch default is.
export type DesignChoice = string | null;

// The print designs a document can use, and the one in effect: the one
// picked, else the branch default for the paper size (or, where any size
// goes, the A4 default, then the A5 one). Same rule as the backend's
// PrintTemplatesService.resolve, so screen, print and PDF agree.
export function usePrintDesign(docType: DocType, branchId: string | null | undefined, paper: PaperSize | null) {
  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [choice, setChoice] = useState<DesignChoice>(null);

  useEffect(() => {
    if (branchId === undefined) return;
    let cancelled = false;
    const q = new URLSearchParams({ docType, ...(branchId ? { branchId } : {}) });
    apiFetch(`/print-templates?${q}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list: PrintTemplate[]) => {
        if (cancelled) return;
        // A document with no branch prints with the first branch's designs,
        // which the backend picks; here, keep only one branch's worth.
        const branch = branchId ?? list[0]?.branchId;
        setTemplates(Array.isArray(list) ? list.filter((t) => t.branchId === branch) : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [docType, branchId]);

  const usable = useMemo(() => templates.filter((t) => !paper || t.paperSize === paper), [templates, paper]);

  const effective = useMemo(() => {
    if (choice === 'builtin') return null;
    if (choice) {
      const picked = usable.find((t) => t.id === choice);
      if (picked) return picked;
    }
    const papers: PaperSize[] = paper ? [paper] : ['A4', 'A5'];
    for (const p of papers) {
      const d = usable.find((t) => t.isDefault && t.paperSize === p);
      if (d) return d;
    }
    return null;
  }, [choice, usable, paper]);

  return {
    templates: usable,
    choice,
    setChoice,
    effective,
    // For PDF links: always name the design, so the PDF matches the screen.
    templateParam: effective ? effective.id : 'builtin',
  };
}

export function PrintDesignPicker({
  templates,
  effective,
  onChange,
}: {
  templates: PrintTemplate[];
  effective: PrintTemplate | null;
  onChange: (choice: DesignChoice) => void;
}) {
  const { t } = useLanguage();
  if (templates.length === 0) return null;
  return (
    <label className="flex items-center gap-1.5 text-sm print:hidden" title={t('printDesigner.picker.label')}>
      <LayoutTemplate size={16} strokeWidth={2} className="text-blue-700 shrink-0" />
      <span className="sr-only">{t('printDesigner.picker.label')}</span>
      <select
        value={effective?.id ?? 'builtin'}
        onChange={(e) => onChange(e.target.value)}
        className="border-2 border-blue-600/30 rounded-md px-2 py-1.5 text-sm font-medium text-blue-800 bg-white max-w-[14rem]"
      >
        <option value="builtin">{t('printDesigner.picker.builtin')}</option>
        {templates.map((tpl) => (
          <option key={tpl.id} value={tpl.id}>
            {tpl.name}
            {tpl.isDefault ? ` (${t('printDesigner.picker.default')})` : ''}
            {` · ${tpl.paperSize}`}
          </option>
        ))}
      </select>
    </label>
  );
}
