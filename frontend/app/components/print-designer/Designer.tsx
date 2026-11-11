'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  Grid3x3,
  Magnet,
  PencilRuler,
  Redo2,
  Save,
  Tag,
  Undo2,
  ZoomIn,
  ZoomOut,
  CheckCircle2,
} from 'lucide-react';
import MediaLibraryModal from '@/app/components/shared/MediaLibraryModal';
import { useLanguage } from '@/app/context/LanguageContext';
import { FIELDS } from '@/lib/print-designer/fields';
import { samplePrintData } from '@/lib/print-designer/context';
import { checkLayout, useLayoutHistory, type Warning } from '@/lib/print-designer/editor-state';
import { imageEl, lineEl, rectEl, textEl } from '@/lib/print-designer/starters';
import { contentWidth, newElementId, type BandKey, type Layout, type LayoutElement, type PaperSize, type PrintTemplate } from '@/lib/print-designer/types';
import { DesignCanvas, type DropPayload, type Selection } from './DesignCanvas';
import { Inspector } from './Inspector';
import { Palette } from './Palette';
import { TemplateDocument } from './TemplateDocument';

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
const RIGHT_ALIGNED_FIELDS = /^totals\.(subtotal|discount|tax|total|paid|balance)$/;

export type BusinessInfo = { name?: string | null; branch?: string | null; legalName?: string | null; address?: string | null; phone?: string | null; npwp?: string | null; logoUrl?: string | null };

