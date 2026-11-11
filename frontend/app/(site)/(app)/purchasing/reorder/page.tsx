'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, PackageSearch, ShoppingCart, Sparkles, Upload } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useBranches } from '@/lib/hooks/useBranches';
import { downloadExcel, fileNamePart } from '@/lib/excel-export';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, Switch, btnPrimary, btnSecondary, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';
import { ProductPicker, useSuppliers, type PickedProduct } from '@/app/components/shared/ProductPicker';
import { useWarehouseOps } from '@/lib/hooks/useWarehouseOps';
import { defaultLocation } from '@/lib/locations';
import { isAdminRole } from '@/lib/roles';

type Line = {
  productId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  onHand: number;
  onOrder: number;
  reorderPoint: number;
  reorderQuantity: number | null;
  suggestedQuantity: number;
  unitCost: number | null;
  preferredSupplier: { id: string; name: string } | null;
  branchOverride: boolean;
  defaultReorderPoint: number | null;
};

type Pick = { selected: boolean; quantity: string; supplierId: string };
type LocationRow = { id: string; name: string; branchId: string | null };
type Settings = {
  reorderPoint: number | null;
  reorderQuantity: number | null;
  preferredSupplierId: string | null;
  branchId: string | null;
  branchReorderPoint: number | null;
  branchReorderQuantity: number | null;
};
type AutoFillResult = {
  count: number;
  applied: boolean;
  lines: { productId: string; name: string; sku: string | null; sold: number; current: number | null; proposed: number }[];
};
type RowError = { row: number; code: string; value: string };
type ImportResult = { updated: number; unchanged: number; errors: RowError[]; errorCount: number };
type ExportRow = {
  sku: string | null;
  name: string;
  unit: string | null;
  onHand: number;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  defaultReorderPoint: number | null;
  supplier: string | null;
};

const toNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const cellNum = (v: unknown): number | null => {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export default function ReorderPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user } = useCurrentUser();
  const isAdmin = isAdminRole(user?.role);
  const suppliers = useSuppliers();
  const warehouseOps = useWarehouseOps();
  const { branches, multiBranch } = useBranches();

  // MASTER picks a branch ('' = the whole business); a branch ADMIN or USER
  // always works in their own, which the backend enforces either way.
  const [chosenBranch, setChosenBranch] = useState('');
  const branchId = multiBranch ? chosenBranch : branches.length > 1 ? (user?.branch?.id ?? '') : '';
  const branchName = branches.find((b) => b.id === branchId)?.name ?? '';
  const branchQs = branchId ? `branchId=${branchId}` : '';

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [rows, setRows] = useState<Line[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PickedProduct | null>(null);
  const [current, setCurrent] = useState<Settings | null>(null);
  const [settings, setSettings] = useState({ reorderPoint: '', reorderQuantity: '', preferredSupplierId: '' });

  useEffect(() => {
    apiFetch('/locations')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: LocationRow[]) => setLocations(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  // A branch's POs go to one of its own locations. Locations with no branch
  // belong to the first one, like the backend counts them.
  const branchLocations = useMemo(() => {
    if (!branchId) return locations;
    const first = branches[0]?.id;
    return locations.filter((l) => l.branchId === branchId || (!l.branchId && branchId === first));
  }, [locations, branchId, branches]);

  const load = useCallback(async () => {
    const qs = [showAll ? 'all=true' : '', branchQs].filter(Boolean).join('&');
    const res = await apiFetch(`/reorder${qs ? `?${qs}` : ''}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('reorder.loadFailed'));
      return;
    }
    const lines: Line[] = body;
    setRows(lines);
    setPicks(
      Object.fromEntries(
        lines.map((l) => [
          l.productId,
          { selected: l.onHand + l.onOrder <= l.reorderPoint, quantity: String(l.suggestedQuantity), supplierId: l.preferredSupplier?.id ?? '' },
        ]),
      ),
    );
  }, [showAll, branchQs, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const selected = (rows ?? []).filter((r) => picks[r.productId]?.selected);

  async function createPos() {
    setError(null);
    const items = selected.map((r) => ({
      productId: r.productId,
      quantity: Number(picks[r.productId].quantity.replace(',', '.')),
      supplierId: picks[r.productId].supplierId,
    }));
    if (items.some((i) => !i.supplierId)) {
      setError(t('reorder.needSupplier'));
      return;
    }
    if (items.some((i) => !(i.quantity > 0))) {
      setError(t('reorder.invalidQty'));
      return;
    }
    setBusy(true);
    const res = await apiFetch('/reorder/purchase-orders', {
      method: 'POST',
      // Without warehouse ops the POs go to the branch's CENTRE, unasked.
      body: JSON.stringify({
        locationId: (warehouseOps ? locationId : defaultLocation(branchLocations)?.id) || undefined,
        branchId: branchId || undefined,
        items,
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(body?.message ?? t('reorder.createFailed'));
      return;
    }
    router.push(body.length === 1 ? `/purchasing/purchase-orders/${body[0].id}` : '/purchasing/purchase-orders');
  }

  // Opening a product shows what it has now, for this branch or business-wide.
  async function startEditing(p: PickedProduct) {
    setEditing(p);
    setCurrent(null);
    setSettings({ reorderPoint: '', reorderQuantity: '', preferredSupplierId: '' });
    const res = await apiFetch(`/reorder/products/${p.id}${branchQs ? `?${branchQs}` : ''}`);
    if (!res.ok) return;
    const s: Settings = await res.json();
    setCurrent(s);
    const point = s.branchId ? s.branchReorderPoint : s.reorderPoint;
    const qty = s.branchId ? s.branchReorderQuantity : s.reorderQuantity;
    setSettings({
      reorderPoint: point != null ? String(point) : '',
      reorderQuantity: qty != null ? String(qty) : '',
      preferredSupplierId: s.preferredSupplierId ?? '',
    });
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const res = await apiFetch(`/reorder/products/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        reorderPoint: toNum(settings.reorderPoint),
        reorderQuantity: toNum(settings.reorderQuantity),
        preferredSupplierId: settings.preferredSupplierId || null,
        branchId: branchId || undefined,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('reorder.saveFailed'));
      return;
    }
    setEditing(null);
    setCurrent(null);
    load();
  }

  const setPick = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  return (
    <PageFrame icon={PackageSearch} title={t('reorder.title')} subtitle={t('reorder.subtitle')}>
      <ErrorNote message={error} />
      {notice && <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2">{notice}</p>}

      {multiBranch && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">{t('reorder.scope')}</span>
          <select
            value={chosenBranch}
            onChange={(e) => {
              setChosenBranch(e.target.value);
              setLocationId('');
              setEditing(null);
            }}
            className={`${inputCls} w-auto`}
          >
            <option value="">{t('reorder.wholeBusiness')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {isAdmin && (
        <Card title={t('reorder.settingsTitle')}>
          {editing ? (
            <form onSubmit={saveSettings} className="space-y-3">
              <p className="text-sm font-medium">{editing.name}</p>
              {current?.branchId && (
                <p className="text-xs text-gray-500">
                  {t('reorder.branchHint', {
                    branch: branchName || user?.branch?.name || '',
                    n: current.reorderPoint ?? t('reorder.generalNone'),
                  })}
                </p>
              )}
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="text-sm">
                  <span className="block text-xs text-gray-500 mb-1">{t('reorder.reorderPoint')}</span>
                  <input inputMode="decimal" value={settings.reorderPoint} onChange={(e) => setSettings({ ...settings, reorderPoint: e.target.value })} placeholder={t('reorder.notWatched')} className={inputCls} />
                </label>
                <label className="text-sm">
                  <span className="block text-xs text-gray-500 mb-1">{t('reorder.reorderQuantity')}</span>
                  <input inputMode="decimal" value={settings.reorderQuantity} onChange={(e) => setSettings({ ...settings, reorderQuantity: e.target.value })} placeholder={t('reorder.auto')} className={inputCls} />
                </label>
                <label className="text-sm">
                  <span className="block text-xs text-gray-500 mb-1">{t('reorder.preferredSupplier')}</span>
                  <select value={settings.preferredSupplierId} onChange={(e) => setSettings({ ...settings, preferredSupplierId: e.target.value })} className={inputCls}>
                    <option value="">—</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" className="text-sm underline" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </button>
                <button className={btnPrimary}>{t('common.save')}</button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">{t('reorder.settingsHint')}</p>
              <ProductPicker onPick={startEditing} placeholder={t('reorder.pickProduct')} />
            </>
          )}
        </Card>
      )}

      {isAdmin && (
        <div className="grid md:grid-cols-2 gap-4">
          <AutoFillCard branchId={branchId} onDone={(msg) => { setNotice(msg); load(); }} />
          <ExcelCard branchId={branchId} branchName={branchName || user?.branch?.name || ''} onDone={(msg) => { setNotice(msg); load(); }} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-sm">
          <Switch checked={showAll} onChange={setShowAll} label={t('reorder.showAll')} />
          <span>{t('reorder.showAll')}</span>
        </div>
        <div className="flex items-center gap-2">
          {warehouseOps && (
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={`${inputCls} w-auto`} aria-label={t('reorder.deliverTo')}>
              <option value="">{t('reorder.deliverTo')}</option>
              {branchLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <button className={btnPrimary} disabled={busy || selected.length === 0} onClick={createPos}>
            <ShoppingCart size={14} /> {t('reorder.createPos', { n: selected.length })}
          </button>
        </div>
      </div>

      <Card>
        {rows && rows.length === 0 ? (
          <p className="text-sm text-gray-500">{showAll ? t('reorder.noneWatched') : t('reorder.noneLow')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls} />
                  <th className={thCls}>{t('reorder.product')}</th>
                  <th className={`${thCls} text-right`}>{t('reorder.onHand')}</th>
                  <th className={`${thCls} text-right`}>{t('reorder.onOrder')}</th>
                  <th className={`${thCls} text-right`}>{t('reorder.reorderPoint')}</th>
                  <th className={thCls}>{t('reorder.orderQty')}</th>
                  <th className={thCls}>{t('reorder.supplier')}</th>
                  <th className={`${thCls} text-right`}>{t('reorder.estCost')}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => {
                  const p = picks[r.productId];
                  if (!p) return null;
                  const low = r.onHand + r.onOrder <= r.reorderPoint;
                  return (
                    <tr key={r.productId} className="border-t border-gray-100">
                      <td className={tdCls}>
                        <Switch checked={p.selected} onChange={(selected) => setPick(r.productId, { selected })} label={r.name} />
                      </td>
                      <td className={tdCls}>
                        <span className={low ? 'font-semibold text-red-700' : ''}>{r.name}</span>
                        {r.sku && <span className="block text-xs text-gray-500">{r.sku}</span>}
                      </td>
                      <td className={`${tdCls} text-right tabular-nums`}>{r.onHand}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{r.onOrder || '—'}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>
                        {r.reorderPoint}
                        {r.branchOverride && <span className="block text-[11px] text-blue-700">{t('reorder.branchOwn')}</span>}
                      </td>
                      <td className={tdCls}>
                        <input inputMode="decimal" value={p.quantity} onChange={(e) => setPick(r.productId, { quantity: e.target.value })} className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right" />
                      </td>
                      <td className={tdCls}>
                        <select value={p.supplierId} onChange={(e) => setPick(r.productId, { supplierId: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1 text-sm max-w-40">
                          <option value="">—</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`${tdCls} text-right tabular-nums text-gray-600`}>
                        {r.unitCost != null ? formatIDR(r.unitCost * Number(p.quantity || 0)) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageFrame>
  );
}

// Reorder points worked out from recent sales: preview first, then apply.
function AutoFillCard({ branchId, onDone }: { branchId: string; onDone: (message: string) => void }) {
  const { t } = useLanguage();
  const [salesDays, setSalesDays] = useState('90');
  const [coverDays, setCoverDays] = useState('14');
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [result, setResult] = useState<AutoFillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(apply: boolean) {
    setBusy(true);
    setError(null);
    const res = await apiFetch('/reorder/auto-fill', {
      method: 'POST',
      body: JSON.stringify({
        salesDays: Number(salesDays),
        coverDays: Number(coverDays),
        onlyEmpty,
        apply,
        branchId: branchId || undefined,
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? t('reorder.autoFailed')));
      return;
    }
    if (apply) {
      setResult(null);
      onDone(t('reorder.applied', { n: body.count }));
    } else {
      setResult(body);
    }
  }

  return (
    <Card title={t('reorder.autoTitle')}>
      <p className="text-xs text-gray-500 mb-3">{t('reorder.autoHint')}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">{t('reorder.salesDays')}</span>
          <input inputMode="numeric" value={salesDays} onChange={(e) => { setSalesDays(e.target.value); setResult(null); }} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">{t('reorder.coverDays')}</span>
          <input inputMode="numeric" value={coverDays} onChange={(e) => { setCoverDays(e.target.value); setResult(null); }} className={inputCls} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm mt-3">
        <input type="checkbox" checked={onlyEmpty} onChange={(e) => { setOnlyEmpty(e.target.checked); setResult(null); }} />
        {t('reorder.onlyEmpty')}
      </label>
      <ErrorNote message={error} />
      <div className="flex gap-2 mt-3">
        <button className={btnSecondary} disabled={busy} onClick={() => run(false)}>
          <Sparkles size={14} /> {busy && !result ? t('reorder.working') : t('reorder.preview')}
        </button>
        {result && result.count > 0 && (
          <button className={btnPrimary} disabled={busy} onClick={() => run(true)}>
            {t('reorder.apply', { n: result.count })}
          </button>
        )}
      </div>
      {result && result.count === 0 && <p className="text-sm text-gray-500 mt-3">{t('reorder.noSuggestions')}</p>}
      {result && result.count > 0 && (
        <div className="mt-3 max-h-64 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={thCls}>{t('reorder.product')}</th>
                <th className={`${thCls} text-right`}>{t('reorder.colSold')}</th>
                <th className={`${thCls} text-right`}>{t('reorder.colCurrent')}</th>
                <th className={`${thCls} text-right`}>{t('reorder.colProposed')}</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((l) => (
                <tr key={l.productId} className="border-t border-gray-100">
                  <td className={tdCls}>
                    {l.name}
                    {l.sku && <span className="block text-xs text-gray-500">{l.sku}</span>}
                  </td>
                  <td className={`${tdCls} text-right tabular-nums`}>{l.sold}</td>
                  <td className={`${tdCls} text-right tabular-nums text-gray-500`}>{l.current ?? '—'}</td>
                  <td className={`${tdCls} text-right tabular-nums font-semibold`}>{l.proposed}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.count > result.lines.length && (
            <p className="text-xs text-gray-500 mt-2">{t('reorder.showingTop', { shown: result.lines.length, n: result.count })}</p>
          )}
        </div>
      )}
    </Card>
  );
}

// Download every product's settings, edit them in Excel, upload them back.
function ExcelCard({ branchId, branchName, onDone }: { branchId: string; branchName: string; onDone: (message: string) => void }) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<RowError[] | null>(null);
  const [rowErrorCount, setRowErrorCount] = useState(0);

  const headers = [
    t('reorder.colSku'),
    t('reorder.colName'),
    t('reorder.colUnit'),
    t('reorder.colOnHand'),
    t('reorder.colReorderPoint'),
    t('reorder.colReorderQty'),
    t('reorder.colSupplier'),
    ...(branchId ? [t('reorder.colGeneral')] : []),
  ];

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/reorder/export${branchId ? `?branchId=${branchId}` : ''}`);
      if (!res.ok) throw new Error();
      const data: ExportRow[] = await res.json();
      await downloadExcel({
        fileName: `${fileNamePart(t('reorder.title'))}${branchName && branchId ? `-${fileNamePart(branchName)}` : ''}.xlsx`,
        sheets: [
          {
            name: t('reorder.title'),
            rows: [
              headers,
              ...data.map((r) => [
                r.sku,
                r.name,
                r.unit,
                r.onHand,
                r.reorderPoint,
                r.reorderQuantity,
                r.supplier,
                ...(branchId ? [r.defaultReorderPoint] : []),
              ]),
            ],
            widths: [16, 40, 8, 10, 18, 16, 28, 18],
          },
        ],
      });
    } catch {
      setError(t('reorder.exportFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setRowErrors(null);
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
      // Columns by their header, in either language, so a file downloaded in
      // English still imports with the app in Indonesian.
      const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
      const head = (grid[0] ?? []).map(norm);
      const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n.toLowerCase()));
      const c = {
        sku: col('SKU'),
        name: col('Product name', 'Nama produk'),
        point: col('Reorder point', 'Titik pemesanan ulang'),
        qty: col('Order quantity', 'Jumlah pesanan'),
        supplier: col('Usual supplier', 'Pemasok biasa'),
      };
      if (c.point < 0 || (c.sku < 0 && c.name < 0)) throw new Error(t('reorder.importFailed'));
      const rows = grid
        .slice(1)
        .filter((r) => r.some((v) => String(v ?? '').trim() !== ''))
        .map((r) => ({
          sku: c.sku >= 0 ? String(r[c.sku] ?? '').trim() || null : null,
          name: c.name >= 0 ? String(r[c.name] ?? '').trim() || null : null,
          reorderPoint: cellNum(r[c.point]),
          reorderQuantity: c.qty >= 0 ? cellNum(r[c.qty]) : null,
          supplier: c.supplier >= 0 ? String(r[c.supplier] ?? '').trim() || null : null,
        }));
      if (rows.length === 0) throw new Error(t('reorder.noRows'));
      const bad = rows.findIndex((r) => Number.isNaN(r.reorderPoint) || Number.isNaN(r.reorderQuantity));
      if (bad >= 0) {
        setRowErrors([{ row: bad + 2, code: 'INVALID_NUMBER', value: '' }]);
        setRowErrorCount(1);
        return;
      }
      const res = await apiFetch('/reorder/import', {
        method: 'POST',
        body: JSON.stringify({ rows, branchId: branchId || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(Array.isArray(body?.message) ? body.message[0] : body?.message);
      const result = body as ImportResult;
      if (result.errorCount > 0) {
        setRowErrors(result.errors);
        setRowErrorCount(result.errorCount);
        return;
      }
      onDone(t('reorder.importDone', { updated: result.updated, unchanged: result.unchanged }));
    } catch (e) {
      setError((e instanceof Error && e.message) || t('reorder.importFailed'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Card title={t('reorder.excelTitle')}>
      <p className="text-xs text-gray-500 mb-3">
        {branchId ? t('reorder.excelHintBranch', { branch: branchName }) : t('reorder.excelHint')}
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={btnSecondary} disabled={busy} onClick={download}>
          <Download size={14} /> {t('reorder.download')}
        </button>
        <button className={btnPrimary} disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> {busy ? t('reorder.working') : t('reorder.upload')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </div>
      <ErrorNote message={error} />
      {rowErrors && (
        <div className="mt-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2 max-h-48 overflow-y-auto">
          <p className="font-semibold mb-1">{t('reorder.importErrors', { n: rowErrorCount })}</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {rowErrors.map((r) => (
              <li key={`${r.row}-${r.code}`}>
                {t('reorder.rowError', {
                  row: r.row,
                  message:
                    r.code === 'PRODUCT_NOT_FOUND'
                      ? t('reorder.errProductNotFound', { value: r.value })
                      : r.code === 'SUPPLIER_NOT_FOUND'
                        ? t('reorder.errSupplierNotFound', { value: r.value })
                        : t('reorder.errInvalidNumber'),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
