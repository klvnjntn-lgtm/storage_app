// app/accounting/payroll/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import {
  ArrowLeft,
  Users,
  Plus,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
  Wallet,
  Trash2,
  Send,
  SlidersHorizontal,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type Employee = {
  id: string;
  name: string;
  position: string | null;
  baseSalary: string | number;
  isActive: boolean;
  salaryComponents?: { componentId: string; amount: string | number | null; percentage: string | number | null; component: SalaryComponent }[];
};

type SalaryComponent = {
  id: string;
  name: string;
  type: 'ALLOWANCE' | 'DEDUCTION';
  isFixed: boolean;
  defaultAmount: string | number | null;
  defaultPercentage: string | number | null;
  accountId: string | null;
  account?: { code: string; name: string } | null;
};

type PayrollRun = {
  id: string;
  periodMonth: number;
  periodYear: number;
  payType: 'MONTHLY' | 'WEEKLY';
  documentDate: string;
  status: 'DRAFT' | 'POSTED' | 'PAID';
  _count?: { items: number };
  items?: {
    id: string;
    employee: { name: string };
    baseSalary: string | number;
    grossPay: string | number;
    totalDeductions: string | number;
    netPay: string | number;
  }[];
};

type Account = { id: string; code: string; name: string; type: string };
type BankAccount = { id: string; bankName: string; accountNumber: string; archivedAt: string | null };

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_COLOR: Record<PayrollRun['status'], string> = {
  DRAFT: 'text-gray-600 bg-gray-100 border-gray-200',
  POSTED: 'text-blue-700 bg-blue-50 border-blue-200',
  PAID: 'text-green-700 bg-green-50 border-green-200',
};

type Tab = 'employees' | 'components' | 'runs';