// The full-screen print designer: palette on the left, the page in the
// middle (bands you drop boxes into), properties on the right.
export function Designer({
  template,
  business,
  onSave,
}: {
  template: PrintTemplate;
  business: BusinessInfo;
  onSave: (input: { name: string; paperSize: PaperSize; layout: Layout }) => Promise<string | null>;
}) {
  const { t, language } = useLanguage();
  const history = useLayoutHistory(template.layout);
  const { layout } = history;
  const [name, setName] = useState(template.name);
  const [paper, setPaper] = useState<PaperSize>(template.paperSize);
  const [saved, setSaved] = useState({ layout: template.layout, name: template.name, paper: template.paperSize });
  const [selection, setSelection] = useState<Selection>(null);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<'design' | 'preview'>('design');
  const [stress, setStress] = useState(false);
  const [snap, setSnap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showNames, setShowNames] = useState(false);
  const [grid] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [overflowIds, setOverflowIds] = useState<Set<string>>(new Set());
  const [tableHead, setTableHead] = useState(8);
  const [pendingImage, setPendingImage] = useState<{ band: BandKey; x: number; y: number } | null>(null);
  const clipboard = useRef<{ band: BandKey; els: LayoutElement[] } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const marqueeStartRef = useRef<((e: React.PointerEvent) => void) | null>(null);

  const dirty = layout !== saved.layout || name !== saved.name || paper !== saved.paper;
  const lang = language === 'id' ? 'id' : 'en';

  const sample = useMemo(
    () => samplePrintData(template.docType, business, { lines: stress ? 40 : 4, long: stress, locale: lang }),
    [template.docType, business, stress, lang],
  );
  const designSample = useMemo(() => samplePrintData(template.docType, business, { lines: 3, locale: lang }), [template.docType, business, lang]);
  const fieldNames = useMemo(
    () => Object.fromEntries(FIELDS.map((f) => [f.key, `‹${lang === 'id' ? f.id : f.en}›`])),
    [lang],
  );
  const designValues = showNames ? fieldNames : { ...designSample.fields, 'page.number': '1', 'page.count': '2' };

  // Leaving with unsaved work asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Text that doesn't fit its box, and the table header's height, read off
  // the design canvas after each change, for the warnings.
  useLayoutEffect(() => {
    if (mode !== 'design') return;
    const root = canvasRef.current;
    if (!root) return;
    const ids = new Set<string>();
    root.querySelectorAll<HTMLElement>('[data-overflow="1"]').forEach((n) => n.dataset.el && ids.add(n.dataset.el));
    setOverflowIds((prev) => (prev.size === ids.size && [...ids].every((i) => prev.has(i)) ? prev : ids));
    const head = root.querySelector('[data-head]');
    if (head) {
      const scale = zoom || 1;
      setTableHead(head.getBoundingClientRect().height / scale / (96 / 25.4));
    }
  }, [layout, mode, zoom, showNames, paper]);

  const warnings = useMemo(() => checkLayout(layout, paper, tableHead, overflowIds), [layout, paper, tableHead, overflowIds]);

  const W = contentWidth(layout, paper);

  // ---- adding ----------------------------------------------------------

  const addElements = useCallback(
    (band: BandKey, els: LayoutElement[]) => {
      history.change((l) => ({ ...l, bands: { ...l.bands, [band]: { ...l.bands[band], elements: [...l.bands[band].elements, ...els] } } }));
      setSelection({ kind: 'elements', band, ids: els.map((e) => e.id) });
    },
    [history],
  );

  const makeElement = useCallback(
    (payload: DropPayload, x: number, y: number): LayoutElement | null => {
      const size = layout.font.size;
      const lineH = Math.round(size * 0.55 * 2) / 2 + 1;
      if ('field' in payload) {
        const right = RIGHT_ALIGNED_FIELDS.test(payload.field);
        const wide = /address|notes|terms|complaint|words/.test(payload.field);
        return textEl(x, y, wide ? 80 : 50, wide ? lineH * 2 : lineH, `{${payload.field}}`, { fontSize: size, align: right ? 'right' : 'left' });
      }
      switch (payload.add) {
        case 'text':
          return textEl(x, y, 50, lineH, t('printDesigner.palette.newText'), { fontSize: size, hideIfEmpty: false });
        case 'hline':
          return lineEl(x, y, 60, 0);
        case 'vline':
          return lineEl(x, y, 0, 20);
        case 'rect':
          return rectEl(x, y, 50, 20);
        case 'logo':
          return imageEl(x, y, 22, 22, 'logo');
        case 'image':
          return null;
      }
    },
    [layout.font.size, t],
  );

  const onDrop = useCallback(
    (band: BandKey, x: number, y: number, payload: DropPayload) => {
      if ('add' in payload && payload.add === 'image') {
        setPendingImage({ band, x, y });
        return;
      }
      const el = makeElement(payload, Math.max(0, Math.min(x, W - 10)), Math.max(0, y));
      if (el) addElements(band, [el]);
    },
    [addElements, makeElement, W],
  );

  // Clicked in the palette: into the selected band (or the header), below
  // whatever is already there.
  const onAdd = useCallback(
    (payload: DropPayload) => {
      const band: BandKey =
        selection?.kind === 'elements' || selection?.kind === 'band' ? selection.band : 'header';
      const els = layout.bands[band].elements;
      const y = els.length ? Math.max(...els.map((e) => e.y + e.h)) + 1 : 0;
      onDrop(band, 0, Math.min(y, Math.max(0, layout.bands[band].height - 5)), payload);
    },
    [selection, layout.bands, onDrop],
  );

  // ---- editing the selection -------------------------------------------

  const deleteSelection = useCallback(() => {
    if (selection?.kind !== 'elements') return;
    const { band, ids } = selection;
    history.change((l) => ({ ...l, bands: { ...l.bands, [band]: { ...l.bands[band], elements: l.bands[band].elements.filter((e) => !ids.includes(e.id)) } } }));
    setSelection(null);
  }, [selection, history]);

  const duplicateSelection = useCallback(
    (offset = 3) => {
      if (selection?.kind !== 'elements') return;
      const { band, ids } = selection;
      const copies = layout.bands[band].elements
        .filter((e) => ids.includes(e.id))
        .map((e) => ({ ...e, id: newElementId(), x: e.x + offset, y: e.y + offset }));
      addElements(band, copies);
    },
    [selection, layout.bands, addElements],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (selection?.kind !== 'elements') return;
      const { band, ids } = selection;
      history.change(
        (l) => ({
          ...l,
          bands: {
            ...l.bands,
            [band]: {
              ...l.bands[band],
              elements: l.bands[band].elements.map((e) =>
                ids.includes(e.id) ? { ...e, x: Math.round((e.x + dx) * 100) / 100, y: Math.round((e.y + dy) * 100) / 100 } : e,
              ),
            },
          },
        }),
        `nudge:${ids.join(',')}`,
      );
    },
    [selection, history],
  );

  const arrange = useCallback(
    (to: 'front' | 'back') => {
      if (selection?.kind !== 'elements') return;
      const { band, ids } = selection;
      history.change((l) => {
        const els = l.bands[band].elements;
        const picked = els.filter((e) => ids.includes(e.id));
        const rest = els.filter((e) => !ids.includes(e.id));
        return { ...l, bands: { ...l.bands, [band]: { ...l.bands[band], elements: to === 'front' ? [...rest, ...picked] : [...picked, ...rest] } } };
      });
    },
    [selection, history],
  );

  const align = useCallback(
    (how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
      if (selection?.kind !== 'elements') return;
      const { band, ids } = selection;
      const els = layout.bands[band].elements.filter((e) => ids.includes(e.id));
      if (els.length < 2) return;
      const minX = Math.min(...els.map((e) => e.x));
      const maxX = Math.max(...els.map((e) => e.x + e.w));
      const minY = Math.min(...els.map((e) => e.y));
      const maxY = Math.max(...els.map((e) => e.y + e.h));
      const place = (e: LayoutElement): LayoutElement => {
        switch (how) {
          case 'left':
            return { ...e, x: minX };
          case 'right':
            return { ...e, x: maxX - e.w };
          case 'hcenter':
            return { ...e, x: Math.round(((minX + maxX) / 2 - e.w / 2) * 100) / 100 };
          case 'top':
            return { ...e, y: minY };
          case 'bottom':
            return { ...e, y: maxY - e.h };
          case 'vcenter':
            return { ...e, y: Math.round(((minY + maxY) / 2 - e.h / 2) * 100) / 100 };
        }
      };
      history.change((l) => ({
        ...l,
        bands: { ...l.bands, [band]: { ...l.bands[band], elements: l.bands[band].elements.map((e) => (ids.includes(e.id) ? place(e) : e)) } },
      }));
    },
    [selection, layout.bands, history],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const error = await onSave({ name: name.trim() || template.name, paperSize: paper, layout });
    setSaving(false);
    if (error) {
      setSaveError(error);
      return;
    }
    setSaved({ layout, name, paper });
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }, [onSave, name, paper, layout, template.name]);

  // ---- keyboard --------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
        return;
      }
      if (mode !== 'design') return;
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c' && selection?.kind === 'elements') {
        clipboard.current = { band: selection.band, els: layout.bands[selection.band].elements.filter((x) => selection.ids.includes(x.id)) };
        return;
      }
      if (mod && e.key.toLowerCase() === 'v' && clipboard.current) {
        e.preventDefault();
        const band = selection?.kind === 'elements' || selection?.kind === 'band' ? selection.band : clipboard.current.band;
        addElements(
          band,
          clipboard.current.els.map((x) => ({ ...x, id: newElementId(), x: x.x + 3, y: x.y + 3 })),
        );
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection?.kind === 'elements') {
          e.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (e.key === 'Escape') {
        setSelection(null);
        return;
      }
      const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 0.5;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key] && selection?.kind === 'elements') {
        e.preventDefault();
        nudge(...moves[e.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, mode, selection, layout.bands, duplicateSelection, deleteSelection, nudge, addElements, save]);

  const bandLabels = {
    pageHeader: t('printDesigner.bands.pageHeader'),
    header: t('printDesigner.bands.header'),
    table: t('printDesigner.bands.table'),
    footer: t('printDesigner.bands.footer'),
    pageFooter: t('printDesigner.bands.pageFooter'),
  };

  const errors = warnings.filter((w) => w.level === 'error').length;

  const selectWarning = (w: Warning) => {
    setMode('design');
    if (w.band && w.elementId) setSelection({ kind: 'elements', band: w.band, ids: [w.elementId] });
  };

  const zoomIdx = ZOOMS.indexOf(zoom);
  const btn = 'inline-flex items-center gap-1 rounded border px-2 py-1.5 text-xs font-medium disabled:opacity-40';
  const btnOff = `${btn} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
  const btnOn = `${btn} border-blue-600 bg-blue-600 text-white`;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-gray-100 text-black">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 flex-wrap">
        <Link href="/settings/print-designs" className={btnOff} aria-label={t('common.back')}>
          <ArrowLeft size={14} />
        </Link>
        <input
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-sm font-semibold w-48"
          aria-label={t('printDesigner.list.name')}
        />
        <span className="text-xs text-gray-500 hidden md:inline">
          {t(`printDesigner.docTypes.${template.docType}`)}
          {template.branch ? ` · ${template.branch.name}` : ''}
        </span>
        <select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)} className="border border-gray-300 rounded px-2 py-1 text-xs" aria-label={t('printDesigner.list.paper')}>
          <option value="A4">{t('printDesigner.paper.A4')}</option>
          <option value="A5">{t('printDesigner.paper.A5')}</option>
        </select>
        <span className="w-px h-6 bg-gray-200" />
        <button type="button" className={btnOff} onClick={history.undo} disabled={!history.canUndo} title={t('printDesigner.toolbar.undo')} aria-label={t('printDesigner.toolbar.undo')}>
          <Undo2 size={14} />
        </button>
        <button type="button" className={btnOff} onClick={history.redo} disabled={!history.canRedo} title={t('printDesigner.toolbar.redo')} aria-label={t('printDesigner.toolbar.redo')}>
          <Redo2 size={14} />
        </button>
        <span className="w-px h-6 bg-gray-200" />
        <button type="button" className={btnOff} onClick={() => setZoom(ZOOMS[Math.max(0, zoomIdx - 1)])} disabled={zoomIdx <= 0} aria-label={t('printDesigner.toolbar.zoomOut')}>
          <ZoomOut size={14} />
        </button>
        <span className="text-xs w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" className={btnOff} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIdx + 1)])} disabled={zoomIdx >= ZOOMS.length - 1} aria-label={t('printDesigner.toolbar.zoomIn')}>
          <ZoomIn size={14} />
        </button>
        <span className="w-px h-6 bg-gray-200" />
        <div className="inline-flex rounded border border-gray-300 overflow-hidden">
          <button type="button" className={`${mode === 'design' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'} inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium`} onClick={() => setMode('design')}>
            <PencilRuler size={14} />
            {t('printDesigner.toolbar.design')}
          </button>
          <button type="button" className={`${mode === 'preview' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'} inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium`} onClick={() => setMode('preview')}>
            <Eye size={14} />
            {t('printDesigner.toolbar.preview')}
          </button>
        </div>
        {mode === 'design' ? (
          <>
            <button type="button" className={snap ? btnOn : btnOff} onClick={() => setSnap((s) => !s)} title={t('printDesigner.toolbar.snapHint')}>
              <Magnet size={14} />
              <span className="hidden lg:inline">{t('printDesigner.toolbar.snap')}</span>
            </button>
            <button type="button" className={showGrid ? btnOn : btnOff} onClick={() => setShowGrid((s) => !s)}>
              <Grid3x3 size={14} />
              <span className="hidden lg:inline">{t('printDesigner.toolbar.grid')}</span>
            </button>
            <button type="button" className={showNames ? btnOn : btnOff} onClick={() => setShowNames((s) => !s)} title={t('printDesigner.toolbar.fieldNamesHint')}>
              <Tag size={14} />
              <span className="hidden lg:inline">{t('printDesigner.toolbar.fieldNames')}</span>
            </button>
          </>
        ) : (
          <>
            <div className="inline-flex rounded border border-gray-300 overflow-hidden text-xs">
              <button type="button" className={`${!stress ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'} px-2 py-1.5`} onClick={() => setStress(false)}>
                {t('printDesigner.toolbar.fewLines')}
              </button>
              <button type="button" className={`${stress ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'} px-2 py-1.5`} onClick={() => setStress(true)}>
                {t('printDesigner.toolbar.manyLines')}
              </button>
            </div>
            <span className="text-xs text-gray-600">{t('printDesigner.toolbar.pages', { n: pageCount })}</span>
          </>
        )}
        <span className="flex-1" />
        {saveError && <span className="text-xs text-red-700 max-w-xs truncate" title={saveError}>{saveError}</span>}
        {justSaved && !dirty && (
          <span className="text-xs text-green-700 inline-flex items-center gap-1">
            <CheckCircle2 size={14} />
            {t('printDesigner.toolbar.saved')}
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? t('printDesigner.toolbar.saving') : t('printDesigner.toolbar.save')}
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {mode === 'design' && (
          <aside className="w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-white hidden md:block">
            <Palette docType={template.docType} onAdd={onAdd} />
          </aside>
        )}

        <div
          className="flex-1 overflow-auto"
          onPointerDown={(e) => {
            // Empty grey space: start a selection rectangle (design) or just deselect.
            if (e.target !== e.currentTarget && e.target !== canvasRef.current) return;
            if (mode === 'design' && marqueeStartRef.current) marqueeStartRef.current(e);
            else setSelection(null);
          }}
        >
          <div ref={canvasRef} className="w-fit mx-auto py-8" style={{ paddingLeft: '34mm', paddingRight: '10mm' }}>
            {mode === 'design' ? (
              <DesignCanvas
                layout={layout}
                paper={paper}
                zoom={zoom}
                values={designValues}
                logoUrl={business.logoUrl ?? null}
                rows={designSample.rows}
                selection={selection}
                snap={snap}
                grid={grid}
                showGrid={showGrid}
                bandLabels={bandLabels}
                onSelect={setSelection}
                onDrop={onDrop}
                history={history}
                marqueeStartRef={marqueeStartRef}
              />
            ) : (
              <div style={{ zoom }}>
                <TemplateDocument layout={layout} paper={paper} data={sample} pageGap={8} onPageCount={setPageCount} />
              </div>
            )}
          </div>
        </div>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-gray-200 bg-white">
          {warnings.length > 0 && (
            <div className={`border-b px-3 py-2 ${errors ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className={`flex items-center gap-1.5 text-xs font-semibold ${errors ? 'text-red-800' : 'text-amber-800'}`}>
                <AlertTriangle size={14} />
                {t('printDesigner.warnings.title', { n: warnings.length })}
              </p>
              <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                {warnings.map((w, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => selectWarning(w)}
                      className={`text-left text-[11px] hover:underline ${w.level === 'error' ? 'text-red-800' : 'text-amber-900'}`}
                    >
                      {w.band ? `${bandLabels[w.band]}: ` : ''}
                      {t(`printDesigner.warnings.${w.key}`, w.vars)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mode === 'design' ? (
            <Inspector
              layout={layout}
              docType={template.docType}
              selection={selection}
              onChange={history.change}
              onSelect={setSelection}
              onDelete={deleteSelection}
              onDuplicate={() => duplicateSelection()}
              onArrange={arrange}
              onAlign={align}
            />
          ) : (
            <div className="px-3 py-3 text-xs text-gray-600 space-y-2">
              <p>{t('printDesigner.preview.about')}</p>
              <p>{t('printDesigner.preview.stress')}</p>
            </div>
          )}
        </aside>
      </div>

      <MediaLibraryModal
        open={!!pendingImage}
        onClose={() => setPendingImage(null)}
        onSelect={(asset) => {
          const at = pendingImage;
          setPendingImage(null);
          if (at && asset.url.startsWith('/uploads/')) addElements(at.band, [imageEl(at.x, at.y, 30, 20, asset.url)]);
        }}
      />
    </div>
  );
}
