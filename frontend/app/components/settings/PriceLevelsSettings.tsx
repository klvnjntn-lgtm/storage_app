'use client';

import { useEffect, useState } from 'react';
import { Layers, Check, Pencil, Archive, Plus, Star } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { readErrorMessage } from '@/lib/api-error';
import { invalidatePriceLevels, PriceLevel } from '@/lib/price-levels';
import { useLanguage } from '@/app/context/LanguageContext';

// Settings → Price levels: the org-wide list (Retail, Wholesale, …) plus
// who may change a sales line's level. Each product's price per level is
// set on the Products page; each customer's level on the customer.
export default function PriceLevelsSettings() {
  const { t } = useLanguage();
  const [levels, setLevels] = useState<PriceLevel[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [overrideAdminOnly, setOverrideAdminOnly] = useState<boolean | null>(null);

  async function reload() {
    invalidatePriceLevels();
    const res = await apiFetch('/organization/price-levels');
    if (res.ok) setLevels(await res.json());
  }

  useEffect(() => {
    let alive = true;
    apiFetch('/organization/price-levels')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: PriceLevel[]) => {
        if (alive) setLevels(rows);
      })
      .catch(() => {
        if (alive) setLevels([]);
      });
    apiFetch('/organization/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((s) => {
        if (alive && s) setOverrideAdminOnly(!!s.priceLevelOverrideRequiresAdmin);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function run(action: () => Promise<Response>) {
    setBusy(true);
    setError('');
    try {
      const res = await action();
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return false;
      }
      await reload();
      return true;
    } catch {
      setError(t('settings.priceLevels.saveFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  async function add() {
    const name = newName.trim();
    if (!name) return;
    if (await run(() => apiFetch('/organization/price-levels', json('POST', { name })))) setNewName('');
  }

  async function rename(id: string) {
    const name = editName.trim();
    if (!name) return;
    if (await run(() => apiFetch(`/organization/price-levels/${id}`, json('PATCH', { name })))) setEditingId(null);
  }

  async function archive(level: PriceLevel) {
    if (!confirm(t('settings.priceLevels.archiveConfirm', { name: level.name }))) return;
    await run(() => apiFetch(`/organization/price-levels/${level.id}`, json('PATCH', { archived: true })));
  }

  async function saveOverride(next: boolean) {
    const prev = overrideAdminOnly;
    setOverrideAdminOnly(next);
    setError('');
    const res = await apiFetch('/organization/settings', json('PATCH', { priceLevelOverrideRequiresAdmin: next })).catch(
      () => null,
    );
    if (!res?.ok) {
      setOverrideAdminOnly(prev);
      setError(res ? await readErrorMessage(res) : t('settings.priceLevels.saveFailed'));
    }
  }

  return (
    <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Layers size={16} strokeWidth={2} className="text-blue-700" aria-hidden="true" />
        <h2 className="font-bold">{t('settings.priceLevels.heading')}</h2>
      </div>
      <p className="text-sm text-gray-600 max-w-xl">{t('settings.priceLevels.description')}</p>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2.5">
          {error}
        </p>
      )}

      <ul className="divide-y divide-blue-500/10 border border-blue-500/15 rounded-lg">
        {levels === null && <li className="p-3 text-sm text-gray-500">{t('common.loading')}</li>}
        {levels?.map((level) => (
          <li key={level.id} className="flex items-center gap-2 p-2.5">
            {editingId === level.id ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(level.id);
                }}
              >
                <input
                  autoFocus
                  value={editName}
                  maxLength={60}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label={t('settings.priceLevels.nameLabel')}
                  className="flex-1 min-w-0 border-2 border-gray-300 rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="p-2 rounded-md text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  aria-label={t('common.save')}
                >
                  <Check size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="text-xs px-2 py-1.5 rounded-md text-gray-500 hover:bg-gray-100"
                >
                  {t('common.cancel')}
                </button>
              </form>
            ) : (
              <>
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">{level.name}</span>
                {level.isDefault && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-500/20 rounded-full px-2 py-0.5">
                    <Star size={11} aria-hidden="true" />
                    {t('settings.priceLevels.defaultBadge')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(level.id);
                    setEditName(level.name);
                  }}
                  className="p-2 rounded-md text-gray-500 hover:text-blue-700 hover:bg-blue-50"
                  aria-label={t('settings.priceLevels.rename', { name: level.name })}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                {!level.isDefault && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => archive(level)}
                    className="p-2 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                    aria-label={t('settings.priceLevels.archive', { name: level.name })}
                  >
                    <Archive size={14} aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={newName}
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('settings.priceLevels.newPlaceholder')}
          aria-label={t('settings.priceLevels.nameLabel')}
          className="flex-1 min-w-0 border-2 border-gray-300 rounded-md px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={busy || !newName.trim()}
          className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
        >
          <Plus size={15} aria-hidden="true" />
          {t('settings.priceLevels.add')}
        </button>
      </form>

      <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
        <input
          type="checkbox"
          checked={!!overrideAdminOnly}
          disabled={overrideAdminOnly === null}
          onChange={(e) => saveOverride(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-blue-600"
        />
        <span>
          <span className="block text-sm font-medium text-gray-900">{t('settings.priceLevels.adminOnlyTitle')}</span>
          <span className="block text-xs text-gray-500">{t('settings.priceLevels.adminOnlyDescription')}</span>
        </span>
      </label>
    </section>
  );
}
