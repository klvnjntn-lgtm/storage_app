// app/accounting/fixed-assets/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Building2, Plus, X, Loader2, Calendar, CheckCircle2, Wallet, TrendingDown, PackageX } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import Pagination from '@/app/components/shared/Pagination';
import { toCalendarDateString } from '@/lib/dates';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';


type FixedAsset = {
  id: string;
  name: string;
  category: string | null;
  locationId: string | null;
  location?: { name: string } | null;
  acquisitionDate: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  amountPaid: number;
  status: 'ACTIVE' | 'DISPOSED';
  disposedAt: string | null;
  disposalProceeds: number | null;
};

type Location = { id: string; name: string };
type BankAccount = { id: string; bankName: string; accountNumber: string; accountName: string; archivedAt: string | null };

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

// FIX — .toISOString() converts to UTC first, wrong for a ~7-hour window
// after local midnight in a timezone ahead of UTC. Not just a display
// bug: this pre-fills the actual acquisitionDate/payment/disposal dates
// submitted on create.
function todayISO() {
  return toCalendarDateString(new Date());
}

const STATUS_META: Record<FixedAsset['status'], { labelKey: string; color: string }> = {
  ACTIVE: { labelKey: 'accounting.fixedAssets.statusActive', color: 'text-green-700 bg-green-50 border-green-200' },
  DISPOSED: { labelKey: 'accounting.fixedAssets.statusDisposed', color: 'text-gray-500 bg-gray-100 border-gray-300' },
};

