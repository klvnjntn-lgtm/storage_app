'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Target } from 'lucide-react';
import { AccountBreakdownPanel, BreakdownToggle } from '@/app/components/accounting/AccountBreakdown';
import { toCalendarDateString } from '@/lib/dates';
import { useAccountName } from '@/lib/account-names';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';
import { useDialog } from '@/app/components/shared/DialogProvider';
import { BranchFilter } from '@/app/components/shared/BranchFilter';
import { ExportExcelButton } from '@/app/components/shared/ExportExcelButton';
import MoneyInput from '@/app/components/shared/MoneyInput';
import { useBranches } from '@/lib/hooks/useBranches';
import { fileNamePart } from '@/lib/excel-export';
import { PageFrame, Card, ErrorNote, btnPrimary, btnSecondary, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';

type BudgetAccount = {
  id: string;
  code: string;
  name: string;
  type: 'REVENUE' | 'EXPENSE';
  budget: number[];
  actual: number[];
};
type Tab = 'compare' | 'edit';

const WHOLE_YEAR = 0;
// inputCls without its full width, for controls sized to their content.
const autoCls = inputCls.replace('w-full ', '');
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

// Budget against what the ledger shows. Above budget is good for revenue and
// bad for an expense, so "difference" is always written as good = positive.
export default function BudgetPage() {
  const { t, language } = useLanguage();
  const dialog = useDialog();
  const { branches } = useBranches();
  const thisYear = new Date().getFullYear();
  const [tab, setTab] = useState<Tab>('compare');
  const [year, setYear] = useState(thisYear);
  const [period, setPeriod] = useState(new Date().getMonth() + 1);
  const [branchId, setBranchId] = useState('');
  const [accounts, setAccounts] = useState<BudgetAccount[] | null>(null);
  const [draft, setDraft] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const accountName = useAccountName();
  // Rows opened to show what their actual figure is made of; all of them while showAll is on.
  const [showAll, setShowAll] = useState(true);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => opened[id] ?? showAll;

  useEffect(() => {
    let stale = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ year: String(year) });
        if (branchId) params.set('branchId', branchId);
        const res = await apiFetch(`/budgets?${params}`);
        const body = await res.json().catch(() => null);
        if (stale) return;
        if (!res.ok) {
          setError(body?.message ?? t('accounting.budget.loadFailed'));
          setAccounts(null);
          return;
        }
        setAccounts(body.accounts);
        setDraft({});
      } catch {
        if (!stale) setError(t('accounting.budget.serverError'));
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
    // t only follows the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, branchId]);

  const monthName = (m: number, style: 'short' | 'long' = 'long') =>
    new Date(2026, m - 1, 1).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-GB', { month: style });

  const dirty = Object.keys(draft).length > 0;

  // The compare tab's period as dates, for the breakdown of each account's actual.
  const periodFrom = toCalendarDateString(new Date(year, period === WHOLE_YEAR ? 0 : period - 1, 1));
  const periodTo = toCalendarDateString(period === WHOLE_YEAR ? new Date(year, 11, 31) : new Date(year, period, 0));

  // Changing year or branch would throw away what's typed.
  async function guarded(change: () => void) {
    if (dirty && !(await dialog.confirm(t('accounting.budget.discardConfirm')))) return;
    change();
  }

  const budgetOf = (a: BudgetAccount) => draft[a.id] ?? a.budget;

  function setMonth(a: BudgetAccount, month: number, value: number) {
    setSaved(false);
    const next = [...budgetOf(a)];
    next[month] = value;
    setDraft((d) => ({ ...d, [a.id]: next }));
  }

  // Most budgets are flat: type January, copy it across.
  function fillRow(a: BudgetAccount) {
    setSaved(false);
    const first = budgetOf(a)[0];
    setDraft((d) => ({ ...d, [a.id]: Array.from({ length: 12 }, () => first) }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/budgets', {
        method: 'PUT',
        body: JSON.stringify({
          year,
          ...(branchId && { branchId }),
          rows: Object.entries(draft).map(([accountId, budget]) => ({ accountId, budget: budget.map((v) => v || 0) })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('accounting.budget.saveFailed'));
        return;
      }
      setAccounts(body.accounts);
      setDraft({});
      setSaved(true);
    } catch {
      setError(t('accounting.budget.serverError'));
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(() => {
    const pick = (values: number[]) => (period === WHOLE_YEAR ? sum(values) : values[period - 1]);
    return (accounts ?? []).map((a) => {
      const budget = pick(a.budget);
      const actual = pick(a.actual);
      return { ...a, budgetValue: budget, actualValue: actual, difference: a.type === 'REVENUE' ? actual - budget : budget - actual };
    });
  }, [accounts, period]);
  const visible = rows.filter((r) => r.budgetValue || r.actualValue);
  const revenue = visible.filter((r) => r.type === 'REVENUE');
  const expenses = visible.filter((r) => r.type === 'EXPENSE');
  const totals = (list: typeof rows) => ({
    budget: sum(list.map((r) => r.budgetValue)),
    actual: sum(list.map((r) => r.actualValue)),
    difference: sum(list.map((r) => r.difference)),
  });
  const revenueTotal = totals(revenue);
  const expenseTotal = totals(expenses);
  const hasBudget = (accounts ?? []).some((a) => a.budget.some(Boolean));

  const usedPct = (budget: number, actual: number) => (budget > 0 ? `${Math.round((actual / budget) * 100)}%` : '—');
  const diffCls = (n: number) => (n < 0 ? 'text-red-700' : n > 0 ? 'text-green-700' : 'text-gray-500');

  const buildExcel = () => {
    const header = [t('accounting.export.code'), t('accounting.export.account'), t('accounting.budget.budgetCol'), t('accounting.budget.actualCol'), t('accounting.budget.differenceCol'), t('accounting.budget.usedCol')];
    const line = (r: (typeof rows)[number]) => [r.code, r.name, r.budgetValue, r.actualValue, r.difference, usedPct(r.budgetValue, r.actualValue)];
    const branch = branches.find((b) => b.id === branchId)?.name;
    const suffix = `${year}${period === WHOLE_YEAR ? '' : `-${String(period).padStart(2, '0')}`}${branch ? `-${fileNamePart(branch)}` : ''}`;
    return {
      fileName: `anggaran-${suffix}.xlsx`,
      sheets: [
        {
          name: t('nav.items.budget'),
          rows: [
            header,
            [t('accounting.profitLoss.revenue')],
            ...revenue.map(line),
            ['', t('accounting.profitLoss.totalRevenue'), revenueTotal.budget, revenueTotal.actual, revenueTotal.difference, usedPct(revenueTotal.budget, revenueTotal.actual)],
            [t('accounting.budget.expenses')],
            ...expenses.map(line),
            ['', t('accounting.budget.totalExpenses'), expenseTotal.budget, expenseTotal.actual, expenseTotal.difference, usedPct(expenseTotal.budget, expenseTotal.actual)],
            ['', t('accounting.profitLoss.netProfit'), revenueTotal.budget - expenseTotal.budget, revenueTotal.actual - expenseTotal.actual, revenueTotal.difference + expenseTotal.difference],
          ],
          money: [2, 3, 4],
          widths: [10, 40, 16, 16, 16, 10],
        },
      ],
    };
  };

  const section = (title: string, list: typeof rows, totalLabel: string, total: ReturnType<typeof totals>) =>
    list.length > 0 && (
      <>
        <tr>
          <td colSpan={5} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {title}
          </td>
        </tr>
        {list.map((r) => [
          <tr key={r.id} className="border-t border-gray-100 hover:bg-blue-50/60 cursor-pointer" onClick={() => setOpened((o) => ({ ...o, [r.id]: !isOpen(r.id) }))}>
            <td className={tdCls}>
              <span className="inline-flex items-center gap-1">
                {isOpen(r.id) ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                <span className="text-gray-400 font-mono text-xs mr-1">{r.code}</span>
                {accountName(r.name)}
              </span>
            </td>
            <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(r.budgetValue)}</td>
            <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(r.actualValue)}</td>
            <td className={`${tdCls} text-right tabular-nums ${diffCls(r.difference)}`}>{formatIDR(r.difference)}</td>
            <td className={`${tdCls} text-right tabular-nums text-gray-500`}>{usedPct(r.budgetValue, r.actualValue)}</td>
          </tr>,
          isOpen(r.id) && (
            <tr key={`${r.id}-detail`}>
              <td colSpan={5} className="pb-3 pr-3">
                <div className="ml-8 border-l-2 border-blue-500/25 pl-3 text-xs">
                  <AccountBreakdownPanel accountId={r.id} from={periodFrom} to={periodTo} />
                </div>
              </td>
            </tr>
          ),
        ])}
        <tr className="border-t border-gray-300 font-semibold">
          <td className={tdCls}>{totalLabel}</td>
          <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(total.budget)}</td>
          <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(total.actual)}</td>
          <td className={`${tdCls} text-right tabular-nums ${diffCls(total.difference)}`}>{formatIDR(total.difference)}</td>
          <td className={`${tdCls} text-right tabular-nums text-gray-500`}>{usedPct(total.budget, total.actual)}</td>
        </tr>
      </>
    );

  const tabs = (
    <div className="flex gap-1.5 mt-3">
      {([['compare', t('accounting.budget.tabCompare')], ['edit', t('accounting.budget.tabEdit')]] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
            tab === key ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-blue-50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <PageFrame icon={Target} title={t('nav.items.budget')} subtitle={t('accounting.budget.subtitle')} width="max-w-6xl" below={tabs}>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 block mb-1.5">{t('accounting.budget.year')}</span>
            <select value={year} onChange={(e) => guarded(() => setYear(Number(e.target.value)))} className={autoCls}>
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          {tab === 'compare' && (
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 block mb-1.5">{t('accounting.budget.period')}</span>
              <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} className={autoCls}>
                <option value={WHOLE_YEAR}>{t('accounting.budget.wholeYear')}</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i + 1}>{monthName(i + 1)}</option>
                ))}
              </select>
            </label>
          )}
          <BranchFilter
            value={branchId}
            onChange={(id) => guarded(() => setBranchId(id))}
            selectClassName={autoCls}
          />
          <div className="flex-1" />
          {tab === 'compare' ? (
            <>
              <BreakdownToggle
                value={showAll}
                onChange={(v) => {
                  setShowAll(v);
                  setOpened({});
                }}
              />
              <ExportExcelButton disabled={!accounts || loading} build={buildExcel} />
            </>
          ) : (
            <button type="button" onClick={save} disabled={!dirty || saving} className={btnPrimary}>
              {saving ? t('accounting.budget.saving') : t('accounting.budget.save')}
            </button>
          )}
        </div>
        {tab === 'edit' && saved && <p className="text-xs text-green-700 mt-2">{t('accounting.budget.savedNote')}</p>}
        {branchId && <p className="text-xs text-gray-500 mt-2">{t('accounting.budget.branchNote')}</p>}
      </Card>

      <ErrorNote message={error} />
      {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}

      {!loading && accounts && tab === 'compare' && (
        <Card>
          {!hasBudget && <p className="text-sm text-gray-500 mb-3">{t('accounting.budget.noBudgetYet')}</p>}
          {visible.length === 0 ? (
            <p className="text-sm text-gray-400">{t('accounting.budget.nothingInPeriod')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className={thCls}>{t('accounting.export.account')}</th>
                    <th className={`${thCls} text-right`}>{t('accounting.budget.budgetCol')}</th>
                    <th className={`${thCls} text-right`}>{t('accounting.budget.actualCol')}</th>
                    <th className={`${thCls} text-right`}>{t('accounting.budget.differenceCol')}</th>
                    <th className={`${thCls} text-right`}>{t('accounting.budget.usedCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {section(t('accounting.profitLoss.revenue'), revenue, t('accounting.profitLoss.totalRevenue'), revenueTotal)}
                  {section(t('accounting.budget.expenses'), expenses, t('accounting.budget.totalExpenses'), expenseTotal)}
                  <tr className="border-t-2 border-gray-300 font-bold">
                    <td className={tdCls}>{t('accounting.profitLoss.netProfit')}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(revenueTotal.budget - expenseTotal.budget)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(revenueTotal.actual - expenseTotal.actual)}</td>
                    <td className={`${tdCls} text-right tabular-nums ${diffCls(revenueTotal.difference + expenseTotal.difference)}`}>
                      {formatIDR(revenueTotal.difference + expenseTotal.difference)}
                    </td>
                    <td className={tdCls} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!loading && accounts && tab === 'edit' && (
        <Card>
          <p className="text-xs text-gray-500 mb-3">{t('accounting.budget.editHint')}</p>
          <div className="overflow-x-auto">
            <table className="w-max min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={`${thCls} sticky left-0 z-[1] bg-white min-w-64`}>{t('accounting.export.account')}</th>
                  {Array.from({ length: 12 }, (_, i) => (
                    <th key={i} className={`${thCls} text-right`}>{monthName(i + 1, 'short')}</th>
                  ))}
                  <th className={`${thCls} text-right`}>{t('common.total')}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className={`${tdCls} sticky left-0 z-[1] bg-white`}>
                      <span className="flex items-center gap-2">
                        <span className="min-w-0">
                          <span className="text-gray-400 font-mono text-xs mr-2">{a.code}</span>
                          {a.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => fillRow(a)}
                          className="ml-auto text-gray-400 hover:text-blue-700 shrink-0"
                          title={t('accounting.budget.fillRow')}
                          aria-label={t('accounting.budget.fillRow')}
                        >
                          <Copy size={14} />
                        </button>
                      </span>
                    </td>
                    {budgetOf(a).map((value, i) => (
                      <td key={i} className="px-1 py-1">
                        <MoneyInput
                          min={0}
                          value={value || ''}
                          aria-label={`${a.name} ${monthName(i + 1)}`}
                          onChange={(e) => setMonth(a, i, Number(e.target.value) || 0)}
                          className={`${autoCls} w-32 text-right tabular-nums`}
                        />
                      </td>
                    ))}
                    <td className={`${tdCls} text-right tabular-nums font-semibold whitespace-nowrap`}>{formatIDR(sum(budgetOf(a)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            {dirty && (
              <button type="button" onClick={() => setDraft({})} className={btnSecondary}>
                {t('common.cancel')}
              </button>
            )}
            <button type="button" onClick={save} disabled={!dirty || saving} className={btnPrimary}>
              {saving ? t('accounting.budget.saving') : t('accounting.budget.save')}
            </button>
          </div>
        </Card>
      )}
    </PageFrame>
  );
}
