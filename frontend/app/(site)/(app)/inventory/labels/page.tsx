'use client';

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import {
  Tag, Printer, Minus, Plus, Search, X, Barcode as BarcodeIcon, QrCode, Settings2,
  ChevronDown, ChevronUp, AlertTriangle, Truck, Crosshair,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import PrintLabels, {
  LabelFace, resolveLabelFormat, type LabelFormat, type LabelItem, type PrintJob,
} from '@/app/components/shared/PrintLabels';
import Pagination from '@/app/components/shared/Pagination';
import { useLanguage } from '@/app/context/LanguageContext';
import {
  DEFAULT_PRINTER_SETTINGS, LABEL_LAYOUTS, getLayout, labelsPerPage,
  type LabelLayout, type PrinterSettings,
} from '@/lib/labels/layouts';

const SETTINGS_STORAGE_KEY = 'label-printer-settings';
const MAX_LABELS_PER_PRINT = 2000;
const PREVIEW_WIDTH_PX = 150;
const PX_PER_MM = 96 / 25.4;

// Printer settings describe the printer attached to THIS device, so they
// live in localStorage — and every access is guarded, since storage can be
// unavailable (private mode, blocked site data).
function loadSettings(): PrinterSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return { ...DEFAULT_PRINTER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // fall through to defaults
  }
  return DEFAULT_PRINTER_SETTINGS;
}

function saveSettings(settings: PrinterSettings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // per-device convenience only
  }
}

// Scaled-down, true-to-layout preview of what will print.
function LabelPreview({ item, format, layout, dpi }: { item: LabelItem; format: LabelFormat; layout: LabelLayout; dpi: number }) {
  const scale = PREVIEW_WIDTH_PX / (layout.labelWidthMm * PX_PER_MM);
  return (
    <div
      className="border border-gray-300 rounded-sm overflow-hidden bg-white"
      style={{ width: PREVIEW_WIDTH_PX, height: layout.labelHeightMm * PX_PER_MM * scale }}
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <LabelFace item={item} format={format} layout={layout} dpi={dpi} />
      </div>
    </div>
  );
}

const LabelCard = memo(function LabelCard({
  item,
  quantity,
  format,
  layout,
  dpi,
  onBump,
  onSetQty,
  onPrint,
}: {
  item: LabelItem;
  quantity: number;
  format: LabelFormat;
  layout: LabelLayout;
  dpi: number;
  onBump: (sku: string, delta: number) => void;
  onSetQty: (sku: string, qty: number) => void;
  onPrint: (item: LabelItem) => void;
}) {
  const { t } = useLanguage();
  const { reason } = resolveLabelFormat(item, format, layout, dpi);
  return (
    <div className="border-2 border-gray-300 rounded-lg p-3 sm:p-4 flex flex-col items-center gap-2.5 sm:gap-3 bg-white hover:border-blue-500/40 hover:shadow-sm transition-colors">
      <LabelPreview item={item} format={format} layout={layout} dpi={dpi} />
      {reason && (
        <p className="flex items-start gap-1 text-[11px] leading-tight text-amber-700 text-center">
          <AlertTriangle size={12} strokeWidth={2} className="shrink-0 mt-px" />
          {reason === 'tooLong' ? t('inventory.labelsPage.qrFallbackTooLong') : t('inventory.labelsPage.qrFallbackCharacters')}
        </p>
      )}

      <div className="flex flex-col gap-2 w-full pt-1 border-t border-gray-100">
        <div className="flex items-center justify-center border border-gray-300 rounded-md overflow-hidden self-center">
          <button
            type="button"
            onClick={() => onBump(item.sku, -1)}
            aria-label={t('inventory.labelsPage.decreaseQty', { sku: item.sku })}
            className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 active:bg-gray-200 hover:text-black disabled:opacity-30 disabled:hover:bg-transparent"
            disabled={quantity <= 1}
          >
            <Minus size={14} strokeWidth={2.5} />
          </button>
          <input
            type="number"
            min={1}
            max={1000}
            value={quantity}
            onChange={(e) => onSetQty(item.sku, parseInt(e.target.value, 10))}
            aria-label={t('inventory.labelsPage.quantityFor', { sku: item.sku })}
            className="w-12 sm:w-11 h-9 sm:h-7 text-sm sm:text-xs text-center font-medium border-x border-gray-300 focus:outline-none focus:bg-gray-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button data-tour="lbl-qty"
            type="button"
            onClick={() => onBump(item.sku, 1)}
            aria-label={t('inventory.labelsPage.increaseQty', { sku: item.sku })}
            className="w-9 h-9 sm:w-7 sm:h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 active:bg-gray-200 hover:text-black disabled:opacity-30 disabled:hover:bg-transparent"
            disabled={quantity >= 1000}
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        </div>

        <button data-tour="lbl-item-print"
          onClick={() => onPrint(item)}
          className="w-full flex items-center justify-center gap-1.5 bg-blue-600 text-white px-2 py-2 sm:py-1.5 rounded-md text-xs font-semibold hover:bg-blue-700 active:scale-[0.98] transition-transform"
        >
          <Printer size={14} strokeWidth={2} />
          {t('common.print')} {quantity > 1 ? `×${quantity}` : ''}
        </button>
      </div>
    </div>
  );
});

