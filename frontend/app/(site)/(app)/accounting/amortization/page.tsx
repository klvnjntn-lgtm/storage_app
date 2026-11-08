'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileClock,
  Hourglass,
  KeyRound,
  Loader2,
  Play,
  Plus,
  Receipt,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY, parseCalendarDate, toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useBranches } from '@/lib/hooks/useBranches';
import { useConfirmPastDates } from '@/lib/hooks/useConfirmPastDates';
import { useAccountName } from '@/lib/account-names';
import { useDialog } from '@/app/components/shared/DialogProvider';
import { BranchFilter } from '@/app/components/shared/BranchFilter';
import DatePicker from '@/app/components/shared/DatePicker';
import MoneyInput from '@/app/components/shared/MoneyInput';
import { Card, ErrorNote, PageFrame, TabBar, btnPrimary, btnSecondary, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';

type Kind = 'INTANGIBLE' | 'PREPAID';
type Status = 'ACTIVE' | 'COMPLETED' | 'WRITTEN_OFF';
type Method = 'CASH' | 'TRANSFER' | 'QRIS' | 'OTHER';

type Item = {
  id: string;
  kind: Kind;
  name: string;
  category: string | null;
  branchId: string | null;
  branch: { name: string } | null;
  startDate: string;
  cost: number;
  usefulLifeMonths: number;
  expenseAccount: { id: string; code: string; name: string } | null;
  accumulatedAmortization: number;
  amountPaid: number;
  status: Status;
  writtenOffAt: string | null;
  notes: string | null;
  monthlyAmount: number;
  monthsDone: number;
  bookValue: number;
  balanceDue: number;
  nextChargeDate: string | null;
};
type Detail = Item & {
  schedule: { month: number; date: string; amount: number; accumulated: number; remaining: number }[];
  payments: { id: string; amount: number; method: Method; paidAt: string; note: string | null }[];
};
type Account = { id: string; code: string; name: string; type: string; isActive: boolean };
type BankAccount = { id: string; bankName: string; accountNumber: string; isDefault?: boolean; archivedAt?: string | null };

const METHODS: Method[] = ['CASH', 'TRANSFER', 'QRIS', 'OTHER'];
const showDate = (d: string) => formatDMY(parseCalendarDate(d.slice(0, 10)));
const today = () => toCalendarDateString(new Date());
// Date-only arithmetic for the form's "ends on" preview, same rule as the server's schedule.
function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

const STATUS_CLS: Record<Status, string> = {
  ACTIVE: 'bg-blue-50 text-blue-700 border-blue-200',
  COMPLETED: 'bg-green-50 text-green-700 border-green-200',
  WRITTEN_OFF: 'bg-gray-100 text-gray-600 border-gray-200',
};

const emptyForm = () => ({
  kind: 'PREPAID' as Kind,
  name: '',
  category: '',
  branchId: '',
  startDate: today(),
  cost: '',
  usefulLifeMonths: '12',
  expenseAccountId: '',
  notes: '',
  paid: true,
  paidAmount: '',
  method: 'TRANSFER' as Method,
  bankAccountId: '',
  paidAt: today(),
});

// Amortisasi: intangible assets (software licences, trademarks) and prepaid expenses (rent,
// insurance paid in advance) spread over the months they benefit. Each month's share is posted
// by "Run amortization", one journal entry per month.
export default function AmortizationPage() {
  const { t } = useLanguage();
  const dialog = useDialog();
  const accountName = useAccountName();
  const confirmPastDates = useConfirmPastDates();
  const { user } = useCurrentUser();
  const { branches, multiBranch } = useBranches();
  // Posting runs across every branch: MASTER only, like depreciation.
  const canRun = user?.role === 'MASTER';

  const [kindTab, setKindTab] = useState<'ALL' | Kind>('ALL');
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [branchFilter, setBranchFilter] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [runThrough, setRunThrough] = useState(today());
  const [running, setRunning] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (kindTab !== 'ALL') params.set('kind', kindTab);
    if (branchFilter) params.set('branchId', branchFilter);
    const res = await apiFetch(`/amortizations?${params}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('accounting.amortization.loadFailed'));
      return;
    }
    setItems(body);
  }, [statusFilter, kindTab, branchFilter, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const [accRes, bankRes] = await Promise.all([apiFetch('/accounting/accounts'), apiFetch('/organization/bank-accounts')]);
      if (accRes.ok) setAccounts(await accRes.json());
      if (bankRes.ok) {
        const list: BankAccount[] = (await bankRes.json()).filter((b: BankAccount) => !b.archivedAt);
        setBankAccounts(list);
        const preferred = list.find((b) => b.isDefault) ?? list[0];
        if (preferred) setForm((f) => ({ ...f, bankAccountId: f.bankAccountId || preferred.id }));
      }
    })();
  }, []);

  const expenseAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.type === 'EXPENSE' && a.isActive)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    [accounts],
  );

  const totals = useMemo(() => {
    const active = (items ?? []).filter((i) => i.status === 'ACTIVE');
    return {
      activeCount: active.length,
      bookValue: active.reduce((s, i) => s + i.bookValue, 0),
      monthly: active.reduce((s, i) => s + i.monthlyAmount, 0),
      balanceDue: (items ?? []).reduce((s, i) => s + i.balanceDue, 0),
    };
  }, [items]);

  const cost = Number(form.cost) || 0;
  const months = Math.max(Number(form.usefulLifeMonths) || 0, 0);
  const preview = cost > 0 && months > 0 ? { monthly: Math.round((cost / months) * 100) / 100, ends: addMonths(form.startDate, months) } : null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) return setFormError(t('accounting.amortization.nameRequired'));
    if (!(cost > 0)) return setFormError(t('accounting.amortization.costRequired'));
    if (!(months >= 1)) return setFormError(t('accounting.amortization.monthsRequired'));
    if (form.kind === 'PREPAID' && !form.expenseAccountId) return setFormError(t('accounting.amortization.expenseAccountRequired'));
    const paidAmount = form.paidAmount.trim() === '' ? cost : Number(form.paidAmount);
    if (form.paid && form.method !== 'CASH' && !form.bankAccountId) return setFormError(t('accounting.amortization.bankRequired'));
    if (!(await confirmPastDates({ document: form.startDate }))) return;

    setSaving(true);
    const res = await apiFetch('/amortizations', {
      method: 'POST',
      body: JSON.stringify({
        kind: form.kind,
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        branchId: form.branchId || undefined,
        startDate: form.startDate,
        cost,
        usefulLifeMonths: months,
        expenseAccountId: form.kind === 'PREPAID' ? form.expenseAccountId : undefined,
        notes: form.notes.trim() || undefined,
        payment:
          form.paid && paidAmount > 0
            ? {
                amount: paidAmount,
                method: form.method,
                paidAt: form.paidAt,
                ...(form.method !== 'CASH' && { bankAccountId: form.bankAccountId }),
              }
            : undefined,
      }),
    });
    const body = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setFormError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? t('accounting.amortization.saveFailed')));
      return;
    }
    setShowForm(false);
    setForm((f) => ({ ...emptyForm(), bankAccountId: f.bankAccountId }));
    setNotice(t('accounting.amortization.created', { name: body.name }));
    setOpenId(body.id);
    load();
  }

  async function run() {
    setRunning(true);
    setError(null);
    setNotice(null);
    const res = await apiFetch('/amortizations/run', { method: 'POST', body: JSON.stringify({ through: runThrough }) });
    const body = await res.json().catch(() => null);
    setRunning(false);
    if (!res.ok) {
      setError(body?.message ?? t('accounting.amortization.runFailed'));
      return;
    }
    const parts = [
      body.itemsAmortized > 0
        ? t('accounting.amortization.runDone', { count: body.itemsAmortized, amount: formatIDR(body.total) })
        : t('accounting.amortization.runNothing'),
    ];
    if (body.skipped?.length) {
      parts.push(
        t('accounting.amortization.runSkipped', {
          list: body.skipped.map((s: { name: string; reason: string }) => `${s.name} (${s.reason})`).join('; '),
        }),
      );
    }
    setNotice(parts.join(' '));
    load();
  }

  const label = 'text-xs font-semibold text-gray-600';

  return (
    <PageFrame
      icon={FileClock}
      title={t('nav.items.amortization')}
      subtitle={t('accounting.amortization.subtitle')}
      actions={
        <button type="button" onClick={() => setShowForm((s) => !s)} className={btnPrimary}>
          {showForm ? <X size={15} /> : <Plus size={15} />}
          <span className="hidden sm:inline">{showForm ? t('common.cancel') : t('accounting.amortization.add')}</span>
        </button>
      }
      below={
        <TabBar
          className="mt-3"
          value={kindTab}
          onChange={setKindTab}
          tabs={[
            { key: 'ALL', label: t('accounting.amortization.tabAll') },
            { key: 'PREPAID', label: t('accounting.amortization.kind.PREPAID'), icon: CalendarClock },
            { key: 'INTANGIBLE', label: t('accounting.amortization.kind.INTANGIBLE'), icon: KeyRound },
          ]}
        />
      }
    >
      <ErrorNote message={error} />
      {notice && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-md px-3 py-2 flex items-start gap-2">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {/* What it is, in one line each — most people meet "amortisasi" here first. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-blue-500/15 bg-white p-3 text-xs text-gray-600">
          <p className="font-semibold text-gray-800 flex items-center gap-1.5 mb-0.5">
            <CalendarClock size={14} className="text-blue-600" /> {t('accounting.amortization.kind.PREPAID')}
          </p>
          {t('accounting.amortization.explainPrepaid')}
        </div>
        <div className="rounded-xl border border-blue-500/15 bg-white p-3 text-xs text-gray-600">
          <p className="font-semibold text-gray-800 flex items-center gap-1.5 mb-0.5">
            <KeyRound size={14} className="text-blue-600" /> {t('accounting.amortization.kind.INTANGIBLE')}
          </p>
          {t('accounting.amortization.explainIntangible')}
        </div>
      </div>

      {showForm && (
        <Card title={t('accounting.amortization.newTitle')}>
          <form onSubmit={create} className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {(['PREPAID', 'INTANGIBLE'] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, kind: k }))}
                  className={`text-left rounded-lg border-2 p-3 transition-colors ${
                    form.kind === k ? 'border-blue-600 bg-blue-50/60' : 'border-gray-200 hover:border-blue-500/40'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {k === 'PREPAID' ? <CalendarClock size={15} /> : <KeyRound size={15} />}
                    {t(`accounting.amortization.kind.${k}`)}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">{t(`accounting.amortization.example.${k}`)}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={label}>{t('accounting.amortization.name')}</span>
                <input
                  value={form.name}
                  maxLength={200}
                  placeholder={t(`accounting.amortization.namePlaceholder.${form.kind}`)}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={`${inputCls} mt-1`}
                />
              </label>
              <label className="block">
                <span className={label}>{t('accounting.amortization.category')}</span>
                <input
                  value={form.category}
                  maxLength={100}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className={`${inputCls} mt-1`}
                />
              </label>
              <label className="block">
                <span className={label}>{t('accounting.amortization.cost')}</span>
                <MoneyInput value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} className={`${inputCls} mt-1 text-right tabular-nums`} />
              </label>
              <label className="block">
                <span className={label}>{t('accounting.amortization.startDate')}</span>
                <DatePicker value={form.startDate} onChange={(v) => setForm((f) => ({ ...f, startDate: v, paidAt: f.paidAt === f.startDate ? v : f.paidAt }))} className="w-full mt-1" />
              </label>
              <div>
                <span className={label}>{t('accounting.amortization.months')}</span>
                <div className="mt-1 flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={form.usefulLifeMonths}
                    onChange={(e) => setForm((f) => ({ ...f, usefulLifeMonths: e.target.value }))}
                    className={`${inputCls} w-24`}
                  />
                  <div className="flex flex-wrap gap-1">
                    {[6, 12, 24, 36, 60].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, usefulLifeMonths: String(m) }))}
                        className={`text-xs px-2.5 py-1.5 rounded-md border ${
                          Number(form.usefulLifeMonths) === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-blue-50'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {form.kind === 'PREPAID' ? (
                <label className="block">
                  <span className={label}>{t('accounting.amortization.expenseAccount')}</span>
                  <select
                    value={form.expenseAccountId}
                    onChange={(e) => setForm((f) => ({ ...f, expenseAccountId: e.target.value }))}
                    className={`${inputCls} mt-1`}
                  >
                    <option value="">{t('accounting.amortization.chooseAccount')}</option>
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {accountName(a.name)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="text-xs text-gray-500 self-end pb-2">{t('accounting.amortization.intangibleAccountNote')}</div>
              )}
              {multiBranch && (
                <label className="block">
                  <span className={label}>{t('accounting.fixedAssets.branchOptional')}</span>
                  <select value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} className={`${inputCls} mt-1`}>
                    <option value="">{t('accounting.expenses.wholeBusiness')}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block sm:col-span-2">
                <span className={label}>{t('accounting.amortization.notes')}</span>
                <input value={form.notes} maxLength={1000} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={`${inputCls} mt-1`} />
              </label>
            </div>

            {preview && (
              <div className="rounded-lg bg-blue-50/70 border border-blue-500/20 px-3 py-2 text-sm text-blue-900">
                {t('accounting.amortization.preview', {
                  monthly: formatIDR(preview.monthly),
                  months,
                  first: showDate(addMonths(form.startDate, 1)),
                  last: showDate(preview.ends),
                })}
              </div>
            )}

            <div className="rounded-lg border border-gray-200 p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={form.paid} onChange={(e) => setForm((f) => ({ ...f, paid: e.target.checked }))} className="accent-blue-600" />
                {t('accounting.amortization.paidNow')}
              </label>
              {form.paid && (
                <div className="grid gap-3 sm:grid-cols-4">
                  <label className="block">
                    <span className={label}>{t('accounting.amortization.paidAmount')}</span>
                    <MoneyInput
                      value={form.paidAmount}
                      placeholder={cost ? new Intl.NumberFormat('id-ID').format(cost) : ''}
                      onChange={(e) => setForm((f) => ({ ...f, paidAmount: e.target.value }))}
                      className={`${inputCls} mt-1 text-right tabular-nums`}
                    />
                  </label>
                  <label className="block">
                    <span className={label}>{t('purchasing.supplierPayments.method')}</span>
                    <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as Method }))} className={`${inputCls} mt-1`}>
                      {METHODS.map((m) => (
                        <option key={m} value={m}>
                          {t(`purchasing.supplierPayments.methods.${m}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.method !== 'CASH' && (
                    <label className="block">
                      <span className={label}>{t('purchasing.supplierPayments.bankAccount')}</span>
                      <select value={form.bankAccountId} onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value }))} className={`${inputCls} mt-1`}>
                        <option value="">{t('purchasing.supplierPayments.selectBankAccount')}</option>
                        {bankAccounts.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bankName} · {b.accountNumber}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="block">
                    <span className={label}>{t('purchasing.supplierPayments.paidAt')}</span>
                    <DatePicker value={form.paidAt} onChange={(v) => setForm((f) => ({ ...f, paidAt: v }))} className="w-full mt-1" />
                  </label>
                </div>
              )}
            </div>

            <ErrorNote message={formError} />
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className={btnPrimary}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {saving ? t('accounting.amortization.saving') : t('accounting.amortization.save')}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Totals: what's still on the balance sheet and what it costs each month. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          [t('accounting.amortization.activeCount'), String(totals.activeCount)],
          [t('accounting.amortization.bookValueTotal'), formatIDR(totals.bookValue)],
          [t('accounting.amortization.monthlyTotal'), formatIDR(totals.monthly)],
          [t('accounting.amortization.balanceDueTotal'), formatIDR(totals.balanceDue)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-blue-500/15 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{k}</p>
            <p className="text-lg font-bold tabular-nums mt-0.5">{v}</p>
          </div>
        ))}
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 mb-3">
          <label className="block">
            <span className={label}>{t('accounting.amortization.statusFilter')}</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | Status)} className={`${inputCls} mt-1 sm:w-48`}>
              <option value="">{t('accounting.amortization.allStatuses')}</option>
              {(['ACTIVE', 'COMPLETED', 'WRITTEN_OFF'] as Status[]).map((s) => (
                <option key={s} value={s}>
                  {t(`accounting.amortization.status.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <BranchFilter value={branchFilter} onChange={setBranchFilter} selectClassName={`${inputCls} sm:w-48`} />
          {canRun && (
            <div className="sm:ml-auto flex items-end gap-2">
              <label className="block">
                <span className={label}>{t('accounting.amortization.runThrough')}</span>
                <DatePicker value={runThrough} onChange={setRunThrough} className="mt-1" />
              </label>
              <button type="button" onClick={run} disabled={running} className={btnPrimary}>
                {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {t('accounting.amortization.run')}
              </button>
            </div>
          )}
        </div>
        {canRun && <p className="text-xs text-gray-500 mb-3">{t('accounting.amortization.runHint')}</p>}

        {items === null ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">{t('accounting.amortization.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={thCls}>{t('accounting.amortization.name')}</th>
                  <th className={`${thCls} text-right`}>{t('accounting.amortization.cost')}</th>
                  <th className={`${thCls} text-right`}>{t('accounting.amortization.perMonth')}</th>
                  <th className={thCls}>{t('accounting.amortization.progress')}</th>
                  <th className={`${thCls} text-right`}>{t('accounting.amortization.bookValue')}</th>
                  <th className={thCls}>{t('accounting.amortization.statusCol')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const open = openId === item.id;
                  const pct = item.cost ? Math.min(item.accumulatedAmortization / item.cost, 1) : 0;
                  return [
                    <tr
                      key={item.id}
                      onClick={() => setOpenId(open ? null : item.id)}
                      className="border-t border-gray-100 align-top cursor-pointer hover:bg-blue-50/50"
                    >
                      <td className={tdCls}>
                        <span className="flex items-start gap-1.5">
                          {open ? <ChevronDown size={14} className="mt-0.5 text-gray-400 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 text-gray-400 shrink-0" />}
                          <span className="min-w-0">
                            <span className="font-medium break-words">{item.name}</span>
                            <span className="block text-xs text-gray-500">
                              {t(`accounting.amortization.kind.${item.kind}`)}
                              {item.category && ` · ${item.category}`}
                              {item.expenseAccount && ` · ${item.expenseAccount.code} ${accountName(item.expenseAccount.name)}`}
                              {item.branch && ` · ${item.branch.name}`}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{formatIDR(item.cost)}</td>
                      <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{formatIDR(item.monthlyAmount)}</td>
                      <td className={`${tdCls} min-w-36`}>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct * 100}%` }} />
                        </div>
                        <span className="text-[11px] text-gray-500">
                          {t('accounting.amortization.monthsOf', { done: item.monthsDone, total: item.usefulLifeMonths })}
                          {item.nextChargeDate && ` · ${t('accounting.amortization.next', { date: showDate(item.nextChargeDate) })}`}
                        </span>
                      </td>
                      <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{formatIDR(item.bookValue)}</td>
                      <td className={tdCls}>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_CLS[item.status]}`}>
                          {t(`accounting.amortization.status.${item.status}`)}
                        </span>
                        {item.balanceDue > 0.005 && (
                          <span className="block text-[11px] text-amber-700 mt-1 whitespace-nowrap">
                            {t('accounting.amortization.unpaid', { amount: formatIDR(item.balanceDue) })}
                          </span>
                        )}
                      </td>
                    </tr>,
                    open && (
                      <tr key={`${item.id}-detail`}>
                        <td colSpan={6} className="px-3 pb-4">
                          <ItemDetail
                            id={item.id}
                            bankAccounts={bankAccounts}
                            onChanged={(msg) => {
                              if (msg) setNotice(msg);
                              load();
                            }}
                            onRemoved={() => {
                              setOpenId(null);
                              load();
                            }}
                            dialog={dialog}
                          />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageFrame>
  );
}

// An opened row: its month-by-month schedule (which months are posted), its payments, and
// paying, writing off or deleting it.
function ItemDetail({
  id,
  bankAccounts,
  onChanged,
  onRemoved,
  dialog,
}: {
  id: string;
  bankAccounts: BankAccount[];
  onChanged: (message?: string) => void;
  onRemoved: () => void;
  dialog: ReturnType<typeof useDialog>;
}) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [pay, setPay] = useState({ amount: '', method: 'TRANSFER' as Method, bankAccountId: '', paidAt: today() });
  const [writeOffDate, setWriteOffDate] = useState(today());
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/amortizations/${id}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.message ?? t('accounting.amortization.loadFailed'));
    else setDetail(body);
  }, [id, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(path: string, method: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    const res = await apiFetch(path, { method, body: payload ? JSON.stringify(payload) : undefined });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? t('accounting.amortization.saveFailed')));
      return null;
    }
    return body;
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(pay.amount);
    if (!(amount > 0)) return setError(t('accounting.amortization.costRequired'));
    if (pay.method !== 'CASH' && !(pay.bankAccountId || bankAccounts[0]?.id)) return setError(t('accounting.amortization.bankRequired'));
    const body = await call(`/amortizations/${id}/payments`, 'POST', {
      amount,
      method: pay.method,
      paidAt: pay.paidAt,
      ...(pay.method !== 'CASH' && { bankAccountId: pay.bankAccountId || bankAccounts[0]?.id }),
    });
    if (body) {
      setDetail(body);
      setPaying(false);
      onChanged(t('accounting.amortization.paymentSaved'));
    }
  }

  async function writeOff() {
    if (!detail) return;
    if (!(await dialog.confirm(t('accounting.amortization.writeOffConfirm', { amount: formatIDR(detail.bookValue) }), { danger: true }))) return;
    const body = await call(`/amortizations/${id}/write-off`, 'POST', { date: writeOffDate });
    if (body) {
      setDetail(body);
      onChanged(t('accounting.amortization.writtenOff'));
    }
  }

  async function remove() {
    if (!(await dialog.confirm(t('accounting.amortization.deleteConfirm'), { danger: true }))) return;
    const body = await call(`/amortizations/${id}`, 'DELETE');
    if (body) onRemoved();
  }

  if (!detail) return <p className="text-sm text-gray-500 py-2">{error ?? t('common.loading')}</p>;

  const rows = showAll ? detail.schedule : detail.schedule.slice(0, 12);
  const deletable = detail.amountPaid <= 0 && detail.accumulatedAmortization <= 0;

  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-50/30 p-3 space-y-4 text-sm">
      <ErrorNote message={error} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Schedule */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center gap-1.5">
            <Hourglass size={13} /> {t('accounting.amortization.schedule')}
          </h3>
          <div className="overflow-x-auto bg-white rounded-md border border-gray-200">
            <table className="w-full text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-left font-semibold px-2 py-1.5">{t('accounting.amortization.month')}</th>
                  <th className="text-left font-semibold px-2 py-1.5">{t('accounting.export.date')}</th>
                  <th className="text-right font-semibold px-2 py-1.5">{t('accounting.amortization.charge')}</th>
                  <th className="text-right font-semibold px-2 py-1.5">{t('accounting.amortization.accumulated')}</th>
                  <th className="text-right font-semibold px-2 py-1.5">{t('accounting.amortization.bookValue')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const posted = r.month <= detail.monthsDone || detail.status === 'WRITTEN_OFF';
                  return (
                    <tr key={r.month} className={`border-t border-gray-100 ${posted ? 'text-gray-400' : ''}`}>
                      <td className="px-2 py-1">
                        {posted && detail.status !== 'WRITTEN_OFF' ? <CheckCircle2 size={12} className="inline text-green-600 mr-1" /> : null}
                        {r.month}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{showDate(r.date)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatIDR(r.amount)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatIDR(r.accumulated)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatIDR(r.remaining)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {detail.schedule.length > 12 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-1 text-xs font-semibold text-blue-700 hover:underline">
              {showAll ? t('accounting.amortization.showLess') : t('accounting.amortization.showAllMonths', { count: detail.schedule.length })}
            </button>
          )}
          {detail.status === 'WRITTEN_OFF' && detail.writtenOffAt && (
            <p className="mt-1 text-xs text-gray-600">{t('accounting.amortization.writtenOffOn', { date: showDate(detail.writtenOffAt) })}</p>
          )}
          {detail.notes && <p className="mt-2 text-xs text-gray-600">{detail.notes}</p>}
        </div>

        {/* Payments and actions */}
        <div className="space-y-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center gap-1.5">
              <Wallet size={13} /> {t('accounting.amortization.payments')}
            </h3>
            <div className="bg-white rounded-md border border-gray-200 p-2">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500">{t('purchasing.supplierPayments.paid')}</span>
                <span className="tabular-nums font-semibold">{formatIDR(detail.amountPaid)}</span>
              </div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-500">{t('purchasing.supplierPayments.outstanding')}</span>
                <span className={`tabular-nums font-semibold ${detail.balanceDue > 0 ? 'text-amber-700' : ''}`}>{formatIDR(detail.balanceDue)}</span>
              </div>
              {detail.payments.length > 0 && (
                <ul className="divide-y divide-gray-100 text-xs border-t border-gray-100">
                  {detail.payments.map((p) => (
                    <li key={p.id} className="py-1 flex justify-between gap-2">
                      <span>
                        <span className="font-medium">{showDate(p.paidAt)}</span>
                        <span className="text-gray-500"> · {t(`purchasing.supplierPayments.methods.${p.method}`)}</span>
                      </span>
                      <span className="tabular-nums">{formatIDR(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {detail.balanceDue > 0.005 &&
                (paying ? (
                  <form onSubmit={recordPayment} className="mt-2 grid grid-cols-2 gap-2">
                    <MoneyInput
                      value={pay.amount}
                      placeholder={new Intl.NumberFormat('id-ID').format(detail.balanceDue)}
                      onChange={(e) => setPay((f) => ({ ...f, amount: e.target.value }))}
                      className={`${inputCls} text-right tabular-nums`}
                      aria-label={t('common.amount')}
                    />
                    <select value={pay.method} onChange={(e) => setPay((f) => ({ ...f, method: e.target.value as Method }))} className={inputCls}>
                      {METHODS.map((m) => (
                        <option key={m} value={m}>
                          {t(`purchasing.supplierPayments.methods.${m}`)}
                        </option>
                      ))}
                    </select>
                    {pay.method !== 'CASH' && (
                      <select
                        value={pay.bankAccountId || bankAccounts[0]?.id || ''}
                        onChange={(e) => setPay((f) => ({ ...f, bankAccountId: e.target.value }))}
                        className={`${inputCls} col-span-2`}
                      >
                        {bankAccounts.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bankName} · {b.accountNumber}
                          </option>
                        ))}
                      </select>
                    )}
                    <DatePicker value={pay.paidAt} onChange={(v) => setPay((f) => ({ ...f, paidAt: v }))} className="col-span-2" />
                    <button type="button" onClick={() => setPaying(false)} className={btnSecondary}>
                      {t('common.cancel')}
                    </button>
                    <button type="submit" disabled={busy} className={btnPrimary}>
                      {t('common.save')}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPay((f) => ({ ...f, amount: String(detail.balanceDue) }));
                      setPaying(true);
                    }}
                    className={`${btnPrimary} mt-2 w-full justify-center`}
                  >
                    <Receipt size={14} /> {t('accounting.amortization.recordPayment')}
                  </button>
                ))}
            </div>
          </div>

          {detail.status === 'ACTIVE' && (
            <div className="bg-white rounded-md border border-gray-200 p-2 space-y-2">
              <p className="text-xs text-gray-600">{t('accounting.amortization.writeOffHint')}</p>
              <div className="flex items-end gap-2">
                <DatePicker value={writeOffDate} onChange={setWriteOffDate} aria-label={t('accounting.export.date')} />
                <button type="button" onClick={writeOff} disabled={busy} className={btnSecondary}>
                  {t('accounting.amortization.writeOff')}
                </button>
              </div>
            </div>
          )}

          {deletable && (
            <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:underline">
              <Trash2 size={13} /> {t('accounting.amortization.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
