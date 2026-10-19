'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Check, Plus, Printer, ScanLine, Truck, PackageCheck, XCircle, Trash2, Zap } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { formatDMY } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, btnPrimary, btnSecondary, btnDanger, inputCls } from '@/app/components/shared/PageFrame';
import { ProductPicker, useLocations, type PickedProduct } from '@/app/components/shared/ProductPicker';
import { SerialButton, SerialPicker } from '@/app/components/shared/SerialPicker';
import { useDialog } from '@/app/components/shared/DialogProvider';

type Status = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
type Transfer = {
  id: string;
  transferNumber: string | null;
  status: Status;
  quickMove: boolean;
  notes: string | null;
  createdAt: string;
  shippedAt: string | null;
  receivedAt: string | null;
  fromLocation: { id: string; name: string };
  toLocation: { id: string; name: string };
  items: {
    id: string;
    quantity: number;
    receivedQuantity: number | null;
    serialNumbers: string[];
    product: { id: string; name: string; sku: string | null; unit: string | null };
  }[];
};

type Mode = 'quick' | 'ship';
type Filter = 'all' | 'quick' | 'ship';
const MODE_KEY = 'waresys.moveStock.mode';

function savedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'ship' ? 'ship' : 'quick';
  } catch {
    return 'quick';
  }
}

const STATUS_STYLE: Record<Status, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  IN_TRANSIT: 'bg-blue-100 text-blue-800',
  RECEIVED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-700',
};

