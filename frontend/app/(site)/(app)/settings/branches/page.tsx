'use client';

import { useCallback, useEffect, useState } from 'react';
import { Archive, Pencil, Plus, RotateCcw, Store, Warehouse } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useWarehouseOps } from '@/lib/hooks/useWarehouseOps';
import type { Branch } from '@/lib/hooks/useBranches';
import { PageFrame, Card, ErrorNote, btnPrimary, btnSecondary, inputCls } from '@/app/components/shared/PageFrame';

type StockLocation = { id: string; name: string; branchId: string | null };
type Draft = { name: string; address: string; phone: string };

const EMPTY: Draft = { name: '', address: '', phone: '' };

function errorText(body: { message?: string | string[] } | null, fallback: string) {
  if (Array.isArray(body?.message)) return body.message.join(', ');
  return body?.message ?? fallback;
}

// The business's branches — what accounting splits by (P&L, expenses,
// assets). With one branch nothing else in the app mentions them; adding a
// second turns on the branch choices. Warehouse orgs also say here which
// branch each stock location belongs to.
export default function BranchesPage() {
  const { t } = useLanguage();
  const { authorized } = useRequireAdmin(['MASTER']);
  const warehouseOps = useWarehouseOps();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [b, l] = await Promise.all([
      apiFetch('/branches?includeArchived=true').then((r) => (r.ok ? r.json() : [])),
      apiFetch('/locations').then((r) => (r.ok ? r.json() : [])),
    ]);
    return { branches: b as Branch[], locations: l as StockLocation[] };
  }, []);

  useEffect(() => {
    if (!authorized) return;
    let current = true;
    (async () => {
      const next = await fetchAll().catch(() => null);
      if (!current || !next) return;
      setBranches(next.branches);
      setLocations(next.locations);
    })();
    return () => {
      current = false;
    };
  }, [authorized, fetchAll]);

  async function call(path: string, method: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, { method, body: payload ? JSON.stringify(payload) : undefined });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorText(body, t('settings.branches.saveFailed')));
        return false;
      }
      const next = await fetchAll();
      setBranches(next.branches);
      setLocations(next.locations);
      return true;
    } catch {
      setError(t('settings.branches.serverError'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!draft.name.trim()) return;
    if (await call('/branches', 'POST', draft)) setDraft(EMPTY);
  }

  async function saveEdit(id: string) {
    if (!editDraft.name.trim()) return;
    if (await call(`/branches/${id}`, 'PATCH', editDraft)) setEditingId(null);
  }

  if (!authorized) return null;

  const active = branches.filter((b) => !b.archivedAt);
  const archived = branches.filter((b) => b.archivedAt);

  return (
    <PageFrame icon={Store} title={t('settings.branches.title')} subtitle={t('settings.branches.subtitle')}>
      <ErrorNote message={error} />

      <Card title={t('settings.branches.listTitle')}>
        {active.length === 1 && <p className="text-sm text-gray-500 mb-3">{t('settings.branches.singleHint')}</p>}
        <ul className="divide-y divide-gray-100">
          {active.map((b) => (
            <li key={b.id} className="py-2.5">
              {editingId === b.id ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    className={inputCls}
                    value={editDraft.name}
                    maxLength={100}
                    aria-label={t('settings.branches.name')}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                  />
                  <input
                    className={inputCls}
                    value={editDraft.address}
                    maxLength={300}
                    placeholder={t('settings.branches.address')}
                    onChange={(e) => setEditDraft({ ...editDraft, address: e.target.value })}
                  />
                  <input
                    className={inputCls}
                    value={editDraft.phone}
                    maxLength={50}
                    placeholder={t('settings.branches.phone')}
                    onChange={(e) => setEditDraft({ ...editDraft, phone: e.target.value })}
                  />
                  <div className="sm:col-span-3 flex justify-end gap-2">
                    <button type="button" className={btnSecondary} onClick={() => setEditingId(null)}>
                      {t('common.cancel')}
                    </button>
                    <button type="button" className={btnPrimary} disabled={busy || !editDraft.name.trim()} onClick={() => saveEdit(b.id)}>
                      {t('settings.branches.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{b.name}</p>
                    {(b.address || b.phone) && (
                      <p className="text-xs text-gray-500">{[b.address, b.phone].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      className={btnSecondary}
                      aria-label={t('settings.branches.edit')}
                      onClick={() => {
                        setEditingId(b.id);
                        setEditDraft({ name: b.name, address: b.address ?? '', phone: b.phone ?? '' });
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    {active.length > 1 && (
                      <button
                        type="button"
                        className={btnSecondary}
                        disabled={busy}
                        aria-label={t('settings.branches.archive')}
                        title={t('settings.branches.archive')}
                        onClick={() => call(`/branches/${b.id}/archive`, 'POST')}
                      >
                        <Archive size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input
            className={inputCls}
            value={draft.name}
            maxLength={100}
            placeholder={t('settings.branches.newName')}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className={inputCls}
            value={draft.address}
            maxLength={300}
            placeholder={t('settings.branches.address')}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
          <input
            className={inputCls}
            value={draft.phone}
            maxLength={50}
            placeholder={t('settings.branches.phone')}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          />
          <button type="button" className={btnPrimary} disabled={busy || !draft.name.trim()} onClick={add}>
            <Plus size={14} />
            {t('settings.branches.add')}
          </button>
        </div>
      </Card>

      {archived.length > 0 && (
        <Card title={t('settings.branches.archivedTitle')}>
          <ul className="divide-y divide-gray-100">
            {archived.map((b) => (
              <li key={b.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-sm text-gray-500">{b.name}</span>
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => call(`/branches/${b.id}/restore`, 'POST')}>
                  <RotateCcw size={14} />
                  {t('settings.branches.restore')}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Warehouse orgs only: each stock location's branch, which stock
          adjustments and receipts there are booked to. */}
      {warehouseOps && active.length > 1 && locations.length > 0 && (
        <Card title={t('settings.branches.locationsTitle')}>
          <p className="text-sm text-gray-500 mb-3">{t('settings.branches.locationsHint')}</p>
          <ul className="divide-y divide-gray-100">
            {locations.map((l) => (
              <li key={l.id} className="py-2 flex items-center justify-between gap-3">
                <span className="text-sm flex items-center gap-1.5 min-w-0">
                  <Warehouse size={14} className="text-blue-600 shrink-0" />
                  <span className="truncate">{l.name}</span>
                </span>
                <select
                  className={`${inputCls} w-auto`}
                  value={l.branchId ?? ''}
                  disabled={busy}
                  aria-label={t('settings.branches.locationBranch', { location: l.name })}
                  onChange={(e) => call(`/locations/${l.id}/branch`, 'PATCH', { branchId: e.target.value })}
                >
                  {!l.branchId && <option value="">—</option>}
                  {active.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageFrame>
  );
}
