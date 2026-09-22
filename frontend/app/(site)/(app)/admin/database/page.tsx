// app/admin/database/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Layers, Award, Search, GitMerge, AlertTriangle, CheckCircle2, Database } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';
type EntityType = 'location' | 'category' | 'brand';

type ReferenceItem = {
  id: string;
  name: string;
  usageCount: number;
};

const PAGE_SIZE = 20;

const ENTITY_ICONS: Record<EntityType, typeof MapPin> = {
  location: MapPin,
  category: Layers,
  brand: Award,
};

const ENTITY_PATHS: Record<EntityType, { listPath: string; mergePath: string }> = {
  location: { listPath: 'locations', mergePath: 'locations/merge' },
  category: { listPath: 'categories', mergePath: 'categories/merge' },
  brand: { listPath: 'brands', mergePath: 'brands/merge' },
};

function authHeaders(json = true) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function ReferenceDataPage() {
    const { authorized, loading: authLoading } = useRequireAdmin();
  const { t } = useLanguage();

  const ENTITY_CONFIG: Record<
    EntityType,
    { label: string; plural: string; icon: typeof MapPin; listPath: string; mergePath: string }
  > = {
    location: {
      label: t('admin.database.entities.location.label'),
      plural: t('admin.database.entities.location.plural'),
      icon: ENTITY_ICONS.location,
      ...ENTITY_PATHS.location,
    },
    category: {
      label: t('admin.database.entities.category.label'),
      plural: t('admin.database.entities.category.plural'),
      icon: ENTITY_ICONS.category,
      ...ENTITY_PATHS.category,
    },
    brand: {
      label: t('admin.database.entities.brand.label'),
      plural: t('admin.database.entities.brand.plural'),
      icon: ENTITY_ICONS.brand,
      ...ENTITY_PATHS.brand,
    },
  };

  const [activeType, setActiveType] = useState<EntityType>('location');
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Controlled draft values for the rename inputs, keyed by item id.
  // Previously the name input used defaultValue (uncontrolled), so a
  // failed rename left whatever the user typed sitting in the field
  // with no indication it hadn't actually saved. Keeping drafts here
  // lets us snap the field back to the last known-good name on failure.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const config = ENTITY_CONFIG[activeType];

  async function loadItems() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/${config.listPath}`, {
  headers: authHeaders(false),
});

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t('admin.database.failedToLoad', { plural: config.plural.toLowerCase() }));
      }

      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setItems(list);
      setDrafts(Object.fromEntries(list.map((i: ReferenceItem) => [i.id, i.name])));
    } catch (err: any) {
      console.error(err);
      setError(err.message || t('admin.database.couldNotLoad', { plural: config.plural.toLowerCase() }));
      setItems([]);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelected(new Set());
    setSurvivorId(null);
    setSuccessMsg('');
    setQuery('');
    setPage(1);
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()));
  }, [items, query]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const selectedItems = items.filter((i) => selected.has(i.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setSurvivorId(null);
  }

  async function handleRename(id: string, name: string) {
    const trimmed = name.trim();
    const current = items.find((i) => i.id === id);
    if (!trimmed || !current) return;

    // Nothing actually changed (e.g. blur without an edit) — don't fire
    // a request or flash "Saving...".
    if (trimmed === current.name) {
      setDrafts((prev) => ({ ...prev, [id]: current.name }));
      return;
    }

    setSavingId(id);
    try {
      const res = await apiFetch(`/${config.listPath}/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t('admin.database.renameFailed'));
      }

      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, name: trimmed } : i)));
      setDrafts((prev) => ({ ...prev, [id]: trimmed }));
    } catch (err: any) {
      console.error(err);
      setError(err.message || t('admin.database.renameFailedCheckConsole'));
      // Snap the field back to the last saved name so the UI doesn't
      // show an edit that was actually rejected by the server.
      setDrafts((prev) => ({ ...prev, [id]: current.name }));
    } finally {
      setSavingId(null);
    }
  }

  async function handleMerge() {
    if (!survivorId || selected.size < 2) return;

    const sourceIds = Array.from(selected).filter((id) => id !== survivorId);
    const survivor = items.find((i) => i.id === survivorId);
    const losers = items.filter((i) => sourceIds.includes(i.id));

    // Sources are archived (soft-deleted) by the merge endpoint, not hard
    // -deleted — they stay resolvable for historical records (e.g. past
    // stock events) but drop out of normal lists. "Permanently deletes"
    // overstated what actually happens here.
    const confirmed = window.confirm(
      t('admin.database.mergeConfirm', {
        losers: losers.map((l) => l.name).join(', '),
        survivor: survivor?.name ?? '',
      })
    );
    if (!confirmed) return;

    setMerging(true);
    setError('');

    try {
      const res = await apiFetch(`/${config.mergePath}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ sourceIds, targetId: survivorId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || t('admin.database.mergeFailed'));
      }

      setSuccessMsg(t('admin.database.mergedInto', { survivor: survivor?.name ?? '' }));
      setSelected(new Set());
      setSurvivorId(null);
      await loadItems();
    } catch (err: any) {
      console.error(err);
      setError(err.message || t('admin.database.mergeFailedCheckConsole'));
    } finally {
      setMerging(false);
    }
  }

  if (authLoading || !authorized) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-400">{t('admin.database.checkingAccess')}</p>
      </main>
    );
  }
  return (
<main className="min-h-screen bg-white text-black">

  {/* Header */}
  <div className="px-6 py-5 border-b-2 border-gray-300">
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <Database size={22} strokeWidth={2} className="text-gray-700" />
        <div>
          <h1 className="text-2xl font-bold">{t('admin.database.title')}</h1>
          <p className="text-xs text-gray-500">{t('admin.database.subtitle')}</p>
        </div>
      </div>
    </div>
  </div>

  {/* Content */}
  <div className="p-6 max-w-5xl mx-auto space-y-6">

    {/* TYPE TABS */}
    <div className="flex border-2 border-gray-300 rounded-md overflow-hidden w-fit">
      {(Object.keys(ENTITY_CONFIG) as EntityType[]).map((type) => {
        const c = ENTITY_CONFIG[type];
        const Icon = c.icon;
        const active = activeType === type;
        return (
          <button
            key={type}
            onClick={() => setActiveType(type)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold ${
              active ? 'bg-black text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            } ${type !== 'location' ? 'border-l-2 border-gray-300' : ''}`}
          >
            <Icon size={16} strokeWidth={2} />
            {c.plural}
          </button>
        );
      })}
    </div>

    {/* SEARCH */}
    <div className="relative sm:max-w-sm">
      <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('admin.database.searchPlaceholder', { plural: config.plural.toLowerCase() })}
        className="w-full border-2 border-gray-300 rounded-md pl-9 pr-3 py-2.5 sm:py-2 text-sm outline-none focus:border-black"
      />
    </div>

    {error && (
      <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
        <AlertTriangle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
        {error}
      </div>
    )}

    {successMsg && (
      <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
        <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
        {successMsg}
      </div>
    )}

    {/* MERGE BAR */}
    {selected.size >= 2 && (
      <div className="border-2 border-blue-300 bg-blue-50 rounded-md p-4 space-y-3">
        <p className="text-sm font-semibold text-blue-900 flex items-center gap-2">
          <GitMerge size={16} strokeWidth={2} />
          {t('admin.database.mergePrompt', { count: selected.size, plural: config.plural.toLowerCase() })}
        </p>

        <div className="space-y-1">
          {selectedItems.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="survivor"
                checked={survivorId === item.id}
                onChange={() => setSurvivorId(item.id)}
              />
              <span className="font-medium">{item.name}</span>
              <span className="text-gray-500">{t('admin.database.inUseCount', { count: item.usageCount })}</span>
            </label>
          ))}
        </div>

        <button
          onClick={handleMerge}
          disabled={!survivorId || merging}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {merging ? t('admin.database.merging') : t('admin.database.merge')}
        </button>
      </div>
    )}

    {/* LIST */}
    {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}

    {!loading && filtered.length === 0 && (
      <p className="text-sm text-gray-500">{t('admin.database.noneFound', { plural: config.plural.toLowerCase() })}</p>
    )}

    {!loading && filtered.length > 0 && (
      <div className="border-2 border-gray-300 rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 border-b-2 border-gray-300">
            <tr>
              <th className="w-10 p-3"></th>
              <th className="text-left p-3 font-semibold">{t('common.name')}</th>
              <th className="text-left p-3 font-semibold">{t('admin.database.inUseHeader')}</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((item, idx) => (
              <tr
                key={item.id}
                className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'} ${
                  selected.has(item.id) ? 'bg-blue-50' : ''
                }`}
              >
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                  />
                </td>
                <td className="p-1">
                  <input
                    value={drafts[item.id] ?? item.name}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    onBlur={(e) => handleRename(item.id, e.target.value)}
                    className="w-full bg-transparent border border-transparent focus:border-gray-400 focus:bg-white rounded px-2 py-1.5 font-medium outline-none"
                  />
                  {savingId === item.id && (
                    <span className="text-xs text-gray-400 ml-2">{t('common.saving')}</span>
                  )}
                </td>
                <td className="p-3 text-gray-600">{item.usageCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {/* Pagination */}
    {!loading && filtered.length > 0 && (
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500">
          {t('admin.database.showingRange', {
            from: (page - 1) * PAGE_SIZE + 1,
            to: Math.min(page * PAGE_SIZE, filtered.length),
            total: filtered.length,
          })}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
          >
            {t('common.previous')}
          </button>
          <span className="text-gray-600">
            {t('admin.database.pageOf', { page, totalPages })}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
          >
            {t('common.next')}
          </button>
        </div>
      </div>
    )}

  </div>
</main>);
}