// One page for every move between locations: a quick move lands at once
// (within a site), ship & receive is a document that travels.
export default function TransfersPage() {
  const dialog = useDialog();
  const { t } = useLanguage();
  const router = useRouter();
  const locations = useLocations();
  const hasWarehouseOps = useHasModule('WAREHOUSE_OPS');
  const [mode, setModeState] = useState<Mode>('quick');
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<Transfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [printing, setPrinting] = useState<Transfer | null>(null);
  // Per transfer being received: item id -> counted quantity.
  const [counting, setCounting] = useState<Record<string, Record<string, string>>>({});

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ product: PickedProduct; quantity: string; serialNumbers: string[] }[]>([]);
  // New-transfer line whose serials are being picked (index into lines).
  const [pickingLine, setPickingLine] = useState<number | null>(null);
  // Receiving a short serial-tracked line: transfer item id -> serials that didn't arrive.
  const [missing, setMissing] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    const res = await apiFetch('/stock-transfers');
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.message ?? t('transfers.loadFailed'));
    else setRows(body);
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(savedMode());
  }, []);

  function setMode(next: Mode) {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Remembering the choice is a convenience only.
    }
  }

  async function startScanSession() {
    const res = await apiFetch('/sessions', { method: 'POST', body: JSON.stringify({ type: 'MOVE' }) });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('transfers.saveFailed'));
      return;
    }
    router.push(`/inventory/sessions/${body.id}`);
  }

  const shown = rows?.filter((tr) => filter === 'all' || (filter === 'quick') === tr.quickMove) ?? null;

  useEffect(() => {
    if (!printing) return;
    const timer = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 50);
    return () => clearTimeout(timer);
  }, [printing]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const items = lines.map((l) => ({
      productId: l.product.id,
      quantity: Number(l.quantity.replace(',', '.')),
      ...(l.product.trackSerials && { serialNumbers: l.serialNumbers }),
    }));
    if (items.some((i) => !(i.quantity > 0))) {
      setError(t('transfers.invalidQty'));
      return;
    }
    if (lines.some((l) => l.product.trackSerials && l.serialNumbers.length !== Number(l.quantity))) {
      setError(t('serials.transferPickAll'));
      return;
    }
    const res = await apiFetch('/stock-transfers', {
      method: 'POST',
      body: JSON.stringify({
        fromLocationId: from,
        toLocationId: to,
        notes: notes.trim() || undefined,
        quickMove: mode === 'quick',
        items,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('transfers.saveFailed'));
      return;
    }
    setCreating(false);
    setLines([]);
    setNotes('');
    load();
  }

  async function act(tr: Transfer, action: 'ship' | 'receive' | 'cancel') {
    if (action === 'cancel' && !(await dialog.confirm(t('transfers.cancelConfirm'), { danger: true }))) return;
    setBusy(tr.id);
    setError(null);
    const counted = counting[tr.id];
    const body =
      action === 'receive' && counted
        ? {
            items: Object.entries(counted)
              .filter(([, v]) => v.trim() !== '')
              .map(([itemId, v]) => ({
                itemId,
                receivedQuantity: Number(v.replace(',', '.')),
                ...(missing[itemId]?.length && { missingSerials: missing[itemId] }),
              })),
          }
        : {};
    const res = await apiFetch(`/stock-transfers/${tr.id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
    const resBody = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setError(resBody?.message ?? t('transfers.actionFailed'));
      return;
    }
    setCounting((c) => {
      const next = { ...c };
      delete next[tr.id];
      return next;
    });
    load();
  }

  return (
    <PageFrame
      icon={ArrowRightLeft}
      title={t('transfers.title')}
      subtitle={t('transfers.subtitle')}
      actions={
        <button className={btnPrimary} onClick={() => setCreating((v) => !v)}>
          <Plus size={14} /> <span className="hidden sm:inline">{t('transfers.new')}</span>
        </button>
      }
    >
      <style>{`@media print { body * { visibility: hidden; } #transfer-slip, #transfer-slip * { visibility: visible; } #transfer-slip { position: absolute; inset: 0; } }`}</style>
      <ErrorNote message={error} />

      {creating && (
        <Card title={t('transfers.new')}>
          <form onSubmit={create} className="space-y-3">
            <div role="radiogroup" aria-label={t('transfers.new')} className="grid sm:grid-cols-2 gap-2">
              {(
                [
                  { key: 'quick', icon: Zap, title: t('transfers.modeQuick'), hint: t('transfers.modeQuickHint') },
                  { key: 'ship', icon: Truck, title: t('transfers.modeShip'), hint: t('transfers.modeShipHint') },
                ] as const
              ).map((m) => {
                const on = mode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMode(m.key)}
                    className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                      on ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        on ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      <m.icon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{m.title}</span>
                      <span className="block text-xs text-gray-500">{m.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {mode === 'quick' && hasWarehouseOps && (
              <button type="button" onClick={startScanSession} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline">
                <ScanLine size={13} /> {t('transfers.useScanner')}
              </button>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-xs text-gray-500 mb-1">{t('transfers.from')}</span>
                <select required value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-gray-500 mb-1">{t('transfers.to')}</span>
                <select required value={to} onChange={(e) => setTo(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {locations
                    .filter((l) => l.id !== from)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <ProductPicker
              placeholder={t('transfers.addProduct')}
              onPick={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, quantity: '1', serialNumbers: [] }]))}
            />
            {lines.length > 0 && (
              <ul className="divide-y divide-gray-100 border border-gray-200 rounded-md">
                {lines.map((l, i) => (
                  <li key={l.product.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="flex-1 text-sm">
                      {l.product.name} {l.product.sku && <span className="text-xs text-gray-500">{l.product.sku}</span>}
                      {l.product.trackSerials && (
                        <span className="ml-2">
                          <SerialButton
                            count={l.serialNumbers.length}
                            quantity={Number(l.quantity) || 0}
                            onClick={() => (from ? setPickingLine(i) : setError(t('serials.chooseFromFirst')))}
                          />
                        </span>
                      )}
                    </span>
                    <input
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                      className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                    />
                    <button aria-label={t('common.remove')} type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('transfers.notes')} maxLength={500} className={inputCls} />
            <div className="flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </button>
              <button className={btnPrimary} disabled={lines.length === 0 || !from || !to}>
                {mode === 'quick' ? (
                  <>
                    <Zap size={14} /> {t('transfers.moveNow')}
                  </>
                ) : (
                  t('transfers.saveDraft')
                )}
              </button>
            </div>
          </form>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', t('transfers.filterAll')],
              ['quick', t('transfers.filterQuick')],
              ['ship', t('transfers.filterShip')],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === key ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-blue-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {rows && rows.length === 0 && <p className="text-sm text-gray-500">{t('transfers.empty')}</p>}
      {rows && rows.length > 0 && shown?.length === 0 && <p className="text-sm text-gray-500">{t('transfers.emptyFilter')}</p>}

      <div className="space-y-3">
        {shown?.map((tr) => (
          <Card key={tr.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {tr.transferNumber} <span className="font-normal text-gray-600">· {tr.fromLocation.name} → {tr.toLocation.name}</span>
                </p>
                <p className="text-xs text-gray-500">
                  {tr.quickMove ? (
                    t('transfers.movedOn', { date: formatDMY(new Date(tr.createdAt)) })
                  ) : (
                    <>
                      {formatDMY(new Date(tr.createdAt))}
                      {tr.shippedAt && ` · ${t('transfers.shippedOn', { date: formatDMY(new Date(tr.shippedAt)) })}`}
                      {tr.receivedAt && ` · ${t('transfers.receivedOn', { date: formatDMY(new Date(tr.receivedAt)) })}`}
                    </>
                  )}
                  {tr.notes && ` · ${tr.notes}`}
                </p>
              </div>
              {tr.quickMove ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  <Zap size={11} /> {t('transfers.quickBadge')}
                </span>
              ) : (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[tr.status]}`}>{t(`transfers.status.${tr.status}`)}</span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-2">
                <tbody>
                  {tr.items.map((it) => (
                    <tr key={it.id} className="border-t border-gray-100">
                      <td className="py-1.5">{it.product.name}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {it.quantity} {it.product.unit ?? ''}
                        {it.receivedQuantity != null && it.receivedQuantity < it.quantity && (
                          <span className="ml-2 text-red-700">{t('transfers.short', { n: it.quantity - it.receivedQuantity })}</span>
                        )}
                      </td>
                      {tr.status === 'IN_TRANSIT' && it.serialNumbers.length > 0 && Number(counting[tr.id]?.[it.id] ?? it.quantity) < it.quantity && (
                        <td className="py-1.5 pl-2">
                          <span className="block text-[11px] text-gray-500">{t('serials.whichMissing')}</span>
                          <span className="flex flex-wrap gap-1">
                            {it.serialNumbers.map((sn) => {
                              const isMissing = (missing[it.id] ?? []).includes(sn);
                              return (
                                <button
                                  key={sn}
                                  type="button"
                                  aria-pressed={isMissing}
                                  onClick={() =>
                                    setMissing((m) => ({
                                      ...m,
                                      [it.id]: isMissing ? (m[it.id] ?? []).filter((x) => x !== sn) : [...(m[it.id] ?? []), sn],
                                    }))
                                  }
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-mono transition-colors ${
                                    isMissing ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-300 bg-white text-gray-700 hover:border-red-300'
                                  }`}
                                >
                                  {isMissing ? <XCircle size={11} /> : <Check size={11} />}
                                  {sn}
                                </button>
                              );
                            })}
                          </span>
                        </td>
                      )}
                      {tr.status === 'IN_TRANSIT' && (
                        <td className="py-1.5 pl-2 w-28">
                          <input
                            inputMode="decimal"
                            placeholder={String(it.quantity)}
                            aria-label={t('transfers.countedQty')}
                            value={counting[tr.id]?.[it.id] ?? ''}
                            onChange={(e) =>
                              setCounting((c) => ({ ...c, [tr.id]: { ...(c[tr.id] ?? {}), [it.id]: e.target.value } }))
                            }
                            className="w-24 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tr.status === 'IN_TRANSIT' && <p className="text-xs text-gray-500 mt-1">{t('transfers.countHint')}</p>}

            <div className="mt-3 flex flex-wrap gap-2">
              {tr.status === 'DRAFT' && (
                <button className={btnPrimary} disabled={busy === tr.id} onClick={() => act(tr, 'ship')}>
                  <Truck size={14} /> {t('transfers.ship')}
                </button>
              )}
              {tr.status === 'IN_TRANSIT' && (
                <button className={btnPrimary} disabled={busy === tr.id} onClick={() => act(tr, 'receive')}>
                  <PackageCheck size={14} /> {t('transfers.receive')}
                </button>
              )}
              {(tr.status === 'DRAFT' || tr.status === 'IN_TRANSIT') && (
                <button className={btnDanger} disabled={busy === tr.id} onClick={() => act(tr, 'cancel')}>
                  <XCircle size={14} /> {t('transfers.cancel')}
                </button>
              )}
              <button className={btnSecondary} onClick={() => setPrinting(tr)}>
                <Printer size={14} /> {t('transfers.printSlip')}
              </button>
            </div>
          </Card>
        ))}
      </div>

      {pickingLine !== null && lines[pickingLine] && (
        <SerialPicker
          productId={lines[pickingLine].product.id}
          productName={lines[pickingLine].product.name}
          locationId={from}
          quantity={Math.floor(Number(lines[pickingLine].quantity) || 0)}
          value={lines[pickingLine].serialNumbers}
          onChange={(list) => setLines((ls) => ls.map((x, j) => (j === pickingLine ? { ...x, serialNumbers: list } : x)))}
          onClose={() => setPickingLine(null)}
        />
      )}

      {printing && (
        <div id="transfer-slip" className="hidden print:block bg-white p-8 text-black">
          <h1 className="text-2xl font-bold">{t('transfers.slipTitle')}</h1>
          <p className="mt-1">{printing.transferNumber}</p>
          <p className="mt-4">
            <strong>{t('transfers.from')}:</strong> {printing.fromLocation.name}
            <br />
            <strong>{t('transfers.to')}:</strong> {printing.toLocation.name}
            <br />
            <strong>{t('common.date')}:</strong> {formatDMY(new Date(printing.shippedAt ?? printing.createdAt))}
          </p>
          <table className="w-full mt-6 border-collapse">
            <thead>
              <tr>
                <th className="border border-black p-2 text-left">{t('transfers.product')}</th>
                <th className="border border-black p-2 text-right">{t('transfers.qty')}</th>
                <th className="border border-black p-2 text-right">{t('transfers.received')}</th>
              </tr>
            </thead>
            <tbody>
              {printing.items.map((it) => (
                <tr key={it.id}>
                  <td className="border border-black p-2">
                    {it.product.name} {it.product.sku && `(${it.product.sku})`}
                    {it.serialNumbers.length > 0 && <div className="text-xs font-mono">S/N: {it.serialNumbers.join(', ')}</div>}
                  </td>
                  <td className="border border-black p-2 text-right">{it.quantity}</td>
                  <td className="border border-black p-2 text-right">{it.receivedQuantity ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-16 grid grid-cols-2 gap-16 text-center">
            <div className="border-t border-black pt-2">{t('transfers.sentBy')}</div>
            <div className="border-t border-black pt-2">{t('transfers.receivedBy')}</div>
          </div>
        </div>
      )}
    </PageFrame>
  );
}
