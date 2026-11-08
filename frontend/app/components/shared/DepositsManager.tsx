'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, X, type LucideIcon } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY, parseCalendarDate, toCalendarDateString } from '@/lib/dates';
import { isAdminRole } from '@/lib/roles';
import { useLanguage } from '@/app/context/LanguageContext';
import { useDialog } from '@/app/components/shared/DialogProvider';
import { BranchFilter, BranchPicker } from '@/app/components/shared/BranchFilter';
import DatePicker from '@/app/components/shared/DatePicker';
import MoneyInput from '@/app/components/shared/MoneyInput';
import Pagination from '@/app/components/shared/Pagination';
import { useConfirmPastDates } from '@/lib/hooks/useConfirmPastDates';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { PageFrame, Card, ErrorNote, Switch, btnPrimary, btnSecondary, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';

type Method = 'CASH' | 'TRANSFER' | 'QRIS' | 'OTHER';
type BankAccount = { id: string; bankName: string; accountNumber: string; archivedAt: string | null };
type Deposit = {
  id: string;
  depositNumber: string;
  date: string;
  customer?: { id: string; name: string };
  supplier?: { id: string; name: string };
  branch: { id: string; name: string } | null;
  amount: number;
  appliedAmount: number;
  refundedAmount: number;
  remaining: number;
  method: Method;
  note: string | null;
  voidedAt: string | null;
};

const METHODS: Method[] = ['CASH', 'TRANSFER', 'QRIS', 'OTHER'];
const today = () => toCalendarDateString(new Date());
// inputCls without its full width, for a filter sized to its content.
const autoCls = inputCls.replace('w-full ', '');

type Party = { id: string };

// Down payments (uang muka), for either side of the business: taken from a
// customer or paid to a supplier before there's a document to set them against,
// and used later from that document's own page. Both pages are this one
// component, so they can't drift apart.
export function DepositsManager<P extends Party>({
  apiBase,
  partyField,
  i18nPrefix,
  navKey,
  icon,
  defaultMethod,
  adminOnly = false,
  renderPicker,
}: {
  apiBase: string;
  partyField: 'customer' | 'supplier';
  i18nPrefix: string;
  navKey: string;
  icon: LucideIcon;
  defaultMethod: Method;
  // The page is admin-only, so there's no need to ask about the row actions.
  adminOnly?: boolean;
  renderPicker: (value: P | null, onChange: (party: P | null) => void) => ReactNode;
}) {
  const { t } = useLanguage();
  const tp = (key: string, values?: Record<string, string | number>) => t(`${i18nPrefix}.${key}`, values);
  const dialog = useDialog();
  const confirmPastDates = useConfirmPastDates();
  const { user } = useCurrentUser();
  const isAdmin = adminOnly || isAdminRole(user?.role);

  const [rows, setRows] = useState<Deposit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [branchId, setBranchId] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);

  const [adding, setAdding] = useState(false);
  const [party, setParty] = useState<P | null>(null);
  const [form, setForm] = useState({ amount: '', date: today(), method: defaultMethod, bankAccountId: '', note: '', branchId: '' });
  const [saving, setSaving] = useState(false);

  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refund, setRefund] = useState({ amount: '', method: defaultMethod, bankAccountId: '' });

  useEffect(() => {
    let stale = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (branchId) params.set('branchId', branchId);
        if (openOnly) params.set('open', 'true');
        const res = await apiFetch(`${apiBase}?${params}`);
        const body = await res.json().catch(() => null);
        if (stale) return;
        if (!res.ok) {
          setError(body?.message ?? tp('loadFailed'));
          return;
        }
        setRows(body.data);
        setTotal(body.total);
      } catch {
        if (!stale) setError(tp('serverError'));
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
    // t only follows the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, branchId, openOnly, refreshKey]);

  useEffect(() => {
    let stale = false;
    apiFetch('/organization/bank-accounts')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: BankAccount[]) => {
        if (!stale) setBankAccounts(list.filter((b) => !b.archivedAt));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = Number(form.amount);
    if (!party) return setError(tp('chooseParty'));
    if (!(amount > 0)) return setError(tp('enterAmount'));
    if (form.method !== 'CASH' && !form.bankAccountId) return setError(tp('chooseBank'));
    if (!(await confirmPastDates({ payment: form.date }))) return;
    setSaving(true);
    try {
      const res = await apiFetch(apiBase, {
        method: 'POST',
        body: JSON.stringify({
          [`${partyField}Id`]: party.id,
          amount,
          date: form.date,
          method: form.method,
          bankAccountId: form.method === 'CASH' ? undefined : form.bankAccountId,
          note: form.note.trim() || undefined,
          branchId: form.branchId || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? tp('saveFailed')));
        return;
      }
      setAdding(false);
      setParty(null);
      setForm({ amount: '', date: today(), method: defaultMethod, bankAccountId: '', note: '', branchId: '' });
      setPage(1);
      setRefreshKey((k) => k + 1);
    } catch {
      setError(tp('serverError'));
    } finally {
      setSaving(false);
    }
  }

  async function call(path: string, payload: unknown) {
    setError(null);
    try {
      const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(payload) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? tp('saveFailed')));
        return false;
      }
      setRefreshKey((k) => k + 1);
      return true;
    } catch {
      setError(tp('serverError'));
      return false;
    }
  }

  async function voidDeposit(d: Deposit) {
    const reason = await dialog.prompt(tp('voidPrompt', { number: d.depositNumber }));
    if (reason === null) return;
    await call(`${apiBase}/${d.id}/void`, { reason });
  }

  async function submitRefund(e: FormEvent, d: Deposit) {
    e.preventDefault();
    const amount = Number(refund.amount);
    if (!(amount > 0) || amount > d.remaining) return setError(tp('refundTooMuch'));
    if (refund.method !== 'CASH' && !refund.bankAccountId) return setError(tp('chooseBank'));
    if (!(await dialog.confirm(tp('refundConfirm', { amount: formatIDR(amount), name: nameOf(d) })))) return;
    const ok = await call(`${apiBase}/${d.id}/refund`, {
      amount,
      method: refund.method,
      bankAccountId: refund.method === 'CASH' ? undefined : refund.bankAccountId,
    });
    if (ok) setRefundingId(null);
  }

  const methodSelect = (value: Method, onChange: (m: Method) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value as Method)} className={inputCls}>
      {METHODS.map((m) => (
        <option key={m} value={m}>{tp(`methods.${m}`)}</option>
      ))}
    </select>
  );
  const bankSelect = (value: string, onChange: (id: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">{tp('selectBank')}</option>
      {bankAccounts.map((b) => (
        <option key={b.id} value={b.id}>{b.bankName} · {b.accountNumber}</option>
      ))}
    </select>
  );
  const label = 'text-xs font-semibold text-gray-600 block mb-1.5';
  const nameOf = (d: Deposit) => d[partyField]?.name ?? '';

  return (
    <PageFrame
      icon={icon}
      title={t(`nav.items.${navKey}`)}
      subtitle={tp('subtitle')}
      actions={
        <button type="button" onClick={() => setAdding((a) => !a)} className={adding ? btnSecondary : btnPrimary}>
          {adding ? <X size={14} /> : <Plus size={14} />}
          {adding ? t('common.cancel') : tp('new')}
        </button>
      }
    >
      <ErrorNote message={error} />

      {adding && (
        <Card title={tp('new')}>
          <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              {renderPicker(party, setParty)}
            </div>
            <label className="block">
              <span className={label}>{tp('amount')}</span>
              <MoneyInput min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} />
            </label>
            <div>
              <span className={label}>{tp('date')}</span>
              <DatePicker value={form.date} onChange={(date) => setForm({ ...form, date })} className="w-full" />
            </div>
            <label className="block">
              <span className={label}>{tp('method')}</span>
              {methodSelect(form.method, (method) => setForm({ ...form, method }))}
            </label>
            {form.method !== 'CASH' && (
              <label className="block">
                <span className={label}>{tp('bankAccount')}</span>
                {bankSelect(form.bankAccountId, (bankAccountId) => setForm({ ...form, bankAccountId }))}
              </label>
            )}
            <label className="block sm:col-span-2">
              <span className={label}>{tp('note')}</span>
              <input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputCls} />
            </label>
            <div className="sm:col-span-2">
              <BranchPicker value={form.branchId} onChange={(id) => setForm({ ...form, branchId: id })} />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button disabled={saving} className={btnPrimary}>
                {saving ? tp('saving') : tp('save')}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-4 mb-3">
          <BranchFilter
            value={branchId}
            onChange={(id) => {
              setBranchId(id);
              setPage(1);
            }}
            selectClassName={autoCls}
          />
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <Switch
              checked={openOnly}
              label={tp('openOnly')}
              onChange={(next) => {
                setOpenOnly(next);
                setPage(1);
              }}
            />
            {tp('openOnly')}
          </label>
        </div>

        {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
        {!loading && rows.length === 0 && <p className="text-sm text-gray-400">{tp('none')}</p>}
        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={thCls}>{tp('number')}</th>
                  <th className={thCls}>{tp('date')}</th>
                  <th className={thCls}>{tp('party')}</th>
                  <th className={`${thCls} text-right`}>{tp('amount')}</th>
                  <th className={`${thCls} text-right`}>{tp('used')}</th>
                  <th className={`${thCls} text-right`}>{tp('left')}</th>
                  {isAdmin && <th className={thCls} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => [
                  <tr key={d.id} className={`border-t border-gray-100 align-top ${d.voidedAt ? 'text-gray-400 line-through' : ''}`}>
                    <td className={`${tdCls} whitespace-nowrap font-medium`}>{d.depositNumber}</td>
                    <td className={`${tdCls} whitespace-nowrap`}>{formatDMY(parseCalendarDate(d.date))}</td>
                    <td className={tdCls}>
                      {nameOf(d)}
                      {d.note && <span className="block text-xs text-gray-500">{d.note}</span>}
                    </td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(d.amount)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(d.appliedAmount + d.refundedAmount)}</td>
                    <td className={`${tdCls} text-right tabular-nums font-semibold`}>{formatIDR(d.voidedAt ? 0 : d.remaining)}</td>
                    {isAdmin && (
                      <td className={`${tdCls} text-right whitespace-nowrap`}>
                        {!d.voidedAt && d.remaining > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setRefundingId(refundingId === d.id ? null : d.id);
                              setRefund({ amount: String(d.remaining), method: defaultMethod, bankAccountId: '' });
                            }}
                            className="text-xs font-semibold text-blue-700 hover:underline"
                          >
                            {tp('refund')}
                          </button>
                        )}
                        {!d.voidedAt && d.appliedAmount === 0 && d.refundedAmount === 0 && (
                          <button type="button" onClick={() => voidDeposit(d)} className="text-xs font-semibold text-red-700 hover:underline ml-3">
                            {tp('void')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>,
                  refundingId === d.id && (
                    <tr key={`${d.id}-refund`} className="bg-blue-50/40">
                      <td colSpan={7} className="px-3 py-3">
                        <form onSubmit={(e) => submitRefund(e, d)} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                          <label className="block">
                            <span className={label}>{tp('refundAmount')}</span>
                            <MoneyInput min={1} max={d.remaining} value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} className={inputCls} />
                          </label>
                          <label className="block">
                            <span className={label}>{tp('method')}</span>
                            {methodSelect(refund.method, (method) => setRefund({ ...refund, method }))}
                          </label>
                          {refund.method !== 'CASH' && (
                            <label className="block">
                              <span className={label}>{tp('bankAccount')}</span>
                              {bankSelect(refund.bankAccountId, (bankAccountId) => setRefund({ ...refund, bankAccountId }))}
                            </label>
                          )}
                          <div className="flex gap-2 justify-end sm:col-start-4">
                            <button type="button" onClick={() => setRefundingId(null)} className={btnSecondary}>{t('common.cancel')}</button>
                            <button className={btnPrimary}>{tp('refund')}</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ),
                ])}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <div className="mt-3">
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        )}
      </Card>
    </PageFrame>
  );
}
