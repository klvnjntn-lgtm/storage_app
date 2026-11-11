'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Image as ImageIcon, Minus, RectangleHorizontal, Type, Building2, SeparatorVertical, Search } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { FIELD_GROUPS, fieldsFor } from '@/lib/print-designer/fields';
import type { DocType } from '@/lib/print-designer/types';
import { DRAG_MIME, type DropPayload } from './DesignCanvas';

// The left panel: boxes to add and every field the document has. Drag one
// onto a band, or click it to drop it into the selected (or header) band.
export function Palette({ docType, onAdd }: { docType: DocType; onAdd: (payload: DropPayload) => void }) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState<Record<string, boolean>>({ business: true, document: true, customer: true, totals: true });
  const [q, setQ] = useState('');
  const fields = fieldsFor(docType);
  const query = q.trim().toLowerCase();

  const drag = (payload: DropPayload) => (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const tools: { payload: DropPayload; icon: typeof Type; label: string }[] = [
    { payload: { add: 'text' }, icon: Type, label: t('printDesigner.palette.text') },
    { payload: { add: 'hline' }, icon: Minus, label: t('printDesigner.palette.hline') },
    { payload: { add: 'vline' }, icon: SeparatorVertical, label: t('printDesigner.palette.vline') },
    { payload: { add: 'rect' }, icon: RectangleHorizontal, label: t('printDesigner.palette.rect') },
    { payload: { add: 'logo' }, icon: Building2, label: t('printDesigner.palette.logo') },
    { payload: { add: 'image' }, icon: ImageIcon, label: t('printDesigner.palette.image') },
  ];

  return (
    <div className="text-sm">
      <div className="px-3 pt-3 pb-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">{t('printDesigner.palette.add')}</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {tools.map(({ payload, icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              draggable
              onDragStart={drag(payload)}
              onClick={() => onAdd(payload)}
              className="flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1.5 text-xs hover:border-blue-400 hover:bg-blue-50 cursor-grab"
            >
              <Icon size={14} className="text-blue-700 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="px-3 pb-2 pt-1 border-t border-gray-200">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mt-2 mb-2">{t('printDesigner.palette.fields')}</h3>
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('printDesigner.palette.search')}
            className="w-full border border-gray-300 rounded pl-7 pr-2 py-1 text-xs"
          />
        </div>
      </div>
      {FIELD_GROUPS.map((g) => {
        const items = fields.filter(
          (f) => f.group === g.key && (!query || f.en.toLowerCase().includes(query) || f.id.toLowerCase().includes(query) || f.key.includes(query)),
        );
        if (!items.length) return null;
        const expanded = query ? true : !!open[g.key];
        return (
          <div key={g.key} className="px-3">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
              className="flex w-full items-center gap-1 py-1.5 text-xs font-semibold text-gray-700"
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {language === 'id' ? g.id : g.en}
            </button>
            {expanded && (
              <div className="flex flex-wrap gap-1 pb-2 pl-4">
                {items.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    draggable
                    onDragStart={drag({ field: f.key })}
                    onClick={() => onAdd({ field: f.key })}
                    title={`{${f.key}}`}
                    className="rounded-full border border-blue-500/25 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-900 hover:bg-blue-100 cursor-grab"
                  >
                    {language === 'id' ? f.id : f.en}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
