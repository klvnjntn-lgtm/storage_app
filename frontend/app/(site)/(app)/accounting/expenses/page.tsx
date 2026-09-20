// app/accounting/expenses/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import {
  ArrowLeft,
  Receipt,
  Plus,
  X,
  Loader2,
  Tag,
  Calendar,
  CheckCircle2,
  Clock,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import Pagination from '@/app/components/Pagination';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type ExpenseCategory = {
  id: string;
  name: string;
  accountId: string | null;
  account?: { id: string; code: string; name: string } | null;
};

type Expense = {
  id: string;
  categoryId: string;
  category: ExpenseCategory;
  description: string | null;
  amount: string | number;
  expenseDate: string;
  dueDate: string | null;
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  paidAt: string | null;
  paymentMethod: string | null;
};

type Account = { id: string; code: string; name: string; type: string };
type BankAccount = { id: string; bankName: string; accountNumber: string; accountName: string; archivedAt: string | null };

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_META: Record<Expense['status'], { label: string; color: string; icon: typeof Clock }> = {
  UNPAID: { label: 'Unpaid', color: 'text-amber-700 bg-amber-50 border-amber-200', icon: Clock },
  PARTIALLY_PAID: { label: 'Partially paid', color: 'text-blue-700 bg-blue-50 border-blue-200', icon: Clock },
  PAID: { label: 'Paid', color: 'text-green-700 bg-green-50 border-green-200', icon: CheckCircle2 },
};