export default function FixedAssetsPage() {
  const { t, language } = useLanguage();
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[] | null>(null);

  const [assets, setAssets] = useState<{ data: FixedAsset[]; total: number; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Seeded from the URL so returning here (e.g. via the browser's Back
  // button) restores the same filter/page.
  const [statusFilter, setStatusFilter] = useState<string>(() => getInitialParam('status', 'ACTIVE'));
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', 20));

  useSyncQueryParams({
    status: statusFilter !== 'ACTIVE' ? statusFilter : null,
    page: page !== 1 ? page : null,
    pageSize: pageSize !== 20 ? pageSize : null,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: '', category: '', locationId: '', acquisitionDate: todayISO(),
    cost: '', salvageValue: '0', usefulLifeMonths: '36',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [payingId, setPayingId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', method: 'CASH', bankAccountId: '', paidAt: todayISO() });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const [disposingId, setDisposingId] = useState<string | null>(null);
  const [disposeForm, setDisposeForm] = useState({ proceeds: '0', method: 'CASH', bankAccountId: '', disposedAt: todayISO() });
  const [disposeSaving, setDisposeSaving] = useState(false);
  const [disposeError, setDisposeError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [runningDep, setRunningDep] = useState(false);
  const [depMessage, setDepMessage] = useState<string | null>(null);

  async function loadLocations() {
    const res = await apiFetch('/locations');
    if (res.ok) setLocations(await res.json());
  }

  async function loadBankAccounts() {
    if (bankAccounts !== null) return; // fetch once, lazily
    const res = await apiFetch('/organizations/bank-accounts');
    if (res.ok) {
      const data: BankAccount[] = await res.json();
      setBankAccounts(data.filter((b) => !b.archivedAt));
    }
  }

  async function loadAssets() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (statusFilter) params.set('status', statusFilter);

      const res = await apiFetch(`/fixed-assets?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.fixedAssets.requestFailed', { status: res.status }));
        return;
      }
      setAssets(await res.json());
    } catch {
      setError(t('accounting.fixedAssets.couldNotReachServer'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLocations();
  }, []);

  // FIX — see ledger/page.tsx's identical fix: merges what were two
  // separate effects into one, so a filter change fires exactly one
  // request instead of two.
  const prevStatusFilterRef = useRef(statusFilter);
  useEffect(() => {
    if (prevStatusFilterRef.current !== statusFilter) {
      prevStatusFilterRef.current = statusFilter;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, page, pageSize]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const cost = Number(form.cost);
    const salvageValue = Number(form.salvageValue || 0);
    const usefulLifeMonths = Number(form.usefulLifeMonths);

    if (!form.name.trim()) {
      setFormError(t('accounting.fixedAssets.nameRequired'));
      return;
    }
    if (!cost || cost <= 0) {
      setFormError(t('accounting.fixedAssets.enterCostGreaterThanZero'));
      return;
    }
    if (salvageValue >= cost) {
      setFormError(t('accounting.fixedAssets.salvageValueMustBeLessThanCost'));
      return;
    }
    if (!usefulLifeMonths || usefulLifeMonths <= 0) {
      setFormError(t('accounting.fixedAssets.enterUsefulLife'));
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch('/fixed-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category.trim() || undefined,
          locationId: form.locationId || undefined,
          acquisitionDate: form.acquisitionDate,
          cost,
          salvageValue,
          usefulLifeMonths,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setFormError(body?.message ?? t('accounting.fixedAssets.requestFailed', { status: res.status }));
        return;
      }
      setForm({ name: '', category: '', locationId: '', acquisitionDate: todayISO(), cost: '', salvageValue: '0', usefulLifeMonths: '36' });
      setShowAdd(false);
      setPage(1);
      await loadAssets();
    } catch {
      setFormError(t('accounting.fixedAssets.couldNotReachServer'));
    } finally {
      setSaving(false);
    }
  }

  function openPayForm(asset: FixedAsset) {
    setPayingId(asset.id);
    setPayError(null);
    const balance = Math.max(asset.cost - asset.amountPaid, 0);
    setPayForm({ amount: String(balance), method: 'CASH', bankAccountId: '', paidAt: todayISO() });
    loadBankAccounts();
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payingId) return;
    setPayError(null);

    const amount = Number(payForm.amount);
    if (!(amount > 0)) {
      setPayError(t('accounting.fixedAssets.enterPaymentAmountGreaterThanZero'));
      return;
    }
    if (payForm.method !== 'CASH' && !payForm.bankAccountId) {
      setPayError(t('accounting.fixedAssets.choosePaymentBankAccount'));
      return;
    }

    setPaySaving(true);
    try {
      const res = await apiFetch(`/fixed-assets/${payingId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          method: payForm.method,
          paidAt: payForm.paidAt || undefined,
          bankAccountId: payForm.method === 'CASH' ? undefined : payForm.bankAccountId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setPayError(body?.message ?? t('accounting.fixedAssets.requestFailed', { status: res.status }));
        return;
      }
      setPayingId(null);
      await loadAssets();
    } catch {
      setPayError(t('accounting.fixedAssets.couldNotReachServer'));
    } finally {
      setPaySaving(false);
    }
  }

  function openDisposeForm(asset: FixedAsset) {
    setDisposingId(asset.id);
    setDisposeError(null);
    setDisposeForm({ proceeds: '0', method: 'CASH', bankAccountId: '', disposedAt: todayISO() });
    loadBankAccounts();
  }

  async function handleDispose(e: React.FormEvent) {
    e.preventDefault();
    if (!disposingId) return;
    setDisposeError(null);

    const proceeds = Number(disposeForm.proceeds || 0);
    if (proceeds < 0) {
      setDisposeError(t('accounting.fixedAssets.proceedsCannotBeNegative'));
      return;
    }
    if (proceeds > 0 && disposeForm.method !== 'CASH' && !disposeForm.bankAccountId) {
      setDisposeError(t('accounting.fixedAssets.chooseProceedsBankAccount'));
      return;
    }

    setDisposeSaving(true);
    try {
      const res = await apiFetch(`/fixed-assets/${disposingId}/dispose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proceeds,
          method: proceeds > 0 ? disposeForm.method : undefined,
          bankAccountId: proceeds > 0 && disposeForm.method !== 'CASH' ? disposeForm.bankAccountId : undefined,
          disposedAt: disposeForm.disposedAt || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setDisposeError(body?.message ?? t('accounting.fixedAssets.requestFailed', { status: res.status }));
        return;
      }
      setDisposingId(null);
      await loadAssets();
    } catch {
      setDisposeError(t('accounting.fixedAssets.couldNotReachServer'));
    } finally {
      setDisposeSaving(false);
    }
  }

  async function handleDelete(asset: FixedAsset) {
    if (!confirm(t('accounting.fixedAssets.deleteConfirm', { name: asset.name }))) return;
    setDeletingId(asset.id);
    setError(null);
    try {
      const res = await apiFetch(`/fixed-assets/${asset.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.fixedAssets.requestFailed', { status: res.status }));
        return;
      }
      await loadAssets();
    } catch {
      setError(t('accounting.fixedAssets.couldNotReachServer'));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRunDepreciation() {
    setRunningDep(true);
    setDepMessage(null);
    try {
      const res = await apiFetch('/fixed-assets/run-depreciation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setDepMessage(body?.message ?? t('accounting.fixedAssets.requestFailed', { status: res.status }));
        return;
      }
      const result = await res.json();
      setDepMessage(
        result.assetsDepreciated === 0
          ? t('accounting.fixedAssets.depreciationCaughtUp')
          : t('accounting.fixedAssets.depreciationPosted', { count: result.assetsDepreciated }),
      );
      await loadAssets();
    } catch {
      setDepMessage(t('accounting.fixedAssets.couldNotReachServer'));
    } finally {
      setRunningDep(false);
    }
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Building2 size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div className="min-w-0">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>{t('nav.items.fixedAssets')}</h1>
                <p className="text-xs text-gray-500 truncate">{t('accounting.fixedAssets.subtitle')}</p>
              </div>
            </div>
            <button
              onClick={handleRunDepreciation}
              disabled={runningDep}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-md border-2 border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:border-blue-400 hover:text-blue-700 disabled:opacity-60 transition-colors shrink-0"
            >
              {runningDep ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : <TrendingDown size={12} strokeWidth={2} />}
              {t('accounting.fixedAssets.runDepreciation')}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>
        )}
        {depMessage && (
          <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">{depMessage}</p>
        )}

        <button
          onClick={handleRunDepreciation}
          disabled={runningDep}
          className="sm:hidden w-full mb-4 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border-2 border-gray-300 bg-white text-xs font-semibold text-gray-700 hover:border-blue-400 hover:text-blue-700 disabled:opacity-60 transition-colors"
        >
          {runningDep ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : <TrendingDown size={12} strokeWidth={2} />}
          {t('accounting.fixedAssets.runDepreciationThroughToday')}
        </button>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
          >
            <option value="">{t('accounting.fixedAssets.allStatuses')}</option>
            <option value="ACTIVE">{t('accounting.fixedAssets.statusActive')}</option>
            <option value="DISPOSED">{t('accounting.fixedAssets.statusDisposed')}</option>
          </select>

          <button
            onClick={() => setShowAdd((s) => !s)}
            className="sm:ml-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            {showAdd ? <X size={15} strokeWidth={2} /> : <Plus size={15} strokeWidth={2} />}
            {showAdd ? t('common.cancel') : t('accounting.fixedAssets.newAsset')}
          </button>
        </div>

        {/* Add asset form */}
        {showAdd && (
          <form
            onSubmit={handleAdd}
            className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3"
          >
            {formError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{formError}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">{t('common.name')}</label>
                <input
                  type="text"
                  placeholder={t('accounting.fixedAssets.namePlaceholder')}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">{t('accounting.fixedAssets.categoryOptional')}</label>
                <input
                  type="text"
                  placeholder={t('accounting.fixedAssets.categoryPlaceholder')}
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('accounting.fixedAssets.locationOptional')}</label>
              <select
                value={form.locationId}
                onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              >
                <option value="">{t('accounting.fixedAssets.unassigned')}</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                  <Calendar size={11} strokeWidth={2} /> {t('accounting.fixedAssets.acquisitionDate')}
                </label>
                <input
                  type="date"
                  value={form.acquisitionDate}
                  onChange={(e) => setForm((f) => ({ ...f, acquisitionDate: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">{t('accounting.fixedAssets.costRp')}</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={form.cost}
                  onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">{t('accounting.fixedAssets.salvageValueRp')}</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.salvageValue}
                  onChange={(e) => setForm((f) => ({ ...f, salvageValue: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">{t('accounting.fixedAssets.usefulLifeMonths')}</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.usefulLifeMonths}
                  onChange={(e) => setForm((f) => ({ ...f, usefulLifeMonths: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>
            </div>
            <p className="text-[10px] text-gray-400">
              {t('accounting.fixedAssets.depreciationHint')}
            </p>
            <button
              type="submit"
              disabled={saving}
              className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
              {saving ? t('accounting.fixedAssets.recording') : t('accounting.fixedAssets.recordAsset')}
            </button>
          </form>
        )}

        {/* List */}
        {loading && <p className="text-sm text-gray-500">{t('accounting.fixedAssets.loadingAssets')}</p>}

        {!loading && assets && assets.data.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">{t('accounting.fixedAssets.noAssetsYet')}</p>
        )}

        {!loading && assets && assets.data.length > 0 && (
          <>
            <div className="flex flex-col gap-2">
              {assets.data.map((asset) => {
                const meta = STATUS_META[asset.status];
                const isPaying = payingId === asset.id;
                const isDisposing = disposingId === asset.id;
                const balance = Math.max(asset.cost - asset.amountPaid, 0);
                const canDelete = asset.status === 'ACTIVE' && asset.amountPaid === 0 && asset.accumulatedDepreciation === 0;

                return (
                  <div key={asset.id} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
                    <div className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate">{asset.name}</span>
                          <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 flex items-center gap-1 shrink-0 ${meta.color}`}>
                            {asset.status === 'ACTIVE' ? <CheckCircle2 size={10} strokeWidth={2} /> : <PackageX size={10} strokeWidth={2} />}
                            {t(meta.labelKey)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {[asset.category, asset.location?.name].filter(Boolean).join(' · ') || '—'}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {t('accounting.fixedAssets.acquiredOn', { date: new Date(asset.acquisitionDate).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' }) })}
                          {asset.status === 'DISPOSED' && asset.disposedAt &&
                            ` · ${t('accounting.fixedAssets.disposedOn', { date: new Date(asset.disposedAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' }) })}`}
                        </p>
                        {balance > 0 && asset.status === 'ACTIVE' && (
                          <p className="text-[11px] text-amber-700 mt-0.5">{t('accounting.fixedAssets.unpaidAmount', { amount: formatIDR(balance) })}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold">{formatIDR(asset.cost)}</p>
                        <p className="text-[11px] text-gray-400">{t('accounting.fixedAssets.nbvAmount', { amount: formatIDR(asset.netBookValue) })}</p>
                        <div className="flex items-center gap-2.5 mt-1 justify-end">
                          {asset.status === 'ACTIVE' && balance > 0 && !isPaying && (
                            <button
                              onClick={() => openPayForm(asset)}
                              className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1"
                            >
                              <Wallet size={11} strokeWidth={2} />
                              {t('accounting.fixedAssets.pay')}
                            </button>
                          )}
                          {asset.status === 'ACTIVE' && !isDisposing && (
                            <button
                              onClick={() => openDisposeForm(asset)}
                              className="text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                            >
                              {t('accounting.fixedAssets.dispose')}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(asset)}
                              disabled={deletingId === asset.id}
                              className="text-[11px] font-semibold text-gray-400 hover:text-red-600 disabled:opacity-50"
                            >
                              {deletingId === asset.id ? '...' : t('common.delete')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {isPaying && (
                      <form
                        onSubmit={handleRecordPayment}
                        className="px-3 pb-3 pt-2 border-t border-gray-100 bg-gray-50/60 flex flex-col gap-2.5"
                      >
                        {payError && (
                          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{payError}</p>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">{t('common.amount')}</label>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              max={balance}
                              value={payForm.amount}
                              onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">{t('accounting.expenses.method')}</label>
                            <select
                              value={payForm.method}
                              onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value, bankAccountId: '' }))}
                              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                            >
                              <option value="CASH">{t('accounting.expenses.methodCash')}</option>
                              <option value="TRANSFER">{t('accounting.expenses.methodTransfer')}</option>
                              <option value="QRIS">QRIS</option>
                              <option value="OTHER">{t('accounting.expenses.methodOther')}</option>
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">{t('accounting.expenses.paidOn')}</label>
                            <input
                              type="date"
                              value={payForm.paidAt}
                              onChange={(e) => setPayForm((f) => ({ ...f, paidAt: e.target.value }))}
                              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                            />
                          </div>
                        </div>

                        {payForm.method !== 'CASH' && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">{t('accounting.expenses.bankAccount')}</label>
                            {bankAccounts === null ? (
                              <p className="text-xs text-gray-400">{t('accounting.expenses.loadingBankAccounts')}</p>
                            ) : bankAccounts.length === 0 ? (
                              <p className="text-xs text-amber-700">{t('accounting.expenses.noBankAccountsYet')}</p>
                            ) : (
                              <select
                                value={payForm.bankAccountId}
                                onChange={(e) => setPayForm((f) => ({ ...f, bankAccountId: e.target.value }))}
                                className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                              >
                                <option value="">{t('accounting.expenses.chooseEllipsis')}</option>
                                {bankAccounts.map((b) => (
                                  <option key={b.id} value={b.id}>{b.bankName} •••{b.accountNumber.slice(-4)}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={paySaving}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
                          >
                            {paySaving && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
                            {paySaving ? t('common.saving') : t('accounting.expenses.confirmPayment')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayingId(null)}
                            className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-2"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </form>
                    )}

                    {isDisposing && (
                      <form
                        onSubmit={handleDispose}
                        className="px-3 pb-3 pt-2 border-t border-gray-100 bg-gray-50/60 flex flex-col gap-2.5"
                      >
                        {disposeError && (
                          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{disposeError}</p>
                        )}
                        <p className="text-[11px] text-gray-500">
                          {t('accounting.fixedAssets.disposeHint', { amount: formatIDR(asset.netBookValue) })}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">{t('accounting.fixedAssets.proceedsRp')}</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={disposeForm.proceeds}
                              onChange={(e) => setDisposeForm((f) => ({ ...f, proceeds: e.target.value }))}
                              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">{t('accounting.fixedAssets.disposedOnLabel')}</label>
                            <input
                              type="date"
                              value={disposeForm.disposedAt}
                              onChange={(e) => setDisposeForm((f) => ({ ...f, disposedAt: e.target.value }))}
                              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                            />
                          </div>
                        </div>

                        {Number(disposeForm.proceeds || 0) > 0 && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">{t('accounting.fixedAssets.receivedVia')}</label>
                            <select
                              value={disposeForm.method}
                              onChange={(e) => setDisposeForm((f) => ({ ...f, method: e.target.value, bankAccountId: '' }))}
                              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                            >
                              <option value="CASH">{t('accounting.expenses.methodCash')}</option>
                              <option value="TRANSFER">{t('accounting.expenses.methodTransfer')}</option>
                              <option value="QRIS">QRIS</option>
                              <option value="OTHER">{t('accounting.expenses.methodOther')}</option>
                            </select>
                          </div>
                        )}

                        {Number(disposeForm.proceeds || 0) > 0 && disposeForm.method !== 'CASH' && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">{t('accounting.expenses.bankAccount')}</label>
                            {bankAccounts === null ? (
                              <p className="text-xs text-gray-400">{t('accounting.expenses.loadingBankAccounts')}</p>
                            ) : bankAccounts.length === 0 ? (
                              <p className="text-xs text-amber-700">{t('accounting.expenses.noBankAccountsYet')}</p>
                            ) : (
                              <select
                                value={disposeForm.bankAccountId}
                                onChange={(e) => setDisposeForm((f) => ({ ...f, bankAccountId: e.target.value }))}
                                className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                              >
                                <option value="">{t('accounting.expenses.chooseEllipsis')}</option>
                                {bankAccounts.map((b) => (
                                  <option key={b.id} value={b.id}>{b.bankName} •••{b.accountNumber.slice(-4)}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={disposeSaving}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
                          >
                            {disposeSaving && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
                            {disposeSaving ? t('common.saving') : t('accounting.fixedAssets.confirmDisposal')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDisposingId(null)}
                            className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-2"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <Pagination
                page={assets.page}
                pageSize={assets.pageSize}
                totalItems={assets.total}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