type ImportBatch = {
  id: string;
  createdAt: string;
  items: { productId: string; sku: string | null; name: string; qty: number }[];
};

export default function LabelsPage() {
  // useSearchParams() needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <LabelsPageInner />
    </Suspense>
  );
}

function LabelsPageInner() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?batch=<importBatchId>: labels for one imported delivery, one per unit.
  const batchId = searchParams.get('batch');
  const dateLocale = language === 'id' ? 'id-ID' : 'en-US';

  const [items, setItems] = useState<LabelItem[]>([]);
  const [withoutSku, setWithoutSku] = useState(0);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [job, setJob] = useState<PrintJob | null>(null);
  const [format, setFormat] = useState<LabelFormat>('barcode');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  // This subtree renders client-side only (useSearchParams under Suspense
  // bails out of prerendering), so reading localStorage here is safe.
  const [settings, setSettings] = useState<PrinterSettings>(() =>
    typeof window === 'undefined' ? DEFAULT_PRINTER_SETTINGS : loadSettings(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startAt, setStartAt] = useState(1);
  const layout = getLayout(settings.layoutId);

  function updateSettings(patch: Partial<PrinterSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      // Picking a stock type implies the usual printer for it: roll labels
      // go on a 203 dpi thermal printer, sheets on an office printer.
      if (patch.layoutId && !patch.dpi) {
        next.dpi = getLayout(patch.layoutId).kind === 'roll' ? 203 : 600;
      }
      saveSettings(next);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        if (batchId) {
          const res = await apiFetch(`/stock/import-batches/${encodeURIComponent(batchId)}`);
          if (!res.ok) throw new Error(t('inventory.labelsPage.batchLoadFailed'));
          const data: ImportBatch = await res.json();
          if (cancelled) return;
          // One label per unit that arrived, merged across locations.
          const qtyBySku = new Map<string, { item: LabelItem; qty: number }>();
          let missing = 0;
          for (const row of data.items) {
            if (!row.sku) { missing++; continue; }
            const entry = qtyBySku.get(row.sku) ?? { item: { sku: row.sku, name: row.name }, qty: 0 };
            entry.qty += row.qty;
            qtyBySku.set(row.sku, entry);
          }
          const entries = [...qtyBySku.values()].filter((e) => e.qty > 0);
          setBatch(data);
          setItems(entries.map((e) => e.item));
          setWithoutSku(missing);
          setQuantities(Object.fromEntries(entries.map((e) => [e.item.sku, Math.min(1000, Math.max(1, Math.round(e.qty)))])));
        } else {
          const res = await apiFetch('/products');
          if (!res.ok) throw new Error(t('inventory.labelsPage.loadFailed'));
          const data: { sku: string | null; name: string }[] = await res.json();
          if (cancelled) return;
          const labelled = data.filter((p): p is LabelItem => !!p.sku?.trim());
          setBatch(null);
          setItems(labelled);
          setWithoutSku(data.length - labelled.length);
          setQuantities(Object.fromEntries(labelled.map((i) => [i.sku, 1])));
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [batchId, t]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.sku.toLowerCase().includes(q) || item.name.toLowerCase().includes(q));
  }, [items, query]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const paginatedItems = useMemo(
    () => filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredItems, safePage, pageSize],
  );

  // How many of the matching labels will print as QR instead of a barcode.
  const fallbackCount = useMemo(
    () => (format === 'barcode'
      ? filteredItems.filter((i) => resolveLabelFormat(i, format, layout, settings.dpi).reason).length
      : 0),
    [filteredItems, format, layout, settings.dpi],
  );

  const setQty = useCallback((sku: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [sku]: Math.max(1, Math.min(1000, qty || 1)) }));
  }, []);

  const bumpQty = useCallback((sku: string, delta: number) => {
    setQuantities((prev) => ({ ...prev, [sku]: Math.max(1, Math.min(1000, (prev[sku] ?? 1) + delta)) }));
  }, []);

  // Read through refs so `print` (and every memoized LabelCard's onPrint)
  // stays stable while quantities are being edited.
  const quantitiesRef = useRef(quantities);
  const settingsRef = useRef(settings);
  const formatRef = useRef(format);
  const startAtRef = useRef(startAt);
  useEffect(() => {
    quantitiesRef.current = quantities;
    settingsRef.current = settings;
    formatRef.current = format;
    startAtRef.current = startAt;
  }, [quantities, settings, format, startAt]);

  const print = useCallback((source: LabelItem[]) => {
    const list = source.flatMap((item) => Array.from({ length: quantitiesRef.current[item.sku] ?? 1 }, () => item));
    if (list.length === 0) return;
    if (list.length > MAX_LABELS_PER_PRINT && !window.confirm(t('inventory.labelsPage.confirmLargePrint', { count: list.length }))) {
      return;
    }
    setJob({ items: list, format: formatRef.current, settings: settingsRef.current, startAt: startAtRef.current });
  }, [t]);

  const printOne = useCallback((item: LabelItem) => print([item]), [print]);
  const printTest = () => {
    const sample = { sku: 'TEST-12345', name: t('inventory.labelsPage.testLabelName') };
    const count = layout.kind === 'roll' ? 1 : labelsPerPage(layout);
    setJob({ items: Array.from({ length: count }, () => sample), format, settings, test: true });
  };
  const clearJob = useCallback(() => setJob(null), []);

  const totalToPrint = filteredItems.reduce((sum, i) => sum + (quantities[i.sku] ?? 1), 0);

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Tag size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                  {t('inventory.labelsPage.title')}
                </h1>
                <p className="text-xs text-gray-500 truncate">
                  {t('inventory.labelsPage.totalToPrint', { count: totalToPrint })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center border border-gray-300 rounded-md overflow-hidden shrink-0">
                <button data-tour="lbl-format"
                  type="button"
                  onClick={() => setFormat('barcode')}
                  aria-pressed={format === 'barcode'}
                  className={`flex items-center gap-1.5 px-3 py-2.5 sm:py-2 text-xs font-semibold transition-colors ${
                    format === 'barcode' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <BarcodeIcon size={14} strokeWidth={2} />
                  {t('inventory.labelsPage.formatBarcode')}
                </button>
                <button
                  type="button"
                  onClick={() => setFormat('qrcode')}
                  aria-pressed={format === 'qrcode'}
                  className={`flex items-center gap-1.5 px-3 py-2.5 sm:py-2 text-xs font-semibold border-l border-gray-300 transition-colors ${
                    format === 'qrcode' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <QrCode size={14} strokeWidth={2} />
                  {t('inventory.labelsPage.formatQrCode')}
                </button>
              </div>

              <button data-tour="lbl-print-all"
                onClick={() => print(filteredItems)}
                disabled={filteredItems.length === 0}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 sm:py-2 rounded-md font-semibold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:hover:bg-blue-600 transition-colors"
              >
                <Printer size={18} strokeWidth={2} />
                {query ? t('inventory.labelsPage.printAllMatches') : t('inventory.labelsPage.printAll')}
              </button>
            </div>
          </div>

          {/* Printer setup — per device */}
          <div className="mt-3 border border-blue-500/15 rounded-xl bg-white">
            <button data-tour="lbl-settings"
              onClick={() => setSettingsOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2 font-semibold text-gray-700 min-w-0">
                <Settings2 size={15} strokeWidth={2} className="text-blue-700 shrink-0" />
                <span className="truncate">
                  {t(`inventory.labelsPage.layouts.${layout.id}`)} · {settings.dpi} dpi
                </span>
              </span>
              {settingsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {settingsOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-100 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-gray-600 space-y-1">
                    <span className="block">{t('inventory.labelsPage.labelStock')}</span>
                    <select
                      value={settings.layoutId}
                      onChange={(e) => updateSettings({ layoutId: e.target.value })}
                      className="w-full border-2 border-gray-300 rounded-md p-2 text-sm font-normal"
                    >
                      {LABEL_LAYOUTS.map((l) => (
                        <option key={l.id} value={l.id}>{t(`inventory.labelsPage.layouts.${l.id}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-gray-600 space-y-1">
                    <span className="block">{t('inventory.labelsPage.printerResolution')}</span>
                    <select
                      value={settings.dpi}
                      onChange={(e) => updateSettings({ dpi: Number(e.target.value) as PrinterSettings['dpi'] })}
                      className="w-full border-2 border-gray-300 rounded-md p-2 text-sm font-normal"
                    >
                      <option value={203}>{t('inventory.labelsPage.dpi203')}</option>
                      <option value={300}>{t('inventory.labelsPage.dpi300')}</option>
                      <option value={600}>{t('inventory.labelsPage.dpi600')}</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-gray-600 space-y-1">
                    <span className="block">{t('inventory.labelsPage.offsetX')}</span>
                    <input
                      type="number" step={0.5} value={settings.offsetXMm}
                      onChange={(e) => updateSettings({ offsetXMm: Number(e.target.value) || 0 })}
                      className="w-full border-2 border-gray-300 rounded-md p-2 text-sm font-normal"
                    />
                  </label>
                  <label className="text-xs font-semibold text-gray-600 space-y-1">
                    <span className="block">{t('inventory.labelsPage.offsetY')}</span>
                    <input
                      type="number" step={0.5} value={settings.offsetYMm}
                      onChange={(e) => updateSettings({ offsetYMm: Number(e.target.value) || 0 })}
                      className="w-full border-2 border-gray-300 rounded-md p-2 text-sm font-normal"
                    />
                  </label>
                  {layout.kind === 'sheet' && (
                    <label className="text-xs font-semibold text-gray-600 space-y-1">
                      <span className="block">{t('inventory.labelsPage.startAt', { max: labelsPerPage(layout) })}</span>
                      <input
                        type="number" min={1} max={labelsPerPage(layout)} value={startAt}
                        onChange={(e) => setStartAt(Math.min(labelsPerPage(layout), Math.max(1, parseInt(e.target.value, 10) || 1)))}
                        className="w-full border-2 border-gray-300 rounded-md p-2 text-sm font-normal"
                      />
                    </label>
                  )}
                  {layout.kind === 'sheet' && (
                    <label className="flex items-center gap-2 text-sm text-gray-700 self-end pb-2">
                      <input
                        type="checkbox" checked={settings.cutGuides}
                        onChange={(e) => updateSettings({ cutGuides: e.target.checked })}
                      />
                      {t('inventory.labelsPage.cutGuides')}
                    </label>
                  )}
                </div>

                <div className="text-xs text-gray-600 bg-blue-50/60 border border-blue-500/15 rounded-md p-2.5 space-y-1">
                  <p className="font-semibold text-gray-700">{t('inventory.labelsPage.dialogTitle')}</p>
                  <p>
                    {t('inventory.labelsPage.dialogPaper', {
                      size: `${layout.pageWidthMm} × ${layout.pageHeightMm} mm`,
                    })}
                  </p>
                  <p>{t('inventory.labelsPage.dialogScale')}</p>
                  {layout.kind === 'roll' && <p>{t('inventory.labelsPage.dialogRoll')}</p>}
                </div>

                <button
                  onClick={printTest}
                  className="flex items-center gap-2 border-2 border-blue-600 text-blue-700 px-3 py-2 rounded-md text-sm font-semibold hover:bg-blue-50"
                >
                  <Crosshair size={15} strokeWidth={2} />
                  {t('inventory.labelsPage.printTest')}
                </button>
              </div>
            )}
          </div>

          <div className="mt-3">
            <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
              <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder={t('inventory.labelsPage.searchPlaceholder')}
                aria-label={t('inventory.labelsPage.searchAriaLabel')}
                className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('inventory.labelsPage.clearSearch')}
                  className="text-gray-400 hover:text-blue-700 p-1 shrink-0 transition-colors"
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 pb-24 sm:pb-24 max-w-5xl mx-auto space-y-3">
        {batch && (
          <div className="flex flex-wrap items-center justify-between gap-2 border border-emerald-300 bg-emerald-50 rounded-lg p-3 text-sm">
            <span className="flex items-center gap-2 text-emerald-900">
              <Truck size={16} strokeWidth={2} className="shrink-0" />
              {t('inventory.labelsPage.batchBanner', {
                date: new Date(batch.createdAt).toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }),
              })}
            </span>
            <button onClick={() => router.replace('/inventory/labels')} className="text-xs font-semibold text-emerald-800 hover:underline">
              {t('inventory.labelsPage.showAllProducts')}
            </button>
          </div>
        )}

        {fallbackCount > 0 && (
          <div className="flex items-start gap-2 border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm text-amber-900">
            <AlertTriangle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
            {t('inventory.labelsPage.fallbackSummary', { count: fallbackCount })}
          </div>
        )}

        {withoutSku > 0 && (
          <p className="text-xs text-gray-500">{t('inventory.labelsPage.withoutSku', { count: withoutSku })}</p>
        )}

        {loading && <p className="text-gray-500 text-sm">{t('inventory.labelsPage.loading')}</p>}
        {loadError && <p className="text-red-600 text-sm">{loadError}</p>}

        {!loading && !loadError && items.length === 0 && (
          <p className="text-gray-500 text-sm">{t('inventory.labelsPage.noProducts')}</p>
        )}

        {!loading && items.length > 0 && filteredItems.length === 0 && (
          <p className="text-sm text-gray-500 bg-white border-2 border-gray-200 rounded-md p-4 text-center">
            {t('inventory.labelsPage.noLabelsMatch', { query })}
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {paginatedItems.map((item) => (
            <LabelCard
              key={item.sku}
              item={item}
              quantity={quantities[item.sku] ?? 1}
              format={format}
              layout={layout}
              dpi={settings.dpi}
              onBump={bumpQty}
              onSetQty={setQty}
              onPrint={printOne}
            />
          ))}
        </div>
      </div>

      {!loading && filteredItems.length > 0 && (
        <div className="sticky bottom-[var(--app-bottom-nav-h,0px)] z-10 bg-white/80 backdrop-blur-md border-t border-blue-500/15 px-4 sm:px-6 py-3">
          <div className="max-w-5xl mx-auto">
            <Pagination
              page={safePage}
              pageSize={pageSize}
              totalItems={filteredItems.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              pageSizeOptions={[9, 12, 24, 48]}
            />
          </div>
        </div>
      )}

      <PrintLabels job={job} onDone={clearJob} />
    </main>
  );
}