export default function PayrollPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('runs');

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
          <div className="flex items-center gap-2.5 mb-4">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Users size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>Payroll</h1>
              <p className="text-xs text-gray-500 truncate">Employees, salary components, and payroll runs</p>
            </div>
          </div>

          <div className="flex gap-1.5">
            {([['runs', 'Runs'], ['employees', 'Employees'], ['components', 'Components']] as [Tab, string][]).map(
              ([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                    tab === key ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-blue-50'
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        {tab === 'runs' && <RunsTab />}
        {tab === 'employees' && <EmployeesTab />}
        {tab === 'components' && <ComponentsTab />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- Runs ----

function RunsTab() {
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayrollRun | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const now = new Date();
  const [form, setForm] = useState({
    periodMonth: now.getMonth() + 1,
    periodYear: now.getFullYear(),
    payType: 'MONTHLY' as 'MONTHLY' | 'WEEKLY',
    documentDate: todayISO(),
    employeeIds: [] as string[], // empty = all active employees
  });

  const [payingId, setPayingId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ paymentMethod: 'TRANSFER', bankAccountId: '', paidAt: todayISO() });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  async function loadRuns() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/payroll/runs');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setRuns(await res.json());
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployeesForForm() {
    const res = await apiFetch('/payroll/employees');
    if (res.ok) setEmployees((await res.json()).filter((e: Employee) => e.isActive));
  }

  async function loadBankAccounts() {
    if (bankAccounts !== null) return;
    const res = await apiFetch('/organizations/bank-accounts');
    if (res.ok) {
      const data: BankAccount[] = await res.json();
      setBankAccounts(data.filter((b) => !b.archivedAt));
    }
  }

  useEffect(() => {
    loadRuns();
    loadEmployeesForForm();
  }, []);

  async function toggleExpand(run: PayrollRun) {
    if (expandedId === run.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(run.id);
    const res = await apiFetch(`/payroll/runs/${run.id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSaving(true);
    try {
      const res = await apiFetch('/payroll/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodMonth: form.periodMonth,
          periodYear: form.periodYear,
          payType: form.payType,
          documentDate: form.documentDate,
          employeeIds: form.employeeIds.length > 0 ? form.employeeIds : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCreateError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setShowCreate(false);
      setForm((f) => ({ ...f, employeeIds: [] }));
      await loadRuns();
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setCreateSaving(false);
    }
  }

  async function handlePost(id: string) {
    setActionError(null);
    setActingId(id);
    try {
      const res = await apiFetch(`/payroll/runs/${id}/post`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      await loadRuns();
      if (expandedId === id) {
        const detailRes = await apiFetch(`/payroll/runs/${id}`);
        if (detailRes.ok) setDetail(await detailRes.json());
      }
    } catch {
      setActionError('Could not reach the server.');
    } finally {
      setActingId(null);
    }
  }

  async function handleDelete(id: string) {
    setActionError(null);
    setActingId(id);
    try {
      const res = await apiFetch(`/payroll/runs/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      if (expandedId === id) setExpandedId(null);
      await loadRuns();
    } catch {
      setActionError('Could not reach the server.');
    } finally {
      setActingId(null);
    }
  }

  function openPayForm(id: string) {
    setPayingId(id);
    setPayError(null);
    setPayForm({ paymentMethod: 'TRANSFER', bankAccountId: '', paidAt: todayISO() });
    loadBankAccounts();
  }

  async function handleMarkPaid(e: React.FormEvent) {
    e.preventDefault();
    if (!payingId) return;
    setPayError(null);
    if (payForm.paymentMethod !== 'CASH' && !payForm.bankAccountId) {
      setPayError('Choose which bank account this was disbursed from.');
      return;
    }
    setPaySaving(true);
    try {
      const res = await apiFetch(`/payroll/runs/${payingId}/mark-paid`, {
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
      await loadRuns();
    } catch {
      setPayError('Could not reach the server.');
    } finally {
      setPaySaving(false);
    }
  }

  function toggleEmployeeInForm(id: string) {
    setForm((f) => ({
      ...f,
      employeeIds: f.employeeIds.includes(id) ? f.employeeIds.filter((x) => x !== id) : [...f.employeeIds, id],
    }));
  }

  return (
    <>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}
      {actionError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{actionError}</p>}

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          {showCreate ? <X size={15} strokeWidth={2} /> : <Plus size={15} strokeWidth={2} />}
          {showCreate ? 'Cancel' : 'New payroll run'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3">
          {createError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{createError}</p>}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Month</label>
              <select
                value={form.periodMonth}
                onChange={(e) => setForm((f) => ({ ...f, periodMonth: Number(e.target.value) }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Year</label>
              <input
                type="number"
                value={form.periodYear}
                onChange={(e) => setForm((f) => ({ ...f, periodYear: Number(e.target.value) }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Pay type</label>
              <select
                value={form.payType}
                onChange={(e) => setForm((f) => ({ ...f, payType: e.target.value as 'MONTHLY' | 'WEEKLY' }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              >
                <option value="MONTHLY">Monthly</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Document date</label>
            <input
              type="date"
              value={form.documentDate}
              onChange={(e) => setForm((f) => ({ ...f, documentDate: e.target.value }))}
              className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white w-full sm:w-1/3"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-600">
              Employees ({form.employeeIds.length === 0 ? 'all active' : `${form.employeeIds.length} selected`})
            </label>
            <div className="border-2 border-gray-300 rounded-md bg-white max-h-40 overflow-y-auto">
              {employees === null ? (
                <p className="text-xs text-gray-400 p-3">Loading...</p>
              ) : employees.length === 0 ? (
                <p className="text-xs text-amber-700 p-3">No active employees yet — add one in the Employees tab first.</p>
              ) : (
                employees.map((emp) => (
                  <label key={emp.id} className="flex items-center gap-2 px-3 py-2 text-sm border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={form.employeeIds.includes(emp.id)}
                      onChange={() => toggleEmployeeInForm(emp.id)}
                      className="accent-blue-600"
                    />
                    {emp.name}
                    {emp.position && <span className="text-xs text-gray-400">— {emp.position}</span>}
                  </label>
                ))
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={createSaving || !employees || employees.length === 0}
            className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {createSaving && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
            {createSaving ? 'Creating...' : 'Create draft run'}
          </button>
        </form>
      )}

      {loading && <p className="text-sm text-gray-500">Loading payroll runs...</p>}

      {!loading && runs && runs.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No payroll runs yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {(runs ?? []).map((run) => {
          const isExpanded = expandedId === run.id;
          const isPaying = payingId === run.id;
          const isActing = actingId === run.id;

          return (
            <div key={run.id} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
              <button
                onClick={() => toggleExpand(run)}
                className="w-full flex items-center justify-between gap-3 p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${STATUS_COLOR[run.status]}`}>
                    {run.status}
                  </span>
                  <span className="text-sm font-semibold">
                    {MONTH_NAMES[run.periodMonth - 1]} {run.periodYear}
                  </span>
                  <span className="text-xs text-gray-400">{run.payType.toLowerCase()}</span>
                  {run._count && <span className="text-xs text-gray-400">· {run._count.items} employee{run._count.items === 1 ? '' : 's'}</span>}
                </div>
                {isExpanded ? <ChevronUp size={16} strokeWidth={2} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} strokeWidth={2} className="text-gray-400 shrink-0" />}
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-3 py-3">
                  {!detail || detail.id !== run.id ? (
                    <p className="text-xs text-gray-400">Loading...</p>
                  ) : (
                    <>
                      <div className="flex flex-col gap-1.5 mb-3">
                        {(detail.items ?? []).map((item) => (
                          <div key={item.id} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50 last:border-b-0">
                            <span className="text-gray-700">{item.employee.name}</span>
                            <div className="flex items-center gap-3 text-right">
                              <span className="text-gray-400">gross {formatIDR(Number(item.grossPay))}</span>
                              <span className="text-gray-400">−{formatIDR(Number(item.totalDeductions))}</span>
                              <span className="font-semibold text-gray-800 w-24">{formatIDR(Number(item.netPay))}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {run.status === 'DRAFT' && (
                          <>
                            <button
                              onClick={() => handlePost(run.id)}
                              disabled={isActing}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
                            >
                              {isActing ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : <Send size={12} strokeWidth={2} />}
                              Post
                            </button>
                            <button
                              onClick={() => handleDelete(run.id)}
                              disabled={isActing}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 disabled:opacity-60 transition-colors"
                            >
                              <Trash2 size={12} strokeWidth={2} />
                              Delete
                            </button>
                          </>
                        )}
                        {run.status === 'POSTED' && !isPaying && (
                          <button
                            onClick={() => openPayForm(run.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                          >
                            <Wallet size={12} strokeWidth={2} />
                            Mark paid
                          </button>
                        )}
                      </div>

                      {isPaying && (
                        <form onSubmit={handleMarkPaid} className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-2.5">
                          {payError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{payError}</p>}
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] font-semibold text-gray-600">Method</label>
                              <select
                                value={payForm.paymentMethod}
                                onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value, bankAccountId: '' }))}
                                className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                              >
                                <option value="TRANSFER">Transfer</option>
                                <option value="CASH">Cash</option>
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
                                <p className="text-xs text-gray-400">Loading...</p>
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
                              Confirm disbursement
                            </button>
                            <button type="button" onClick={() => setPayingId(null)} className="text-xs font-semibold text-gray-500 px-2">
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ----------------------------------------------------------- Employees ----

function EmployeesTab() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [components, setComponents] = useState<SalaryComponent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', position: '', baseSalary: '' });

  const [managingId, setManagingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, { checked: boolean; amount: string; percentage: string }>>({});
  const [compSaving, setCompSaving] = useState(false);
  const [compError, setCompError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', position: '', baseSalary: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  async function loadEmployees() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/payroll/employees');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setEmployees(await res.json());
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  async function loadComponents() {
    const res = await apiFetch('/payroll/components');
    if (res.ok) setComponents(await res.json());
  }

  useEffect(() => {
    loadEmployees();
    loadComponents();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const baseSalary = Number(form.baseSalary);
    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (!baseSalary || baseSalary <= 0) {
      setFormError('Enter a base salary greater than zero.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/payroll/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), position: form.position.trim() || undefined, baseSalary }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setFormError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setForm({ name: '', position: '', baseSalary: '' });
      setShowAdd(false);
      await loadEmployees();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(emp: Employee) {
    setManagingId(null); // components panel and edit form are mutually exclusive per row
    setEditingId(emp.id);
    setEditError(null);
    setEditForm({ name: emp.name, position: emp.position ?? '', baseSalary: String(emp.baseSalary) });
  }

  async function handleSaveEdit(empId: string) {
    setEditError(null);
    const baseSalary = Number(editForm.baseSalary);
    if (!editForm.name.trim()) {
      setEditError('Name is required.');
      return;
    }
    if (!baseSalary || baseSalary <= 0) {
      setEditError('Enter a base salary greater than zero.');
      return;
    }
    setEditSaving(true);
    try {
      const res = await apiFetch(`/payroll/employees/${empId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          position: editForm.position.trim() || undefined,
          baseSalary,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setEditError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setEditingId(null);
      await loadEmployees();
    } catch {
      setEditError('Could not reach the server.');
    } finally {
      setEditSaving(false);
    }
  }

  // Archives rather than deletes — matches the backend, which soft-deletes
  // (archivedAt + isActive: false) rather than removing the row, since
  // historical PayrollItem rows still reference this employee and must
  // keep displaying their name correctly.
  async function handleArchive(emp: Employee) {
    if (!confirm(`Archive ${emp.name}? They'll no longer appear as an option for new payroll runs.`)) return;
    setArchivingId(emp.id);
    setError(null);
    try {
      const res = await apiFetch(`/payroll/employees/${emp.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      await loadEmployees();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setArchivingId(null);
    }
  }

  async function openManage(emp: Employee) {
    setEditingId(null); // mutually exclusive with edit form, see openEdit
    if (managingId === emp.id) {
      setManagingId(null);
      return;
    }
    setManagingId(emp.id);
    setCompError(null);
    const res = await apiFetch(`/payroll/employees/${emp.id}`);
    const full: Employee = res.ok ? await res.json() : emp;
    const initial: Record<string, { checked: boolean; amount: string; percentage: string }> = {};
    for (const c of components ?? []) {
      const existing = full.salaryComponents?.find((sc) => sc.componentId === c.id);
      initial[c.id] = {
        checked: !!existing,
        amount: existing?.amount != null ? String(existing.amount) : '',
        percentage: existing?.percentage != null ? String(existing.percentage) : '',
      };
    }
    setSelected(initial);
  }

  async function handleSaveComponents(empId: string) {
    setCompError(null);
    setCompSaving(true);
    try {
      const payload = Object.entries(selected)
        .filter(([, v]) => v.checked)
        .map(([componentId, v]) => ({
          componentId,
          amount: v.amount ? Number(v.amount) : undefined,
          percentage: v.percentage ? Number(v.percentage) : undefined,
        }));
      const res = await apiFetch(`/payroll/employees/${empId}/components`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components: payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCompError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setManagingId(null);
    } catch {
      setCompError('Could not reach the server.');
    } finally {
      setCompSaving(false);
    }
  }

  return (
    <>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          {showAdd ? <X size={15} strokeWidth={2} /> : <Plus size={15} strokeWidth={2} />}
          {showAdd ? 'Cancel' : 'New employee'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3">
          {formError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Position (optional)</label>
              <input
                type="text"
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 w-full sm:w-1/2">
            <label className="text-xs font-semibold text-gray-600">Base salary (Rp / month)</label>
            <input
              type="number"
              min="0"
              value={form.baseSalary}
              onChange={(e) => setForm((f) => ({ ...f, baseSalary: e.target.value }))}
              className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
            {saving ? 'Adding...' : 'Add employee'}
          </button>
        </form>
      )}

      {loading && <p className="text-sm text-gray-500">Loading employees...</p>}
      {!loading && employees && employees.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No employees yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {(employees ?? []).map((emp) => (
          <div key={emp.id} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
            <div className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${!emp.isActive ? 'text-gray-400 line-through' : ''}`}>{emp.name}</p>
                <p className="text-xs text-gray-400">{emp.position ?? 'No position set'}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold">{formatIDR(Number(emp.baseSalary))}</p>
                <div className="flex items-center gap-2.5 mt-1 justify-end">
                  <button
                    onClick={() => openEdit(emp)}
                    className="text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => openManage(emp)}
                    className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1"
                  >
                    <SlidersHorizontal size={11} strokeWidth={2} />
                    Components
                  </button>
                  {emp.isActive && (
                    <button
                      onClick={() => handleArchive(emp)}
                      disabled={archivingId === emp.id}
                      className="text-[11px] font-semibold text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      {archivingId === emp.id ? '...' : 'Archive'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {editingId === emp.id && (
              <div className="px-3 pb-3 pt-2 border-t border-gray-100 bg-gray-50/60 flex flex-col gap-2.5">
                {editError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{editError}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-gray-600">Name</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-gray-600">Position</label>
                    <input
                      type="text"
                      value={editForm.position}
                      onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1 w-full sm:w-1/2">
                  <label className="text-[11px] font-semibold text-gray-600">Base salary (Rp)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.baseSalary}
                    onChange={(e) => setEditForm((f) => ({ ...f, baseSalary: e.target.value }))}
                    className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSaveEdit(emp.id)}
                    disabled={editSaving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
                  >
                    {editSaving && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-gray-500 px-2">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {managingId === emp.id && (
              <div className="px-3 pb-3 pt-2 border-t border-gray-100 bg-gray-50/60">
                {compError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2 mb-2">{compError}</p>}
                {!components || components.length === 0 ? (
                  <p className="text-xs text-amber-700">No salary components defined yet — add some in the Components tab.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {components.map((c) => {
                      const state = selected[c.id] ?? { checked: false, amount: '', percentage: '' };
                      return (
                        <div key={c.id} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={state.checked}
                            onChange={(e) =>
                              setSelected((s) => ({ ...s, [c.id]: { ...state, checked: e.target.checked } }))
                            }
                            className="accent-blue-600 shrink-0"
                          />
                          <span className="flex-1 min-w-0 truncate">
                            {c.name} <span className="text-gray-400">({c.type.toLowerCase()})</span>
                          </span>
                          {state.checked && (
                            <input
                              type="number"
                              placeholder={c.isFixed ? `default ${c.defaultAmount ?? 0}` : `default ${c.defaultPercentage ?? 0}%`}
                              value={c.isFixed ? state.amount : state.percentage}
                              onChange={(e) =>
                                setSelected((s) => ({
                                  ...s,
                                  [c.id]: c.isFixed
                                    ? { ...state, amount: e.target.value }
                                    : { ...state, percentage: e.target.value },
                                }))
                              }
                              className="w-28 border-2 border-gray-300 rounded-md p-1 text-xs outline-none focus:border-blue-500 bg-white shrink-0"
                            />
                          )}
                        </div>
                      );
                    })}
                    <button
                      onClick={() => handleSaveComponents(emp.id)}
                      disabled={compSaving}
                      className="self-start mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
                    >
                      {compSaving && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
                      Save components
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------- Components ----

function ComponentsTab() {
  const [components, setComponents] = useState<SalaryComponent[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    type: 'ALLOWANCE' as 'ALLOWANCE' | 'DEDUCTION',
    isFixed: true,
    defaultAmount: '',
    defaultPercentage: '',
    accountId: '',
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    isFixed: true,
    defaultAmount: '',
    defaultPercentage: '',
    accountId: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const liabilityAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.type === 'LIABILITY').sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  async function loadComponents() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/payroll/components');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setComponents(await res.json());
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  async function loadAccounts() {
    const res = await apiFetch('/accounting/accounts');
    if (res.ok) setAccounts(await res.json());
  }

  useEffect(() => {
    loadComponents();
    loadAccounts();
  }, []);

  function openEdit(c: SalaryComponent) {
    setEditingId(c.id);
    setEditError(null);
    setEditForm({
      name: c.name,
      isFixed: c.isFixed,
      defaultAmount: c.defaultAmount != null ? String(c.defaultAmount) : '',
      defaultPercentage: c.defaultPercentage != null ? String(c.defaultPercentage) : '',
      accountId: c.accountId ?? '',
    });
  }

  async function handleSaveEdit(id: string) {
    setEditError(null);
    if (!editForm.name.trim()) {
      setEditError('Name is required.');
      return;
    }
    if (editForm.isFixed && !editForm.defaultAmount) {
      setEditError('Enter a default amount for a fixed component.');
      return;
    }
    if (!editForm.isFixed && !editForm.defaultPercentage) {
      setEditError('Enter a default percentage for a percentage-based component.');
      return;
    }
    setEditSaving(true);
    try {
      const res = await apiFetch(`/payroll/components/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          isFixed: editForm.isFixed,
          defaultAmount: editForm.isFixed ? Number(editForm.defaultAmount) : undefined,
          defaultPercentage: !editForm.isFixed ? Number(editForm.defaultPercentage) : undefined,
          accountId: editForm.accountId || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setEditError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setEditingId(null);
      await loadComponents();
    } catch {
      setEditError('Could not reach the server.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (form.isFixed && !form.defaultAmount) {
      setFormError('Enter a default amount for a fixed component.');
      return;
    }
    if (!form.isFixed && !form.defaultPercentage) {
      setFormError('Enter a default percentage for a percentage-based component.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/payroll/components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          isFixed: form.isFixed,
          defaultAmount: form.isFixed ? Number(form.defaultAmount) : undefined,
          defaultPercentage: !form.isFixed ? Number(form.defaultPercentage) : undefined,
          accountId: form.type === 'DEDUCTION' && form.accountId ? form.accountId : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setFormError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      setForm({ name: '', type: 'ALLOWANCE', isFixed: true, defaultAmount: '', defaultPercentage: '', accountId: '' });
      setShowAdd(false);
      await loadComponents();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>}

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          {showAdd ? <X size={15} strokeWidth={2} /> : <Plus size={15} strokeWidth={2} />}
          {showAdd ? 'Cancel' : 'New component'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3">
          {formError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Name</label>
              <input
                type="text"
                placeholder="e.g. BPJS Kesehatan"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'ALLOWANCE' | 'DEDUCTION', accountId: '' }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              >
                <option value="ALLOWANCE">Allowance</option>
                <option value="DEDUCTION">Deduction</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <input
                type="radio"
                checked={form.isFixed}
                onChange={() => setForm((f) => ({ ...f, isFixed: true }))}
                className="accent-blue-600"
              />
              Fixed amount
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <input
                type="radio"
                checked={!form.isFixed}
                onChange={() => setForm((f) => ({ ...f, isFixed: false }))}
                className="accent-blue-600"
              />
              % of base salary
            </label>
          </div>

          {form.isFixed ? (
            <div className="flex flex-col gap-1 w-full sm:w-1/2">
              <label className="text-xs font-semibold text-gray-600">Default amount (Rp)</label>
              <input
                type="number"
                min="0"
                value={form.defaultAmount}
                onChange={(e) => setForm((f) => ({ ...f, defaultAmount: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1 w-full sm:w-1/2">
              <label className="text-xs font-semibold text-gray-600">Default percentage</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.defaultPercentage}
                onChange={(e) => setForm((f) => ({ ...f, defaultPercentage: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
          )}

          {form.type === 'DEDUCTION' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">Payable account (optional)</label>
              <select
                value={form.accountId}
                onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              >
                <option value="">Payroll Deductions Payable (default)</option>
                {liabilityAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400">
                Route this deduction to its own liability account (e.g. a specific BPJS or PPh21 Payable) instead of the generic default.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
            {saving ? 'Adding...' : 'Add component'}
          </button>
        </form>
      )}

      {loading && <p className="text-sm text-gray-500">Loading components...</p>}
      {!loading && components && components.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No salary components yet.</p>
      )}

      <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
        {(components ?? []).map((c) => (
          <div key={c.id} className="border-b border-gray-100 last:border-b-0">
            <div className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.name}</p>
                <p className="text-xs text-gray-400">
                  {c.type === 'ALLOWANCE' ? 'Allowance' : 'Deduction'} ·{' '}
                  {c.isFixed ? formatIDR(Number(c.defaultAmount ?? 0)) : `${c.defaultPercentage ?? 0}%`}
                  {c.account && ` · ${c.account.code} ${c.account.name}`}
                </p>
              </div>
              <button
                onClick={() => (editingId === c.id ? setEditingId(null) : openEdit(c))}
                className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 shrink-0"
              >
                {editingId === c.id ? 'Cancel' : 'Edit'}
              </button>
            </div>

            {editingId === c.id && (
              <div className="px-4 pb-3 flex flex-col gap-2.5 bg-gray-50/60 pt-1">
                {editError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{editError}</p>}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-gray-600">Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                    <input type="radio" checked={editForm.isFixed} onChange={() => setEditForm((f) => ({ ...f, isFixed: true }))} className="accent-blue-600" />
                    Fixed amount
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                    <input type="radio" checked={!editForm.isFixed} onChange={() => setEditForm((f) => ({ ...f, isFixed: false }))} className="accent-blue-600" />
                    % of base salary
                  </label>
                </div>
                {editForm.isFixed ? (
                  <div className="flex flex-col gap-1 w-full sm:w-1/2">
                    <label className="text-[11px] font-semibold text-gray-600">Default amount (Rp)</label>
                    <input
                      type="number"
                      min="0"
                      value={editForm.defaultAmount}
                      onChange={(e) => setEditForm((f) => ({ ...f, defaultAmount: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 w-full sm:w-1/2">
                    <label className="text-[11px] font-semibold text-gray-600">Default percentage</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={editForm.defaultPercentage}
                      onChange={(e) => setEditForm((f) => ({ ...f, defaultPercentage: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                    />
                  </div>
                )}
                {c.type === 'DEDUCTION' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-gray-600">Payable account</label>
                    <select
                      value={editForm.accountId}
                      onChange={(e) => setEditForm((f) => ({ ...f, accountId: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="">Payroll Deductions Payable (default)</option>
                      {liabilityAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <button
                  onClick={() => handleSaveEdit(c.id)}
                  disabled={editSaving}
                  className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {editSaving && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}