// app/accounting/payroll/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Users, Plus, X, Loader2, ChevronDown, ChevronUp, Wallet, Trash2, Send, SlidersHorizontal, Undo2, Printer } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import Pagination from '@/app/components/shared/Pagination';
import { useLanguage } from '@/app/context/LanguageContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}
// FIX — .toISOString() converts to UTC first, wrong for a ~7-hour window
// after local midnight in a timezone ahead of UTC. Not just a display
// bug: this pre-fills the actual documentDate/paidAt submitted on create.
function todayISO() {
  return toCalendarDateString(new Date());
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
  status: 'DRAFT' | 'POSTED' | 'PAID' | 'VOID';
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
  VOID: 'text-red-700 bg-red-50 border-red-200',
};

const STATUS_LABEL_KEY: Record<PayrollRun['status'], string> = {
  DRAFT: 'accounting.payroll.statusDraft',
  POSTED: 'accounting.payroll.statusPosted',
  PAID: 'accounting.payroll.statusPaid',
  VOID: 'accounting.payroll.statusVoid',
};

type Tab = 'employees' | 'components' | 'runs';

export default function PayrollPage() {
    const { t } = useLanguage();
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
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Users size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>{t('nav.items.payroll')}</h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.payroll.subtitle')}</p>
            </div>
          </div>

          <div className="flex gap-1.5">
            {([['runs', t('accounting.payroll.tabRuns')], ['employees', t('accounting.payroll.tabEmployees')], ['components', t('accounting.payroll.tabComponents')]] as [Tab, string][]).map(
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

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {tab === 'runs' && <RunsTab />}
        {tab === 'employees' && <EmployeesTab />}
        {tab === 'components' && <ComponentsTab />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- Runs ----

function RunsTab() {
  const { t } = useLanguage();
  const router = useRouter();
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // /payroll/runs has no server-side pagination, so this pages the
  // already-fetched list client-side.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const pagedRuns = useMemo(() => (runs ?? []).slice((page - 1) * pageSize, page * pageSize), [runs, page, pageSize]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayrollRun | null>(null);
  // FIX — see toggleExpand() below: a ref so the in-flight fetch can
  // check the LATEST expandedId after it resolves, not the one captured
  // in its own closure.
  const expandedIdRef = useRef<string | null>(null);

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

  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSaving, setVoidSaving] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  async function loadRuns() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/payroll/runs');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setRuns(await res.json());
    } catch {
      setError(t('accounting.payroll.couldNotReachServer'));
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
      expandedIdRef.current = null;
      return;
    }
    setExpandedId(run.id);
    expandedIdRef.current = run.id;
    const res = await apiFetch(`/payroll/runs/${run.id}`);
    // FIX — without this check, expanding run A (slow), collapsing, then
    // expanding run B (resolves first) could let A's late response land
    // after B's and overwrite `detail` with A's data — the render guard
    // elsewhere (detail.id !== run.id) would then see a mismatch and
    // strand the already-correctly-loaded B on "Loading..." forever.
    if (expandedIdRef.current !== run.id) return;
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
        setCreateError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setShowCreate(false);
      setForm((f) => ({ ...f, employeeIds: [] }));
      await loadRuns();
    } catch {
      setCreateError(t('accounting.payroll.couldNotReachServer'));
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
        setActionError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      await loadRuns();
      if (expandedId === id) {
        const detailRes = await apiFetch(`/payroll/runs/${id}`);
        if (detailRes.ok) setDetail(await detailRes.json());
      }
    } catch {
      setActionError(t('accounting.payroll.couldNotReachServer'));
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
        setActionError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      if (expandedId === id) setExpandedId(null);
      await loadRuns();
    } catch {
      setActionError(t('accounting.payroll.couldNotReachServer'));
    } finally {
      setActingId(null);
    }
  }

  function openPayForm(id: string) {
    setVoidingId(null); // mutually exclusive with the void form, see openVoidForm
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
      setPayError(t('accounting.payroll.chooseDisbursementBankAccount'));
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
        setPayError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setPayingId(null);
      await loadRuns();
    } catch {
      setPayError(t('accounting.payroll.couldNotReachServer'));
    } finally {
      setPaySaving(false);
    }
  }

  function openVoidForm(id: string) {
    setPayingId(null); // mutually exclusive with the mark-paid form, see openPayForm
    setVoidingId(id);
    setVoidError(null);
    setVoidReason('');
  }

  async function handleVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!voidingId) return;
    if (!voidReason.trim()) {
      setVoidError(t('accounting.payroll.reasonRequired'));
      return;
    }
    setVoidError(null);
    setVoidSaving(true);
    try {
      const res = await apiFetch(`/payroll/runs/${voidingId}/void`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setVoidError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setVoidingId(null);
      await loadRuns();
      if (expandedId === voidingId) {
        const detailRes = await apiFetch(`/payroll/runs/${voidingId}`);
        if (detailRes.ok) setDetail(await detailRes.json());
      }
    } catch {
      setVoidError(t('accounting.payroll.couldNotReachServer'));
    } finally {
      setVoidSaving(false);
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
          {showCreate ? t('common.cancel') : t('accounting.payroll.newPayrollRun')}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3">
          {createError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{createError}</p>}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.month')}</label>
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
              <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.year')}</label>
              <input
                type="number"
                value={form.periodYear}
                onChange={(e) => setForm((f) => ({ ...f, periodYear: Number(e.target.value) }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.payType')}</label>
              <select
                value={form.payType}
                onChange={(e) => setForm((f) => ({ ...f, payType: e.target.value as 'MONTHLY' | 'WEEKLY' }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              >
                <option value="MONTHLY">{t('accounting.payroll.monthly')}</option>
                <option value="WEEKLY">{t('accounting.payroll.weekly')}</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.documentDate')}</label>
            <input
              type="date"
              value={form.documentDate}
              onChange={(e) => setForm((f) => ({ ...f, documentDate: e.target.value }))}
              className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white w-full sm:w-1/3"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-600">
              {t('accounting.payroll.employeesCountLabel', {
                status: form.employeeIds.length === 0
                  ? t('accounting.payroll.allActive')
                  : t('accounting.payroll.selectedCount', { count: form.employeeIds.length }),
              })}
            </label>
            <div className="border-2 border-gray-300 rounded-md bg-white max-h-40 overflow-y-auto">
              {employees === null ? (
                <p className="text-xs text-gray-400 p-3">{t('common.loading')}</p>
              ) : employees.length === 0 ? (
                <p className="text-xs text-amber-700 p-3">{t('accounting.payroll.noActiveEmployeesYet')}</p>
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
            {createSaving ? t('accounting.payroll.creating') : t('accounting.payroll.createDraftRun')}
          </button>
        </form>
      )}

      {loading && <p className="text-sm text-gray-500">{t('accounting.payroll.loadingRuns')}</p>}

      {!loading && runs && runs.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">{t('accounting.payroll.noRunsYet')}</p>
      )}

      <div className="flex flex-col gap-2">
        {pagedRuns.map((run) => {
          const isExpanded = expandedId === run.id;
          const isPaying = payingId === run.id;
          const isVoiding = voidingId === run.id;
          const isActing = actingId === run.id;

          return (
            <div key={run.id} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
              <button
                onClick={() => toggleExpand(run)}
                className="w-full flex items-center justify-between gap-3 p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 shrink-0 ${STATUS_COLOR[run.status]}`}>
                    {t(STATUS_LABEL_KEY[run.status])}
                  </span>
                  <span className="text-sm font-semibold">
                    {MONTH_NAMES[run.periodMonth - 1]} {run.periodYear}
                  </span>
                  <span className="text-xs text-gray-400">{(run.payType === 'MONTHLY' ? t('accounting.payroll.monthly') : t('accounting.payroll.weekly')).toLowerCase()}</span>
                  {run._count && (
                    <span className="text-xs text-gray-400">
                      ·{' '}
                      {run._count.items === 1
                        ? t('accounting.payroll.employeeCountSingular', { count: run._count.items })
                        : t('accounting.payroll.employeeCountPlural', { count: run._count.items })}
                    </span>
                  )}
                </div>
                {isExpanded ? <ChevronUp size={16} strokeWidth={2} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} strokeWidth={2} className="text-gray-400 shrink-0" />}
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-3 py-3">
                  {!detail || detail.id !== run.id ? (
                    <p className="text-xs text-gray-400">{t('common.loading')}</p>
                  ) : (
                    <>
                      <div className="flex flex-col gap-1.5 mb-3">
                        {(detail.items ?? []).map((item) => (
                          <div key={item.id} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50 last:border-b-0">
                            <span className="text-gray-700">{item.employee.name}</span>
                            <div className="flex items-center gap-3 text-right">
                              <span className="text-gray-400">{t('accounting.payroll.grossAmount', { amount: formatIDR(Number(item.grossPay)) })}</span>
                              <span className="text-gray-400">−{formatIDR(Number(item.totalDeductions))}</span>
                              <span className="font-semibold text-gray-800 w-24">{formatIDR(Number(item.netPay))}</span>
                              {(run.status === 'POSTED' || run.status === 'PAID') && (
                                <button
                                  onClick={() => router.push(`/accounting/payroll/runs/${run.id}/payslip/${item.id}`)}
                                  title={t('accounting.payroll.payslip')}
                                  className="text-gray-400 hover:text-blue-700 shrink-0"
                                >
                                  <Printer size={13} strokeWidth={2} />
                                </button>
                              )}
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
                              {t('accounting.payroll.post')}
                            </button>
                            <button
                              onClick={() => handleDelete(run.id)}
                              disabled={isActing}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 disabled:opacity-60 transition-colors"
                            >
                              <Trash2 size={12} strokeWidth={2} />
                              {t('common.delete')}
                            </button>
                          </>
                        )}
                        {run.status === 'POSTED' && !isPaying && !isVoiding && (
                          <button
                            onClick={() => openPayForm(run.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
                          >
                            <Wallet size={12} strokeWidth={2} />
                            {t('accounting.payroll.markPaid')}
                          </button>
                        )}
                        {(run.status === 'POSTED' || run.status === 'PAID') && !isVoiding && (
                          <button
                            onClick={() => openVoidForm(run.id)}
                            disabled={isActing}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 disabled:opacity-60 transition-colors"
                          >
                            <Undo2 size={12} strokeWidth={2} />
                            {t('accounting.payroll.void')}
                          </button>
                        )}
                      </div>

                      {isVoiding && (
                        <form onSubmit={handleVoid} className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-2.5">
                          {voidError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{voidError}</p>}
                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-gray-600">
                              {t('accounting.payroll.voidReasonLabel')}
                            </label>
                            <input
                              type="text"
                              value={voidReason}
                              onChange={(e) => setVoidReason(e.target.value)}
                              placeholder={t('accounting.payroll.voidReasonPlaceholder')}
                              className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-red-500 bg-white"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              disabled={voidSaving}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-60 transition-colors"
                            >
                              {voidSaving && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
                              {t('accounting.payroll.confirmVoid')}
                            </button>
                            <button type="button" onClick={() => setVoidingId(null)} className="text-xs font-semibold text-gray-500 px-2">
                              {t('common.cancel')}
                            </button>
                          </div>
                        </form>
                      )}

                      {isPaying && (
                        <form onSubmit={handleMarkPaid} className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-2.5">
                          {payError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{payError}</p>}
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] font-semibold text-gray-600">{t('accounting.expenses.method')}</label>
                              <select
                                value={payForm.paymentMethod}
                                onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value, bankAccountId: '' }))}
                                className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                              >
                                <option value="TRANSFER">{t('accounting.expenses.methodTransfer')}</option>
                                <option value="CASH">{t('accounting.expenses.methodCash')}</option>
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
                          {payForm.paymentMethod !== 'CASH' && (
                            <div className="flex flex-col gap-1">
                              <label className="text-[11px] font-semibold text-gray-600">{t('accounting.expenses.bankAccount')}</label>
                              {bankAccounts === null ? (
                                <p className="text-xs text-gray-400">{t('common.loading')}</p>
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
                              {t('accounting.payroll.confirmDisbursement')}
                            </button>
                            <button type="button" onClick={() => setPayingId(null)} className="text-xs font-semibold text-gray-500 px-2">
                              {t('common.cancel')}
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
      {(runs?.length ?? 0) > 0 && (
        <div className="mt-4">
          <Pagination
            page={page}
            pageSize={pageSize}
            totalItems={runs?.length ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------- Employees ----

function EmployeesTab() {
  const { t } = useLanguage();
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [components, setComponents] = useState<SalaryComponent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // /payroll/employees has no server-side pagination, so this pages the
  // already-fetched list client-side.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const pagedEmployees = useMemo(
    () => (employees ?? []).slice((page - 1) * pageSize, page * pageSize),
    [employees, page, pageSize],
  );

  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', position: '', baseSalary: '' });

  const [managingId, setManagingId] = useState<string | null>(null);
  // FIX — see openManage() below: a ref, not state, so the in-flight
  // fetch can check the LATEST managingId (not the one captured in its
  // own closure) after it resolves.
  const managingIdRef = useRef<string | null>(null);
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
        setError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setEmployees(await res.json());
    } catch {
      setError(t('accounting.payroll.couldNotReachServer'));
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
      setFormError(t('accounting.payroll.nameRequired'));
      return;
    }
    if (!baseSalary || baseSalary <= 0) {
      setFormError(t('accounting.payroll.enterBaseSalaryGreaterThanZero'));
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
        setFormError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setForm({ name: '', position: '', baseSalary: '' });
      setShowAdd(false);
      await loadEmployees();
    } catch {
      setFormError(t('accounting.payroll.couldNotReachServer'));
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
      setEditError(t('accounting.payroll.nameRequired'));
      return;
    }
    if (!baseSalary || baseSalary <= 0) {
      setEditError(t('accounting.payroll.enterBaseSalaryGreaterThanZero'));
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
        setEditError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setEditingId(null);
      await loadEmployees();
    } catch {
      setEditError(t('accounting.payroll.couldNotReachServer'));
    } finally {
      setEditSaving(false);
    }
  }

  // Archives rather than deletes — matches the backend, which soft-deletes
  // (archivedAt + isActive: false) rather than removing the row, since
  // historical PayrollItem rows still reference this employee and must
  // keep displaying their name correctly.
  async function handleArchive(emp: Employee) {
    if (!confirm(t('accounting.payroll.archiveConfirm', { name: emp.name }))) return;
    setArchivingId(emp.id);
    setError(null);
    try {
      const res = await apiFetch(`/payroll/employees/${emp.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      await loadEmployees();
    } catch {
      setError(t('accounting.payroll.couldNotReachServer'));
    } finally {
      setArchivingId(null);
    }
  }

  async function openManage(emp: Employee) {
    setEditingId(null); // mutually exclusive with edit form, see openEdit
    if (managingId === emp.id) {
      setManagingId(null);
      managingIdRef.current = null;
      return;
    }
    setManagingId(emp.id);
    managingIdRef.current = emp.id;
    setCompError(null);
    const res = await apiFetch(`/payroll/employees/${emp.id}`);
    const full: Employee = res.ok ? await res.json() : emp;
    // FIX — without this check, closing employee A's panel and opening
    // B's before A's slower fetch resolves let A's response land after
    // B's and silently overwrite `selected` with A's data while the
    // panel still showed B's name — a real risk of saving A's component
    // configuration onto B's employee record. `selected` is a single
    // shared object keyed only by componentId, not by employee, so this
    // is the only thing preventing that.
    if (managingIdRef.current !== emp.id) return;
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
        setCompError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setManagingId(null);
    } catch {
      setCompError(t('accounting.payroll.couldNotReachServer'));
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
          {showAdd ? t('common.cancel') : t('accounting.payroll.newEmployee')}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3">
          {formError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('common.name')}</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.positionOptional')}</label>
              <input
                type="text"
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 w-full sm:w-1/2">
            <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.baseSalaryPerMonth')}</label>
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
            {saving ? t('accounting.payroll.adding') : t('accounting.payroll.addEmployee')}
          </button>
        </form>
      )}

      {loading && <p className="text-sm text-gray-500">{t('accounting.payroll.loadingEmployees')}</p>}
      {!loading && employees && employees.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">{t('accounting.payroll.noEmployeesYet')}</p>
      )}

      <div className="flex flex-col gap-2">
        {pagedEmployees.map((emp) => (
          <div key={emp.id} className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
            <div className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${!emp.isActive ? 'text-gray-400 line-through' : ''}`}>{emp.name}</p>
                <p className="text-xs text-gray-400">{emp.position ?? t('accounting.payroll.noPositionSet')}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold">{formatIDR(Number(emp.baseSalary))}</p>
                <div className="flex items-center gap-2.5 mt-1 justify-end">
                  <button
                    onClick={() => openEdit(emp)}
                    className="text-[11px] font-semibold text-blue-700 hover:text-blue-800"
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    onClick={() => openManage(emp)}
                    className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 flex items-center gap-1"
                  >
                    <SlidersHorizontal size={11} strokeWidth={2} />
                    {t('accounting.payroll.tabComponents')}
                  </button>
                  {emp.isActive && (
                    <button
                      onClick={() => handleArchive(emp)}
                      disabled={archivingId === emp.id}
                      className="text-[11px] font-semibold text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      {archivingId === emp.id ? '...' : t('accounting.payroll.archive')}
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
                    <label className="text-[11px] font-semibold text-gray-600">{t('common.name')}</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-gray-600">{t('accounting.payroll.position')}</label>
                    <input
                      type="text"
                      value={editForm.position}
                      onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1 w-full sm:w-1/2">
                  <label className="text-[11px] font-semibold text-gray-600">{t('accounting.payroll.baseSalaryRp')}</label>
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
                    {t('common.save')}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-gray-500 px-2">
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}

            {managingId === emp.id && (
              <div className="px-3 pb-3 pt-2 border-t border-gray-100 bg-gray-50/60">
                {compError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2 mb-2">{compError}</p>}
                {!components || components.length === 0 ? (
                  <p className="text-xs text-amber-700">{t('accounting.payroll.noComponentsYetHint')}</p>
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
                            {c.name} <span className="text-gray-400">({(c.type === 'ALLOWANCE' ? t('accounting.payroll.allowance') : t('accounting.payroll.deduction')).toLowerCase()})</span>
                          </span>
                          {state.checked && (
                            <input
                              type="number"
                              placeholder={c.isFixed ? t('accounting.payroll.defaultAmountPlaceholder', { amount: c.defaultAmount ?? 0 }) : t('accounting.payroll.defaultPercentagePlaceholder', { percentage: c.defaultPercentage ?? 0 })}
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
                      {t('accounting.payroll.saveComponents')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {(employees?.length ?? 0) > 0 && (
        <div className="mt-4">
          <Pagination
            page={page}
            pageSize={pageSize}
            totalItems={employees?.length ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------- Components ----

function ComponentsTab() {
  const { t } = useLanguage();
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
        setError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setComponents(await res.json());
    } catch {
      setError(t('accounting.payroll.couldNotReachServer'));
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
      setEditError(t('accounting.payroll.nameRequired'));
      return;
    }
    if (editForm.isFixed && !editForm.defaultAmount) {
      setEditError(t('accounting.payroll.enterDefaultAmountFixed'));
      return;
    }
    if (!editForm.isFixed && !editForm.defaultPercentage) {
      setEditError(t('accounting.payroll.enterDefaultPercentage'));
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
        setEditError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setEditingId(null);
      await loadComponents();
    } catch {
      setEditError(t('accounting.payroll.couldNotReachServer'));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError(t('accounting.payroll.nameRequired'));
      return;
    }
    if (form.isFixed && !form.defaultAmount) {
      setFormError(t('accounting.payroll.enterDefaultAmountFixed'));
      return;
    }
    if (!form.isFixed && !form.defaultPercentage) {
      setFormError(t('accounting.payroll.enterDefaultPercentage'));
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
        setFormError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
        return;
      }
      setForm({ name: '', type: 'ALLOWANCE', isFixed: true, defaultAmount: '', defaultPercentage: '', accountId: '' });
      setShowAdd(false);
      await loadComponents();
    } catch {
      setFormError(t('accounting.payroll.couldNotReachServer'));
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
          {showAdd ? t('common.cancel') : t('accounting.payroll.newComponent')}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="border-2 border-blue-500/30 rounded-md bg-blue-50/40 p-4 mb-5 flex flex-col gap-3">
          {formError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('common.name')}</label>
              <input
                type="text"
                placeholder={t('accounting.payroll.componentNamePlaceholder')}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.type')}</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'ALLOWANCE' | 'DEDUCTION', accountId: '' }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              >
                <option value="ALLOWANCE">{t('accounting.payroll.allowance')}</option>
                <option value="DEDUCTION">{t('accounting.payroll.deduction')}</option>
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
              {t('accounting.payroll.fixedAmount')}
            </label>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <input
                type="radio"
                checked={!form.isFixed}
                onChange={() => setForm((f) => ({ ...f, isFixed: false }))}
                className="accent-blue-600"
              />
              {t('accounting.payroll.percentOfBaseSalary')}
            </label>
          </div>

          {form.isFixed ? (
            <div className="flex flex-col gap-1 w-full sm:w-1/2">
              <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.defaultAmountRp')}</label>
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
              <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.defaultPercentage')}</label>
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
              <label className="text-xs font-semibold text-gray-600">{t('accounting.payroll.payableAccountOptional')}</label>
              <select
                value={form.accountId}
                onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 bg-white"
              >
                <option value="">{t('accounting.payroll.payrollDeductionsPayableDefault')}</option>
                {liabilityAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400">
                {t('accounting.payroll.payableAccountHint')}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
            {saving ? t('accounting.payroll.adding') : t('accounting.payroll.addComponent')}
          </button>
        </form>
      )}

      {loading && <p className="text-sm text-gray-500">{t('accounting.payroll.loadingComponents')}</p>}
      {!loading && components && components.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">{t('accounting.payroll.noComponentsYet')}</p>
      )}

      <div className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
        {(components ?? []).map((c) => (
          <div key={c.id} className="border-b border-gray-100 last:border-b-0">
            <div className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.name}</p>
                <p className="text-xs text-gray-400">
                  {c.type === 'ALLOWANCE' ? t('accounting.payroll.allowance') : t('accounting.payroll.deduction')} ·{' '}
                  {c.isFixed ? formatIDR(Number(c.defaultAmount ?? 0)) : `${c.defaultPercentage ?? 0}%`}
                  {c.account && ` · ${c.account.code} ${c.account.name}`}
                </p>
              </div>
              <button
                onClick={() => (editingId === c.id ? setEditingId(null) : openEdit(c))}
                className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 shrink-0"
              >
                {editingId === c.id ? t('common.cancel') : t('common.edit')}
              </button>
            </div>

            {editingId === c.id && (
              <div className="px-4 pb-3 flex flex-col gap-2.5 bg-gray-50/60 pt-1">
                {editError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{editError}</p>}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-gray-600">{t('common.name')}</label>
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
                    {t('accounting.payroll.fixedAmount')}
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                    <input type="radio" checked={!editForm.isFixed} onChange={() => setEditForm((f) => ({ ...f, isFixed: false }))} className="accent-blue-600" />
                    {t('accounting.payroll.percentOfBaseSalary')}
                  </label>
                </div>
                {editForm.isFixed ? (
                  <div className="flex flex-col gap-1 w-full sm:w-1/2">
                    <label className="text-[11px] font-semibold text-gray-600">{t('accounting.payroll.defaultAmountRp')}</label>
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
                    <label className="text-[11px] font-semibold text-gray-600">{t('accounting.payroll.defaultPercentage')}</label>
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
                    <label className="text-[11px] font-semibold text-gray-600">{t('accounting.payroll.payableAccount')}</label>
                    <select
                      value={editForm.accountId}
                      onChange={(e) => setEditForm((f) => ({ ...f, accountId: e.target.value }))}
                      className="border-2 border-gray-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white"
                    >
                      <option value="">{t('accounting.payroll.payrollDeductionsPayableDefault')}</option>
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
                  {t('common.save')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}