export default function ExpensesPage() {
  const router = useRouter();

  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[] | null>(null);

  const [expenses, setExpenses] = useState<{ data: Expense[]; total: number; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '', accountId: '' });
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ categoryId: '', description: '', amount: '', expenseDate: todayISO(), dueDate: '' });
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);

  const [payingId, setPayingId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ paymentMethod: 'CASH', bankAccountId: '', paidAt: todayISO() });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editExpenseForm, setEditExpenseForm] = useState({ description: '', dueDate: '' });
  const [editExpenseSaving, setEditExpenseSaving] = useState(false);
  const [editExpenseError, setEditExpenseError] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryForm, setEditCategoryForm] = useState({ name: '', accountId: '' });
  const [editCategorySaving, setEditCategorySaving] = useState(false);
  const [editCategoryError, setEditCategoryError] = useState<string | null>(null);

  async function loadCategories() {
    const res = await apiFetch('/expenses/categories');
    if (res.ok) setCategories(await res.json());
  }

  async function loadAccounts() {
    const res = await apiFetch('/accounting/accounts');
    if (res.ok) setAccounts(await res.json());
  }

  async function loadBankAccounts() {
    if (bankAccounts !== null) return; // fetch once, lazily
    const res = await apiFetch('/organizations/bank-accounts');
    if (res.ok) {
      const data: BankAccount[] = await res.json();
      setBankAccounts(data.filter((b) => !b.archivedAt));
    }
  }

  async function loadExpenses() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('categoryId', categoryFilter);

      const res = await apiFetch(`/expenses?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setExpenses(await res.json());
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
    loadAccounts();
  }, []);

  useEffect(() => {
    loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, categoryFilter, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, categoryFilter]);

  const expenseAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.type === 'EXPENSE').sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    setCategoryError(null);
    if (!categoryForm.name.trim()) {
      setCategoryError('Name is required.');
      return;
    }
    setCategorySaving(true);
    try {
      const res = await apiFetch('/expenses/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: categoryForm.name.trim(),
          accountId: categoryForm.accountId || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCategoryError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setCategoryForm({ name: '', accountId: '' });
      setShowAddCategory(false);
      await loadCategories();
    } catch {
      setCategoryError('Could not reach the server.');
    } finally {
      setCategorySaving(false);
    }
  }

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    setExpenseError(null);

    const amount = Number(expenseForm.amount);
    if (!expenseForm.categoryId) {
      setExpenseError('Choose a category.');
      return;
    }
    if (!amount || amount <= 0) {
      setExpenseError('Enter an amount greater than zero.');
      return;
    }

    setExpenseSaving(true);
    try {
      const res = await apiFetch('/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: expenseForm.categoryId,
          description: expenseForm.description.trim() || undefined,
          amount,
          expenseDate: expenseForm.expenseDate,
          dueDate: expenseForm.dueDate || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setExpenseError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setExpenseForm({ categoryId: '', description: '', amount: '', expenseDate: todayISO(), dueDate: '' });
      setShowAddExpense(false);
      setPage(1);
      await loadExpenses();
    } catch {
      setExpenseError('Could not reach the server.');
    } finally {
      setExpenseSaving(false);
    }
  }

  function openEditExpense(exp: Expense) {
    setEditingExpenseId(exp.id);
    setEditExpenseError(null);
    setEditExpenseForm({ description: exp.description ?? '', dueDate: exp.dueDate ? exp.dueDate.slice(0, 10) : '' });
  }

  async function handleSaveExpenseEdit(id: string) {
    setEditExpenseError(null);
    setEditExpenseSaving(true);
    try {
      const res = await apiFetch(`/expenses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editExpenseForm.description.trim() || undefined,
          dueDate: editExpenseForm.dueDate || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setEditExpenseError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setEditingExpenseId(null);
      await loadExpenses();
    } catch {
      setEditExpenseError('Could not reach the server.');
    } finally {
      setEditExpenseSaving(false);
    }
  }

  // Void, not delete-with-no-trace — this reverses the journal entry
  // ExpensesService.create() posted, then removes the row. Only available
  // while UNPAID, same restriction the backend enforces: a paid expense
  // has real cash movement behind it and needs a manual adjusting entry
  // instead, not a takeback.
  async function handleVoidExpense(exp: Expense) {
    if (!confirm(`Void this ${exp.category.name} expense? This reverses its ledger entry and removes it.`)) return;
    setVoidingId(exp.id);
    setError(null);
    try {
      const res = await apiFetch(`/expenses/${exp.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      await loadExpenses();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setVoidingId(null);
    }
  }

  function openEditCategory(cat: ExpenseCategory) {
    setEditingCategoryId(cat.id);
    setEditCategoryError(null);
    setEditCategoryForm({ name: cat.name, accountId: cat.accountId ?? '' });
  }

  async function handleSaveCategoryEdit(id: string) {
    setEditCategoryError(null);
    if (!editCategoryForm.name.trim()) {
      setEditCategoryError('Name is required.');
      return;
    }
    setEditCategorySaving(true);
    try {
      const res = await apiFetch(`/expenses/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editCategoryForm.name.trim(),
          accountId: editCategoryForm.accountId || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setEditCategoryError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setEditingCategoryId(null);
      await loadCategories();
    } catch {
      setEditCategoryError('Could not reach the server.');
    } finally {
      setEditCategorySaving(false);
    }
  }

  function openPayForm(id: string) {
    setPayingId(id);
    setPayError(null);
    setPayForm({ paymentMethod: 'CASH', bankAccountId: '', paidAt: todayISO() });
    loadBankAccounts();
  }

  async function handleMarkPaid(e: React.FormEvent) {
    e.preventDefault();
    if (!payingId) return;
    setPayError(null);

    if (payForm.paymentMethod !== 'CASH' && !payForm.bankAccountId) {
      setPayError('Choose which bank account this was paid from.');
      return;
    }

    setPaySaving(true);
    try {
      const res = await apiFetch(`/expenses/${payingId}/mark-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: payForm.paymentMethod,
          paidAt: payForm.paidAt || undefined,
          bankAccountId: payForm.paymentMethod === 'CASH' ? undefined : payForm.bankAccountId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setPayError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setPayingId(null);
      await loadExpenses();
    } catch {
      setPayError('Could not reach the server.');
    } finally {
      setPaySaving(false);
    }
  }

  const hasCategories = (categories?.length ?? 0) > 0;

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
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => router.push('/accounting')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Receipt size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>Expenses</h1>
              <p className="text-xs text-gray-500 truncate">Rent, electricity, and every other operating cost</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>
        )}

        {/* Categories — collapsible; the empty-category case is the real
            onboarding moment here, same spirit as the COA setup page. */}
        <div className="border-2 border-gray-300 rounded-md bg-white mb-5 overflow-hidden">
          <button
            onClick={() => setShowAddCategory((s) => !s)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Tag size={14} strokeWidth={2} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">
                {categories === null ? 'Categories' : `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`}
              </span>
            </div>
            {showAddCategory ? <X size={16} strokeWidth={2} className="text-gray-400" /> : <Plus size={16} strokeWidth={2} className="text-blue-600" />}
          </button>

          {hasCategories && (
            <div className="border-t border-gray-100">
              {(categories ?? []).map((cat) => (
                <div key={cat.id} className="border-b border-gray-50 last:border-b-0">
                  <div className="px-4 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm text-gray-700 truncate">{cat.name}</span>
                      {cat.account && <span className="text-xs text-gray-400 ml-2">{cat.account.code} {cat.account.name}</span>}
                    </div>
                    <button
                      onClick={() => (editingCategoryId === cat.id ? setEditingCategoryId(null) : openEditCategory(cat))}
                      className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 shrink-0"
                    >
                      {editingCategoryId === cat.id ? 'Cancel' : 'Edit'}
                    </button>
                  </div>
                  {editingCategoryId === cat.id && (
                    <div className="px-4 pb-3 flex flex-col gap-2 bg-gray-50/60">
                      {editCategoryError && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{editCategoryError}</p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editCategoryForm.name}
                          onChange={(e) => setEditCategoryForm((f) => ({ ...f, name: e.target.value }))}
                          className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                        />
                        <select
                          value={editCategoryForm.accountId}
                          onChange={(e) => setEditCategoryForm((f) => ({ ...f, accountId: e.target.value }))}
                          className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                        >
                          <option value="">Uncategorized Expense (default)</option>
                          {expenseAccounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                          ))}
                        </select>
                      </div>
                      <button
                        onClick={() => handleSaveCategoryEdit(cat.id)}
                        disabled={editCategorySaving}
                        className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
                      >
                        {editCategorySaving && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
                        Save
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!hasCategories && !showAddCategory && (
            <p className="px-4 pb-3 text-xs text-amber-700 bg-amber-50 -mt-1">
              No categories yet — add one (e.g. &quot;Electricity&quot;, &quot;Rent&quot;) before recording an expense.
            </p>
          )}

          {showAddCategory && (
            <form onSubmit={handleAddCategory} className="px-4 pb-4 flex flex-col gap-3 border-t border-gray-100 pt-3">
              {categoryError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{categoryError}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-600">Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Electricity"
                    value={categoryForm.name}
                    onChange={(e) => setCategoryForm((f) => ({ ...f, name: e.target.value }))}
                    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-600">GL account (optional)</label>
                  <select
                    value={categoryForm.accountId}
                    onChange={(e) => setCategoryForm((f) => ({ ...f, accountId: e.target.value }))}
                    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="">Uncategorized Expense (default)</option>
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                disabled={categorySaving}
                className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {categorySaving && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
                {categorySaving ? 'Adding...' : 'Add category'}
              </button>
            </form>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
          >
            <option value="">All statuses</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PAID">Paid</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
          >
            <option value="">All categories</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <button
            onClick={() => setShowAddExpense((s) => !s)}
            disabled={!hasCategories}
            className="sm:ml-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {showAddExpense ? <X size={15} strokeWidth={2} /> : <Plus size={15} strokeWidth={2} />}
            {showAddExpense ? 'Cancel' : 'New expense'}
          </button>
        </div>

        {/* Add expense form */}
        {showAddExpense && (
          <form
            onSubmit={handleAddExpense}
            className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3"
          >
            {expenseError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{expenseError}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Category</label>
                <select
                  value={expenseForm.categoryId}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, categoryId: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                >
                  <option value="">Choose...</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Amount (Rp)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Description (optional)</label>
              <input
                type="text"
                placeholder="e.g. PLN bill — September"
                value={expenseForm.description}
                onChange={(e) => setExpenseForm((f) => ({ ...f, description: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                  <Calendar size={11} strokeWidth={2} /> Expense date
                </label>
                <input
                  type="date"
                  value={expenseForm.expenseDate}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, expenseDate: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Due date (optional)</label>
                <input
                  type="date"
                  value={expenseForm.dueDate}
                  onChange={(e) => setExpenseForm((f) => ({ ...f, dueDate: e.target.value }))}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={expenseSaving}
              className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {expenseSaving && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
              {expenseSaving ? 'Recording...' : 'Record expense'}
            </button>
          </form>
        )}

        {/* List */}
        {loading && <p className="text-sm text-gray-500">Loading expenses...</p>}

        {!loading && expenses && expenses.data.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No expenses recorded yet.</p>
        )}

        {!loading && expenses && expenses.data.length > 0 && (
          <>
            <div className="flex flex-col gap-2">
              {expenses.data.map((exp) => {
                const meta = STATUS_META[exp.status];
                const StatusIcon = meta.icon;
                const isPaying = payingId === exp.id;
                const isEditingExpense = editingExpenseId === exp.id;

                return (
                  <div key={exp.id} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
                    <div className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate">{exp.category.name}</span>
                          <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 flex items-center gap-1 shrink-0 ${meta.color}`}>
                            <StatusIcon size={10} strokeWidth={2} />
                            {meta.label}
                          </span>
                        </div>
                        {exp.description && <p className="text-xs text-gray-500 truncate mt-0.5">{exp.description}</p>}
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {new Date(exp.expenseDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                          {exp.dueDate && ` · due ${new Date(exp.dueDate).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold">{formatIDR(Number(exp.amount))}</p>
                        <div className="flex items-center gap-2.5 mt-1 justify-end">
                          {exp.status === 'UNPAID' && (
                            <button
                              onClick={() => (isEditingExpense ? setEditingExpenseId(null) : openEditExpense(exp))}
                              className="text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                            >
                              {isEditingExpense ? 'Cancel' : 'Edit'}
                            </button>
                          )}
                          {exp.status === 'UNPAID' && !isPaying && (
                            <button
                              onClick={() => openPayForm(exp.id)}
                              className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1"
                            >
                              <Wallet size={11} strokeWidth={2} />
                              Mark paid
                            </button>
                          )}
                          {exp.status === 'UNPAID' && (
                            <button
                              onClick={() => handleVoidExpense(exp)}
                              disabled={voidingId === exp.id}
                              className="text-[11px] font-semibold text-gray-400 hover:text-red-600 disabled:opacity-50"
                            >
                              {voidingId === exp.id ? '...' : 'Void'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {isEditingExpense && (
                      <div className="px-3 pb-3 pt-2 border-t border-gray-100 bg-gray-50/60 flex flex-col gap-2.5">
                        {editExpenseError && (
                          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{editExpenseError}</p>
                        )}
                        <div className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-gray-600">Description</label>
                          <input
                            type="text"
                            value={editExpenseForm.description}
                            onChange={(e) => setEditExpenseForm((f) => ({ ...f, description: e.target.value }))}
                            className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                          />
                        </div>
                        <div className="flex flex-col gap-1 w-full sm:w-1/2">
                          <label className="text-[11px] font-semibold text-gray-600">Due date</label>
                          <input
                            type="date"
                            value={editExpenseForm.dueDate}
                            onChange={(e) => setEditExpenseForm((f) => ({ ...f, dueDate: e.target.value }))}
                            className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                          />
                        </div>
                        <p className="text-[10px] text-gray-400">
                          Amount, category, and expense date can&apos;t be edited once recorded — they drove what&apos;s already posted to the ledger. Void and re-record instead.
                        </p>
                        <button
                          onClick={() => handleSaveExpenseEdit(exp.id)}
                          disabled={editExpenseSaving}
                          className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
                        >
                          {editExpenseSaving && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
                          Save
                        </button>
                      </div>
                    )}

                    {isPaying && (
                      <form
                        onSubmit={handleMarkPaid}
                        className="px-3 pb-3 pt-2 border-t border-gray-100 bg-gray-50/60 flex flex-col gap-2.5"
                      >
                        {payError && (
                          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{payError}</p>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">Method</label>
                            <select
                              value={payForm.paymentMethod}
                              onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value, bankAccountId: '' }))}
                              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                            >
                              <option value="CASH">Cash</option>
                              <option value="TRANSFER">Transfer</option>
                              <option value="QRIS">QRIS</option>
                              <option value="OTHER">Other</option>
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">Paid on</label>
                            <input
                              type="date"
                              value={payForm.paidAt}
                              onChange={(e) => setPayForm((f) => ({ ...f, paidAt: e.target.value }))}
                              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                            />
                          </div>
                        </div>

                        {payForm.paymentMethod !== 'CASH' && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">Bank account</label>
                            {bankAccounts === null ? (
                              <p className="text-xs text-gray-400">Loading bank accounts...</p>
                            ) : bankAccounts.length === 0 ? (
                              <p className="text-xs text-amber-700">No bank accounts set up yet.</p>
                            ) : (
                              <select
                                value={payForm.bankAccountId}
                                onChange={(e) => setPayForm((f) => ({ ...f, bankAccountId: e.target.value }))}
                                className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                              >
                                <option value="">Choose...</option>
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
                            {paySaving ? 'Saving...' : 'Confirm payment'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayingId(null)}
                            className="text-xs font-semibold text-gray-500 hover:text-gray-700 px-2"
                          >
                            Cancel
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
                page={expenses.page}
                pageSize={expenses.pageSize}
                totalItems={expenses.total}
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