// app/accounting/setup/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import {
  ArrowLeft,
  Landmark,
  CheckCircle2,
  Plus,
  X,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type Account = {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  normalBalance: 'DEBIT' | 'CREDIT';
  systemKey: string | null;
  isActive: boolean;
};

const TYPE_ORDER: Account['type'][] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const TYPE_LABEL: Record<Account['type'], string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expenses',
};

export default function AccountingSetupPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', type: 'EXPENSE' as Account['type'], normalBalance: 'DEBIT' as 'DEBIT' | 'CREDIT' });

  async function loadAccounts() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/accounting/accounts');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setAccounts(await res.json());
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  async function handleSeed() {
    setSeeding(true);
    setError(null);
    try {
      const res = await apiFetch('/accounting/accounts/seed-defaults', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      await loadAccounts();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSeeding(false);
    }
  }

  async function handleToggleActive(acc: Account) {
    setTogglingId(acc.id);
    setError(null);
    try {
      const res = await apiFetch(`/accounting/accounts/${acc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !acc.isActive }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      await loadAccounts();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.code.trim() || !form.name.trim()) {
      setFormError('Code and name are both required.');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch('/accounting/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setFormError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setForm({ code: '', name: '', type: 'EXPENSE', normalBalance: 'DEBIT' });
      setShowAddForm(false);
      await loadAccounts();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  const grouped = useMemo(() => {
    if (!accounts) return null;
    const map = new Map<Account['type'], Account[]>();
    for (const type of TYPE_ORDER) map.set(type, []);
    for (const acc of accounts) map.get(acc.type)?.push(acc);
    for (const list of map.values()) list.sort((a, b) => a.code.localeCompare(b.code));
    return map;
  }, [accounts]);

  const isEmpty = accounts !== null && accounts.length === 0;
  const isSetUp = accounts !== null && accounts.length > 0;

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Landmark size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Chart of Accounts
              </h1>
              <p className="text-xs text-gray-500 truncate">
                The accounts every invoice, expense, and payroll run posts to
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-gray-500">Checking your setup...</p>}

        {/* Empty state — the actual onboarding moment */}
        {!loading && isEmpty && (
          <div className="border-2 border-gray-300 rounded-md bg-white p-6 sm:p-8 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-amber-50 border border-amber-200 mx-auto mb-4">
              <AlertTriangle size={22} strokeWidth={2} className="text-amber-600" />
            </div>
            <h2 className={`${display.className} text-lg font-bold mb-2`}>
              Set up your Chart of Accounts before invoicing
            </h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6 leading-relaxed">
              Invoices, payments, expenses, and payroll all need somewhere to post to —
              a Cash account, Accounts Receivable, Sales Revenue, and so on. Start with a
              standard set you can rename or extend later.
            </p>
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {seeding ? (
                <>
                  <Loader2 size={16} strokeWidth={2} className="animate-spin" />
                  Setting up...
                </>
              ) : (
                'Set up Chart of Accounts'
              )}
            </button>
          </div>
        )}

        {/* Set-up state — grouped account list + add-custom-account */}
        {!loading && isSetUp && grouped && (
          <>
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3 mb-5">
              <CheckCircle2 size={16} strokeWidth={2} className="shrink-0" />
              <span>Chart of Accounts is set up — invoices, expenses, and payroll can post.</span>
            </div>

            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-600">
                {accounts!.length} account{accounts!.length === 1 ? '' : 's'}
              </h2>
              <button
                onClick={() => setShowAddForm((s) => !s)}
                className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 px-2.5 py-1.5 rounded-md hover:bg-blue-50 active:bg-blue-100 transition-colors"
              >
                {showAddForm ? <X size={14} strokeWidth={2} /> : <Plus size={14} strokeWidth={2} />}
                {showAddForm ? 'Cancel' : 'Add account'}
              </button>
            </div>

            {showAddForm && (
              <form
                onSubmit={handleAddAccount}
                className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3"
              >
                {formError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
                    {formError}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-gray-600">Code</label>
                    <input
                      type="text"
                      placeholder="e.g. 6100"
                      value={form.code}
                      onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-gray-600">Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Office Supplies"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-gray-600">Type</label>
                    <select
                      value={form.type}
                      onChange={(e) => {
                        const type = e.target.value as Account['type'];
                        const normalBalance = type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
                        setForm((f) => ({ ...f, type, normalBalance }));
                      }}
                      className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                    >
                      {TYPE_ORDER.map((t) => (
                        <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-gray-600">Normal balance</label>
                    <select
                      value={form.normalBalance}
                      onChange={(e) => setForm((f) => ({ ...f, normalBalance: e.target.value as 'DEBIT' | 'CREDIT' }))}
                      className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="DEBIT">Debit</option>
                      <option value="CREDIT">Credit</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60"
                >
                  {saving ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : null}
                  {saving ? 'Adding...' : 'Add account'}
                </button>
              </form>
            )}

            <div className="flex flex-col gap-4">
              {TYPE_ORDER.map((type) => {
                const list = grouped.get(type) ?? [];
                if (list.length === 0) return null;
                return (
                  <div key={type} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
                    <div className="px-4 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100">
                      {TYPE_LABEL[type]}
                    </div>
                    {list.map((acc) => (
                      <div
                        key={acc.id}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xs font-mono text-gray-400 shrink-0 w-12">{acc.code}</span>
                          <span className={`text-sm truncate ${acc.isActive ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                            {acc.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {acc.systemKey && (
                            <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                              {acc.systemKey.replace(/_/g, ' ')}
                            </span>
                          )}
                          {/* System accounts can't be archived — the backend
                              rejects it outright, since it'd break every
                              document type that posts to it. Only custom
                              accounts get the toggle. */}
                          {!acc.systemKey && (
                            <button
                              onClick={() => handleToggleActive(acc)}
                              disabled={togglingId === acc.id}
                              className="text-[11px] font-semibold text-gray-400 hover:text-blue-700 disabled:opacity-50"
                            >
                              {togglingId === acc.id ? '...' : acc.isActive ? 'Archive' : 'Reactivate'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}