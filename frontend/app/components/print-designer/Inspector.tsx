'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyEnd,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Copy,
  GripVertical,
  ImageIcon,
  Italic,
  Plus,
  Trash2,
  Underline,
  CaseUpper,
} from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import MediaLibraryModal from '@/app/components/shared/MediaLibraryModal';
import { useLanguage } from '@/app/context/LanguageContext';
import { FIELD_GROUPS, columnsFor, fieldsFor, type FieldDef } from '@/lib/print-designer/fields';
import {
  NUMERIC_COLUMNS,
  type Align,
  type BandKey,
  type ColumnKey,
  type DocType,
  type Layout,
  type LayoutElement,
  type TableColumn,
  type TableConfig,
} from '@/lib/print-designer/types';
import type { Selection } from './DesignCanvas';

const inputSm = 'w-full border border-gray-300 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-gray-200 px-3 py-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

// A number box that lets you type freely ("1." on the way to "1.5") and
// only reports real numbers.
export function NumField({
  label,
  value,
  onChange,
  step = 0.5,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <label className="block text-xs text-gray-600">
      <span className="block mb-0.5">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={text}
          className={inputSm}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            setText(String(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseFloat(e.target.value.replace(',', '.'));
            if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
          }}
        />
        {suffix && <span className="text-gray-400 shrink-0">{suffix}</span>}
      </div>
    </label>
  );
}

function ColorField({ label, value, onChange, allowNone }: { label: string; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        {allowNone && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={!value} onChange={(e) => onChange(e.target.checked ? '' : '#e5e7eb')} />
            {t('printDesigner.inspector.none')}
          </label>
        )}
        <input
          type="color"
          value={value || '#ffffff'}
          disabled={allowNone && !value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-10 border border-gray-300 rounded disabled:opacity-40"
        />
      </div>
    </div>
  );
}

function Toggle({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`p-1.5 rounded border ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
    >
      {children}
    </button>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="block text-xs text-gray-600">
      <span className="block mb-0.5">{label}</span>
      <select className={inputSm} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-xs text-gray-700">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-gray-400">{hint}</span>}
      </span>
    </label>
  );
}

function FieldSelect({
  docType,
  value,
  onChange,
  placeholder,
}: {
  docType: DocType;
  value: string;
  onChange: (key: string) => void;
  placeholder: string;
}) {
  const { language } = useLanguage();
  const fields = fieldsFor(docType);
  return (
    <select className={inputSm} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {FIELD_GROUPS.map((g) => {
        const items = fields.filter((f) => f.group === g.key);
        if (!items.length) return null;
        return (
          <optgroup key={g.key} label={language === 'id' ? g.id : g.en}>
            {items.map((f) => (
              <option key={f.key} value={f.key}>
                {language === 'id' ? f.id : f.en}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export function fieldLabel(f: FieldDef, language: string) {
  return language === 'id' ? f.id : f.en;
}

type Change = (fn: (l: Layout) => Layout, coalesceKey?: string) => void;

export function Inspector({
  layout,
  docType,
  selection,
  onChange,
  onSelect,
  onDelete,
  onDuplicate,
  onArrange,
  onAlign,
}: {
  layout: Layout;
  docType: DocType;
  selection: Selection;
  onChange: Change;
  onSelect: (s: Selection) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onArrange: (to: 'front' | 'back') => void;
  onAlign: (how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void;
}) {
  const { t } = useLanguage();

  if (selection?.kind === 'table') return <TableInspector layout={layout} docType={docType} onChange={onChange} />;

  if (selection?.kind === 'elements') {
    const els = layout.bands[selection.band].elements.filter((e) => selection.ids.includes(e.id));
    if (els.length === 0) return <PageInspector layout={layout} onChange={onChange} onSelect={onSelect} />;
    if (els.length > 1) {
      return (
        <Section title={t('printDesigner.inspector.selected', { n: els.length })}>
          <div className="grid grid-cols-6 gap-1">
            <Toggle active={false} title={t('printDesigner.inspector.alignLefts')} onClick={() => onAlign('left')}>
              <AlignHorizontalJustifyStart size={14} />
            </Toggle>
            <Toggle active={false} title={t('printDesigner.inspector.alignCentres')} onClick={() => onAlign('hcenter')}>
              <AlignHorizontalJustifyCenter size={14} />
            </Toggle>
            <Toggle active={false} title={t('printDesigner.inspector.alignRights')} onClick={() => onAlign('right')}>
              <AlignHorizontalJustifyEnd size={14} />
            </Toggle>
            <Toggle active={false} title={t('printDesigner.inspector.alignTops')} onClick={() => onAlign('top')}>
              <AlignVerticalJustifyStart size={14} />
            </Toggle>
            <Toggle active={false} title={t('printDesigner.inspector.alignMiddles')} onClick={() => onAlign('vcenter')}>
              <AlignVerticalJustifyCenter size={14} />
            </Toggle>
            <Toggle active={false} title={t('printDesigner.inspector.alignBottoms')} onClick={() => onAlign('bottom')}>
              <AlignVerticalJustifyEnd size={14} />
            </Toggle>
          </div>
          <ElementActions onDelete={onDelete} onDuplicate={onDuplicate} onArrange={onArrange} />
        </Section>
      );
    }
    return (
      <ElementInspector
        el={els[0]}
        band={selection.band}
        docType={docType}
        onChange={onChange}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onArrange={onArrange}
      />
    );
  }

  return <PageInspector layout={layout} onChange={onChange} onSelect={onSelect} focusBand={selection?.kind === 'band' ? selection.band : undefined} />;
}

function ElementActions({ onDelete, onDuplicate, onArrange }: { onDelete: () => void; onDuplicate: () => void; onArrange: (to: 'front' | 'back') => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-1 pt-1">
      <Toggle active={false} title={t('printDesigner.inspector.duplicate')} onClick={onDuplicate}>
        <Copy size={14} />
      </Toggle>
      <Toggle active={false} title={t('printDesigner.inspector.toFront')} onClick={() => onArrange('front')}>
        <ArrowUpToLine size={14} />
      </Toggle>
      <Toggle active={false} title={t('printDesigner.inspector.toBack')} onClick={() => onArrange('back')}>
        <ArrowDownToLine size={14} />
      </Toggle>
      <span className="flex-1" />
      <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 text-xs text-red-700 border border-red-300 rounded px-2 py-1 hover:bg-red-50">
        <Trash2 size={13} />
        {t('common.delete')}
      </button>
    </div>
  );
}

function ElementInspector({
  el,
  band,
  docType,
  onChange,
  onDelete,
  onDuplicate,
  onArrange,
}: {
  el: LayoutElement;
  band: BandKey;
  docType: DocType;
  onChange: Change;
  onDelete: () => void;
  onDuplicate: () => void;
  onArrange: (to: 'front' | 'back') => void;
}) {
  const { t } = useLanguage();
  const [mediaOpen, setMediaOpen] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // One property edit; typing into the same box coalesces into one undo step.
  const set = (patch: Partial<LayoutElement>, key?: string) =>
    onChange(
      (l) => ({
        ...l,
        bands: {
          ...l.bands,
          [band]: { ...l.bands[band], elements: l.bands[band].elements.map((x) => (x.id === el.id ? ({ ...x, ...patch } as LayoutElement) : x)) },
        },
      }),
      key ? `${el.id}:${key}` : undefined,
    );

  const insertField = (key: string) => {
    if (el.type !== 'text' || !key) return;
    const area = textRef.current;
    const token = `{${key}}`;
    const start = area?.selectionStart ?? el.text.length;
    const end = area?.selectionEnd ?? el.text.length;
    set({ text: el.text.slice(0, start) + token + el.text.slice(end) });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const typeLabel = t(`printDesigner.elements.${el.type}`);

  return (
    <div>
      <Section title={typeLabel}>
        <div className="grid grid-cols-4 gap-1.5">
          <NumField label="X" value={el.x} onChange={(x) => set({ x }, 'x')} suffix="" />
          <NumField label="Y" value={el.y} onChange={(y) => set({ y }, 'y')} />
          <NumField label={t('printDesigner.inspector.w')} value={el.w} min={0} onChange={(w) => set({ w }, 'w')} />
          <NumField label={t('printDesigner.inspector.h')} value={el.h} min={0} onChange={(h) => set({ h }, 'h')} />
        </div>
        <p className="text-[11px] text-gray-400">{t('printDesigner.inspector.mmNote')}</p>
      </Section>

      {el.type === 'text' && (
        <Section title={t('printDesigner.inspector.text')}>
          <textarea
            ref={textRef}
            data-inspector-text=""
            rows={3}
            value={el.text}
            maxLength={2000}
            onChange={(e) => set({ text: e.target.value }, 'text')}
            className={`${inputSm} font-mono text-xs`}
          />
          <FieldSelect docType={docType} value="" onChange={insertField} placeholder={t('printDesigner.inspector.insertField')} />
          <div className="grid grid-cols-2 gap-1.5">
            <Select
              label={t('printDesigner.inspector.font')}
              value={el.fontFamily}
              onChange={(fontFamily) => set({ fontFamily })}
              options={[
                { value: '', label: t('printDesigner.inspector.fontDefault') },
                { value: 'sans', label: 'Sans (Arial)' },
                { value: 'serif', label: 'Serif (Times)' },
                { value: 'mono', label: 'Mono (Courier)' },
              ]}
            />
            <NumField label={t('printDesigner.inspector.size')} value={el.fontSize} step={0.5} min={4} max={72} suffix="pt" onChange={(fontSize) => set({ fontSize }, 'fs')} />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <Toggle active={el.bold} title={t('printDesigner.inspector.bold')} onClick={() => set({ bold: !el.bold })}>
              <Bold size={14} />
            </Toggle>
            <Toggle active={el.italic} title={t('printDesigner.inspector.italic')} onClick={() => set({ italic: !el.italic })}>
              <Italic size={14} />
            </Toggle>
            <Toggle active={el.underline} title={t('printDesigner.inspector.underline')} onClick={() => set({ underline: !el.underline })}>
              <Underline size={14} />
            </Toggle>
            <Toggle active={el.uppercase} title={t('printDesigner.inspector.uppercase')} onClick={() => set({ uppercase: !el.uppercase })}>
              <CaseUpper size={14} />
            </Toggle>
            <span className="w-2" />
            {(['left', 'center', 'right'] as Align[]).map((a) => (
              <Toggle key={a} active={el.align === a} title={t(`printDesigner.inspector.align_${a}`)} onClick={() => set({ align: a })}>
                {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
              </Toggle>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-600 mr-1">{t('printDesigner.inspector.vertical')}</span>
            {(['top', 'middle', 'bottom'] as const).map((a) => (
              <Toggle key={a} active={el.vAlign === a} title={t(`printDesigner.inspector.v_${a}`)} onClick={() => set({ vAlign: a })}>
                {a === 'top' ? <AlignStartVertical size={14} className="rotate-90" /> : a === 'middle' ? <AlignVerticalJustifyCenter size={14} /> : <AlignEndVertical size={14} className="rotate-90" />}
              </Toggle>
            ))}
          </div>
          <ColorField label={t('printDesigner.inspector.color')} value={el.color} onChange={(color) => set({ color }, 'color')} />
          <Select
            label={t('printDesigner.inspector.fit')}
            value={el.fit}
            onChange={(fit) => set({ fit })}
            options={[
              { value: 'shrink', label: t('printDesigner.inspector.fitShrink') },
              { value: 'clip', label: t('printDesigner.inspector.fitClip') },
            ]}
          />
          <Check label={t('printDesigner.inspector.hideIfEmpty')} hint={t('printDesigner.inspector.hideIfEmptyHint')} checked={el.hideIfEmpty} onChange={(hideIfEmpty) => set({ hideIfEmpty })} />
        </Section>
      )}

      {el.type === 'image' && (
        <Section title={t('printDesigner.elements.image')}>
          <Select
            label={t('printDesigner.inspector.imageSource')}
            value={el.src === 'logo' ? 'logo' : 'upload'}
            onChange={(v) => (v === 'logo' ? set({ src: 'logo' }) : setMediaOpen(true))}
            options={[
              { value: 'logo', label: t('printDesigner.inspector.businessLogo') },
              { value: 'upload', label: t('printDesigner.inspector.uploadedImage') },
            ]}
          />
          <button type="button" onClick={() => setMediaOpen(true)} className="inline-flex items-center gap-1.5 text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50">
            <ImageIcon size={13} />
            {t('printDesigner.inspector.chooseImage')}
          </button>
          <Select
            label={t('printDesigner.inspector.imageFit')}
            value={el.fit}
            onChange={(fit) => set({ fit })}
            options={[
              { value: 'contain', label: t('printDesigner.inspector.imageContain') },
              { value: 'cover', label: t('printDesigner.inspector.imageCover') },
              { value: 'fill', label: t('printDesigner.inspector.imageFill') },
            ]}
          />
          <MediaLibraryModal
            open={mediaOpen}
            onClose={() => setMediaOpen(false)}
            onSelect={(asset) => {
              setMediaOpen(false);
              if (asset.url.startsWith('/uploads/')) set({ src: asset.url });
            }}
          />
        </Section>
      )}

      {el.type === 'line' && (
        <Section title={t('printDesigner.elements.line')}>
          <NumField label={t('printDesigner.inspector.thickness')} value={el.thickness} step={0.1} min={0.1} max={5} suffix="mm" onChange={(thickness) => set({ thickness }, 'th')} />
          <Select
            label={t('printDesigner.inspector.lineStyle')}
            value={el.lineStyle}
            onChange={(lineStyle) => set({ lineStyle })}
            options={[
              { value: 'solid', label: t('printDesigner.inspector.solid') },
              { value: 'dashed', label: t('printDesigner.inspector.dashed') },
              { value: 'dotted', label: t('printDesigner.inspector.dotted') },
            ]}
          />
          <ColorField label={t('printDesigner.inspector.color')} value={el.color} onChange={(color) => set({ color }, 'color')} />
        </Section>
      )}

      {el.type === 'rect' && (
        <Section title={t('printDesigner.elements.rect')}>
          <NumField label={t('printDesigner.inspector.borderWidth')} value={el.borderWidth} step={0.1} min={0} max={5} suffix="mm" onChange={(borderWidth) => set({ borderWidth }, 'bw')} />
          <ColorField label={t('printDesigner.inspector.borderColor')} value={el.borderColor} onChange={(borderColor) => set({ borderColor }, 'bc')} />
          <ColorField label={t('printDesigner.inspector.fill')} value={el.fill} allowNone onChange={(fill) => set({ fill }, 'fill')} />
          <NumField label={t('printDesigner.inspector.radius')} value={el.radius} step={0.5} min={0} max={20} suffix="mm" onChange={(radius) => set({ radius }, 'r')} />
          <Select
            label={t('printDesigner.inspector.lineStyle')}
            value={el.lineStyle}
            onChange={(lineStyle) => set({ lineStyle })}
            options={[
              { value: 'solid', label: t('printDesigner.inspector.solid') },
              { value: 'dashed', label: t('printDesigner.inspector.dashed') },
              { value: 'dotted', label: t('printDesigner.inspector.dotted') },
            ]}
          />
        </Section>
      )}

      <Section title={t('printDesigner.inspector.showIfTitle')}>
        <FieldSelect docType={docType} value={el.showIf} onChange={(showIf) => set({ showIf })} placeholder={t('printDesigner.inspector.always')} />
        <p className="text-[11px] text-gray-400">{t('printDesigner.inspector.showIfHint')}</p>
        <ElementActions onDelete={onDelete} onDuplicate={onDuplicate} onArrange={onArrange} />
      </Section>
    </div>
  );
}

function PageInspector({
  layout,
  onChange,
  onSelect,
  focusBand,
}: {
  layout: Layout;
  onChange: Change;
  onSelect: (s: Selection) => void;
  focusBand?: BandKey;
}) {
  const { t } = useLanguage();
  const m = layout.page.margins;
  const setMargin = (side: keyof typeof m, v: number) =>
    onChange((l) => ({ ...l, page: { ...l.page, margins: { ...l.page.margins, [side]: v } } }), `margin:${side}`);
  const bands: BandKey[] = ['pageHeader', 'header', 'footer', 'pageFooter'];
  return (
    <div>
      <Section title={t('printDesigner.inspector.bands')}>
        {bands.map((b) => (
          <div key={b} className={focusBand === b ? 'rounded bg-blue-50 -mx-1 px-1 py-1' : ''}>
            <NumField
              label={t(`printDesigner.bands.${b}`)}
              value={layout.bands[b].height}
              min={0}
              max={297}
              suffix="mm"
              onChange={(height) => onChange((l) => ({ ...l, bands: { ...l.bands, [b]: { ...l.bands[b], height } } }), `band:${b}`)}
            />
            {focusBand === b && <p className="text-[11px] text-gray-500 mt-1">{t(`printDesigner.bandHelp.${b}`)}</p>}
          </div>
        ))}
        <Check
          label={t('printDesigner.inspector.footerAtBottom')}
          hint={t('printDesigner.inspector.footerAtBottomHint')}
          checked={layout.footerAtBottom}
          onChange={(footerAtBottom) => onChange((l) => ({ ...l, footerAtBottom }))}
        />
        <button type="button" onClick={() => onSelect({ kind: 'table' })} className="text-xs text-blue-700 underline">
          {t('printDesigner.inspector.editTable')}
        </button>
      </Section>
      <Section title={t('printDesigner.inspector.margins')}>
        <div className="grid grid-cols-4 gap-1.5">
          <NumField label={t('printDesigner.inspector.top')} value={m.top} min={0} max={50} onChange={(v) => setMargin('top', v)} />
          <NumField label={t('printDesigner.inspector.right')} value={m.right} min={0} max={50} onChange={(v) => setMargin('right', v)} />
          <NumField label={t('printDesigner.inspector.bottom')} value={m.bottom} min={0} max={50} onChange={(v) => setMargin('bottom', v)} />
          <NumField label={t('printDesigner.inspector.left')} value={m.left} min={0} max={50} onChange={(v) => setMargin('left', v)} />
        </div>
        <p className="text-[11px] text-gray-400">{t('printDesigner.inspector.marginsHint')}</p>
      </Section>
      <Section title={t('printDesigner.inspector.baseFont')}>
        <div className="grid grid-cols-2 gap-1.5">
          <Select
            label={t('printDesigner.inspector.font')}
            value={layout.font.family}
            onChange={(family) => onChange((l) => ({ ...l, font: { ...l.font, family } }))}
            options={[
              { value: 'sans', label: 'Sans (Arial)' },
              { value: 'serif', label: 'Serif (Times)' },
              { value: 'mono', label: 'Mono (Courier)' },
            ]}
          />
          <NumField
            label={t('printDesigner.inspector.newTextSize')}
            value={layout.font.size}
            min={5}
            max={20}
            suffix="pt"
            onChange={(size) => onChange((l) => ({ ...l, font: { ...l.font, size } }), 'basefont')}
          />
        </div>
      </Section>
      <Section title={t('printDesigner.inspector.tipsTitle')}>
        <ul className="text-[11px] text-gray-500 list-disc pl-4 space-y-1">
          <li>{t('printDesigner.tips.drag')}</li>
          <li>{t('printDesigner.tips.keys')}</li>
          <li>{t('printDesigner.tips.multi')}</li>
          <li>{t('printDesigner.tips.alt')}</li>
          <li>{t('printDesigner.tips.bands')}</li>
        </ul>
      </Section>
    </div>
  );
}

function SortableColumn({
  id,
  col,
  label,
  onChange,
  onRemove,
}: {
  id: string;
  col: TableColumn;
  label: string;
  onChange: (patch: Partial<TableColumn>) => void;
  onRemove: () => void;
}) {
  const { t } = useLanguage();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className="border border-gray-200 rounded bg-white p-2"
    >
      <div className="flex items-center gap-1.5">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-gray-400 hover:text-gray-700" aria-label={t('printDesigner.inspector.dragToReorder')}>
          <GripVertical size={14} />
        </button>
        <span className="text-[11px] text-gray-500 truncate flex-1">{label}</span>
        <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-600" aria-label={t('common.delete')}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_4.5rem] gap-1.5 mt-1.5">
        <input className={inputSm} value={col.label} maxLength={60} onChange={(e) => onChange({ label: e.target.value })} aria-label={t('printDesigner.inspector.heading')} />
        <NumField label="" value={col.width} min={0} max={200} step={1} onChange={(width) => onChange({ width })} />
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        {(['left', 'center', 'right'] as Align[]).map((a) => (
          <Toggle key={a} active={col.align === a} title={t(`printDesigner.inspector.align_${a}`)} onClick={() => onChange({ align: a })}>
            {a === 'left' ? <AlignLeft size={12} /> : a === 'center' ? <AlignCenter size={12} /> : <AlignRight size={12} />}
          </Toggle>
        ))}
        <label className="ml-2 flex items-center gap-1 text-[11px] text-gray-600">
          <input type="checkbox" checked={col.hideIfEmpty} onChange={(e) => onChange({ hideIfEmpty: e.target.checked })} />
          {t('printDesigner.inspector.hideEmptyColumn')}
        </label>
      </div>
    </li>
  );
}

function TableInspector({ layout, docType, onChange }: { layout: Layout; docType: DocType; onChange: Change }) {
  const { t, language } = useLanguage();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const cfg = layout.table;
  const setCfg = (patch: Partial<TableConfig>, key?: string) => onChange((l) => ({ ...l, table: { ...l.table, ...patch } }), key);
  const setCol = (i: number, patch: Partial<TableColumn>) =>
    onChange(
      (l) => ({ ...l, table: { ...l.table, columns: l.table.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) } }),
      `col:${i}:${Object.keys(patch)[0]}`,
    );
  const available = columnsFor(docType);
  const labelOf = (key: ColumnKey) => {
    const c = available.find((x) => x.key === key);
    return c ? (language === 'id' ? c.id : c.en) : key;
  };
  const ids = cfg.columns.map((c, i) => `${c.key}-${i}`);
  const unused = available.filter((c) => !cfg.columns.some((x) => x.key === c.key));

  const onDragEnd = (e: DragEndEvent) => {
    const from = ids.indexOf(String(e.active.id));
    const to = e.over ? ids.indexOf(String(e.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    onChange((l) => ({ ...l, table: { ...l.table, columns: arrayMove(l.table.columns, from, to) } }));
  };

  return (
    <div>
      <Section title={t('printDesigner.inspector.columns')}>
        <p className="text-[11px] text-gray-400">{t('printDesigner.inspector.columnsHint')}</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {cfg.columns.map((c, i) => (
                <SortableColumn
                  key={ids[i]}
                  id={ids[i]}
                  col={c}
                  label={labelOf(c.key)}
                  onChange={(patch) => setCol(i, patch)}
                  onRemove={() =>
                    cfg.columns.length > 1 && onChange((l) => ({ ...l, table: { ...l.table, columns: l.table.columns.filter((_, j) => j !== i) } }))
                  }
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {unused.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Plus size={14} className="text-gray-500" />
            <select
              className={inputSm}
              value=""
              onChange={(e) => {
                const key = e.target.value as ColumnKey;
                if (!key) return;
                const def = available.find((c) => c.key === key)!;
                onChange((l) => ({
                  ...l,
                  table: {
                    ...l.table,
                    columns: [
                      ...l.table.columns,
                      { key, label: language === 'id' ? def.id : def.en, width: key === 'name' ? 0 : 22, align: NUMERIC_COLUMNS.includes(key) ? 'right' : 'left', hideIfEmpty: false },
                    ],
                  },
                }));
              }}
            >
              <option value="">{t('printDesigner.inspector.addColumn')}</option>
              {unused.map((c) => (
                <option key={c.key} value={c.key}>
                  {language === 'id' ? c.id : c.en}
                </option>
              ))}
            </select>
          </div>
        )}
      </Section>
      <Section title={t('printDesigner.inspector.tableStyle')}>
        <div className="grid grid-cols-2 gap-1.5">
          <NumField label={t('printDesigner.inspector.rowText')} value={cfg.fontSize} min={5} max={16} suffix="pt" onChange={(fontSize) => setCfg({ fontSize }, 'tfs')} />
          <NumField label={t('printDesigner.inspector.headerText')} value={cfg.headerFontSize} min={5} max={16} suffix="pt" onChange={(headerFontSize) => setCfg({ headerFontSize }, 'thfs')} />
          <NumField label={t('printDesigner.inspector.rowPadding')} value={cfg.rowPadding} step={0.25} min={0} max={6} suffix="mm" onChange={(rowPadding) => setCfg({ rowPadding }, 'pad')} />
          <NumField label={t('printDesigner.inspector.minRows')} value={cfg.minRows} step={1} min={0} max={60} onChange={(minRows) => setCfg({ minRows: Math.round(minRows) }, 'min')} />
          <NumField label={t('printDesigner.inspector.gapBefore')} value={cfg.gapBefore} min={0} max={50} suffix="mm" onChange={(gapBefore) => setCfg({ gapBefore }, 'gb')} />
          <NumField label={t('printDesigner.inspector.gapAfter')} value={cfg.gapAfter} min={0} max={50} suffix="mm" onChange={(gapAfter) => setCfg({ gapAfter }, 'ga')} />
        </div>
        <Select
          label={t('printDesigner.inspector.borders')}
          value={cfg.borders}
          onChange={(borders) => setCfg({ borders })}
          options={[
            { value: 'rows', label: t('printDesigner.inspector.bordersRows') },
            { value: 'grid', label: t('printDesigner.inspector.bordersGrid') },
            { value: 'outer', label: t('printDesigner.inspector.bordersOuter') },
            { value: 'none', label: t('printDesigner.inspector.bordersNone') },
          ]}
        />
        <ColorField label={t('printDesigner.inspector.borderColor')} value={cfg.borderColor} onChange={(borderColor) => setCfg({ borderColor }, 'bc')} />
        <Check label={t('printDesigner.inspector.headerBold')} checked={cfg.headerBold} onChange={(headerBold) => setCfg({ headerBold })} />
        <ColorField label={t('printDesigner.inspector.headerBg')} value={cfg.headerBg} allowNone onChange={(headerBg) => setCfg({ headerBg }, 'hbg')} />
        <ColorField label={t('printDesigner.inspector.headerColor')} value={cfg.headerColor} onChange={(headerColor) => setCfg({ headerColor }, 'hc')} />
        <ColorField label={t('printDesigner.inspector.zebra')} value={cfg.zebra} allowNone onChange={(zebra) => setCfg({ zebra }, 'zebra')} />
      </Section>
    </div>
  );
}
