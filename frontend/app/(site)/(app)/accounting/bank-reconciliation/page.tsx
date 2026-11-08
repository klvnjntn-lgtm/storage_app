'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, CheckCircle2, ChevronDown, ChevronRight, Pencil, Plus, Save, Sparkles, Trash2, Upload } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY, parseCalendarDate, toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { useAccountName } from '@/lib/account-names';
import { useDialog } from '@/app/components/shared/DialogProvider';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import DatePicker from '@/app/components/shared/DatePicker';
import { ExportExcelButton } from '@/app/components/shared/ExportExcelButton';
import MoneyInput from '@/app/components/shared/MoneyInput';
import { PageFrame, Card, ErrorNote, btnPrimary, btnSecondary, btnDanger, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';
import { guessMapping, monthBounds, readSheetRows, readStatement, type Cell, type StatementMapping } from '@/lib/bank-statement';
import { fileNamePart } from '@/lib/excel-export';

type BankAccount = { id: string; bankName: string; accountNumber: string; archivedAt: string | null };
type LedgerAccount = { id: string; code: string; name: string; type: string; isActive: boolean };
type BookLine = {
  id: string;
  entryId: string;
  entryNumber: string | null;
  date: string;
  memo: string | null;
  sourceType: string;
  amount: number;
  inPeriod: boolean;
};
type StatementRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  status: 'UNMATCHED' | 'MATCHED' | 'IGNORED';
  matches: { id: string; entryNumber: string | null; date: string; memo: string | null; amount: number }[];
};
type Report = {
  ledgerAccount: { id: string; code: string; name: string };
  lines: StatementRow[];
  bookLines: BookLine[];
  summary: {
    matched: number;
    unmatched: number;
    ignored: number;
    moneyIn: number;
    moneyOut: number;
    bookBalance: number;
    unmatchedStatement: number;
    unmatchedBook: number;
    expectedStatementBalance: number;
    lastStatementBalance: number | null;
  };
};

// The server takes statement lines in batches of this many.
const BATCH = 500;
const showDate = (d: string) => formatDMY(parseCalendarDate(d));

const STATUS_CLS: Record<StatementRow['status'], string> = {
  MATCHED: 'bg-green-50 text-green-700 border-green-200',
  UNMATCHED: 'bg-amber-50 text-amber-800 border-amber-200',
  IGNORED: 'bg-gray-50 text-gray-500 border-gray-200',
};

export default function BankReconciliationPage() {
  const accountName = useAccountName();
  const { t } = useLanguage();
  const dialog = useDialog();
  const initial = monthBounds();
  const [banks, setBanks] = useState<BankAccount[] | null>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statementBalance, setStatementBalance] = useState<string>('');

  // Import panel
  const [importOpen, setImportOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sheetRows, setSheetRows] = useState<Cell[][] | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);

  // The row being worked on
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [mode, setMode] = useState<'match' | 'record'>('match');
  const [picked, setPicked] = useState<string[]>([]);
  const [recordAccount, setRecordAccount] = useState('');
  const [recordMemo, setRecordMemo] = useState('');

  // A statement line being corrected by hand, or typed in (id 'new'). Amount is signed: money in > 0.
  const [editing, setEditing] = useState<{ id: string; date: string; description: string; amount: string; matched: boolean } | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const [bankRes, accountRes] = await Promise.all([apiFetch('/organization/bank-accounts'), apiFetch('/accounting/accounts')]);
        if (stale) return;
        const list: BankAccount[] = bankRes.ok ? (await bankRes.json()).filter((b: BankAccount) => !b.archivedAt) : [];
        setBanks(list);
        if (list.length > 0) setBankAccountId(list[0].id);
        if (accountRes.ok) setLedgerAccounts(await accountRes.json());
      } catch {
        if (!stale) setError(t('accounting.bankRec.serverError'));
      }
    })();
    return () => {
      stale = true;
    };
    // Once. t only follows the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchReport() {
    const res = await apiFetch(`/bank-reconciliation?${new URLSearchParams({ bankAccountId, from, to })}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? t('accounting.bankRec.loadFailed'));
    return body as Report;
  }

  useEffect(() => {
    if (!bankAccountId) return;
    let stale = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await fetchReport();
        if (stale) return;
        setReport(next);
        setStatementBalance(next.summary.lastStatementBalance != null ? String(next.summary.lastStatementBalance) : '');
      } catch (e) {
        if (!stale) {
          setReport(null);
          setError(e instanceof Error ? e.message : t('accounting.bankRec.serverError'));
        }
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
    // fetchReport only reads these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccountId, from, to]);

  // Runs a change, then reads the page's numbers fresh.
  async function act(path: string, payload?: unknown): Promise<unknown | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(payload ?? {}) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? t('accounting.bankRec.saveFailed')));
        return null;
      }
      setReport(await fetchReport());
      return body;
    } catch {
      setError(t('accounting.bankRec.serverError'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const rows = await readSheetRows(await file.arrayBuffer());
      if (rows.length === 0) {
        setError(t('accounting.bankRec.emptyFile'));
        return;
      }
      setFileName(file.name);
      setSheetRows(rows);
      setMapping(guessMapping(rows));
    } catch {
      setError(t('accounting.bankRec.unreadableFile'));
    }
  }

  const parsed = useMemo(
    () => (sheetRows && mapping ? readStatement(sheetRows, mapping, toCalendarDateString(new Date())) : null),
    [sheetRows, mapping],
  );
  const columns = useMemo(() => {
    if (!sheetRows || !mapping) return [];
    const header = sheetRows[mapping.headerRow] ?? [];
    const width = Math.max(...sheetRows.slice(0, 50).map((r) => r.length));
    return Array.from({ length: width }, (_, i) => ({ index: i, label: String(header[i] ?? '').trim() || `${t('accounting.bankRec.column')} ${i + 1}` }));
  }, [sheetRows, mapping, t]);

  async function runImport() {
    if (!parsed || parsed.lines.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let imported = 0;
      let duplicates = 0;
      for (let i = 0; i < parsed.lines.length; i += BATCH) {
        const res = await apiFetch('/bank-reconciliation/import', {
          method: 'POST',
          body: JSON.stringify({ bankAccountId, fileName, lines: parsed.lines.slice(i, i + BATCH) }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? t('accounting.bankRec.saveFailed')));
          return;
        }
        imported += body.imported;
        duplicates += body.duplicates;
      }
      setNotice(t('accounting.bankRec.imported', { imported, duplicates }));
      setImportOpen(false);
      setSheetRows(null);
      setMapping(null);
      // Show the statement that was just brought in, whatever month was on screen.
      const dates = parsed.lines.map((l) => l.date).sort();
      if (dates[0] < from || dates[dates.length - 1] > to) {
        setFrom(dates[0]);
        setTo(dates[dates.length - 1]);
      } else {
        const next = await fetchReport();
        setReport(next);
        // The file just brought in may state a newer closing balance.
        if (next.summary.lastStatementBalance != null) setStatementBalance(String(next.summary.lastStatementBalance));
      }
    } catch {
      setError(t('accounting.bankRec.serverError'));
    } finally {
      setBusy(false);
    }
  }

  // The closing balance typed off the statement, kept so it's there next time and the difference stays put.
  async function saveStatementBalance() {
    const body = await act('/bank-reconciliation/statement-balance', {
      bankAccountId,
      from,
      to,
      balance: statementBalance.trim() === '' ? null : Number(statementBalance),
    });
    if (body) setNotice(t('accounting.bankRec.balanceSaved'));
  }

  async function saveLine() {
    if (!editing) return;
    const amount = Number(editing.amount);
    if (!editing.date || !(Math.abs(amount) > 0)) {
      setError(t('accounting.bankRec.lineInvalid'));
      return;
    }
    const payload = { date: editing.date, description: editing.description, amount };
    const body =
      editing.id === 'new'
        ? await act('/bank-reconciliation/lines', { ...payload, bankAccountId })
        : await act(`/bank-reconciliation/lines/${editing.id}/edit`, payload);
    if (body) {
      setEditing(null);
      setNotice(t('accounting.bankRec.lineSaved'));
    }
  }

  async function autoMatch() {
    const body = (await act('/bank-reconciliation/auto-match', { bankAccountId, from, to })) as { matched: number } | null;
    if (body) setNotice(t('accounting.bankRec.autoMatched', { count: body.matched }));
  }

  async function clearOpen() {
    if (!(await dialog.confirm(t('accounting.bankRec.clearConfirm'), { danger: true }))) return;
    const body = (await act('/bank-reconciliation/clear', { bankAccountId, from, to })) as { removed: number } | null;
    if (body) setNotice(t('accounting.bankRec.cleared', { count: body.removed }));
  }

  function openLine(line: StatementRow, nextMode: 'match' | 'record') {
    setOpenLineId(line.id);
    setMode(nextMode);
    setRecordAccount('');
    setRecordMemo(line.description);
    // An exact single match is ticked already, so it's one click.
    const exact = (report?.bookLines ?? []).filter((b) => Math.abs(b.amount - line.amount) < 0.005);
    setPicked(exact.length === 1 ? [exact[0].id] : []);
  }

  const openRow = report?.lines.find((l) => l.id === openLineId) ?? null;
  // Same direction of money, nearest amount first, then nearest date.
  const candidates = useMemo(() => {
    if (!report || !openRow) return [];
    const day = (d: string) => new Date(d).getTime();
    return report.bookLines
      .filter((b) => Math.sign(b.amount) === Math.sign(openRow.amount))
      .sort(
        (a, b) =>
          Math.abs(a.amount - openRow.amount) - Math.abs(b.amount - openRow.amount) ||
          Math.abs(day(a.date) - day(openRow.date)) - Math.abs(day(b.date) - day(openRow.date)),
      );
  }, [report, openRow]);
  const pickedTotal = (report?.bookLines ?? []).filter((b) => picked.includes(b.id)).reduce((s, b) => s + b.amount, 0);
  const canMatch = !!openRow && picked.length > 0 && Math.abs(pickedTotal - openRow.amount) < 0.005;
  const recordAccounts = ledgerAccounts.filter((a) => a.isActive && (a.type === 'REVENUE' || a.type === 'EXPENSE'));

  const typedBalance = statementBalance.trim() === '' ? null : Number(statementBalance);
  const difference = report && typedBalance != null ? typedBalance - report.summary.expectedStatementBalance : null;
  const bankName = banks?.find((b) => b.id === bankAccountId);

  const statusLabel = (s: StatementRow['status']) => t(`accounting.bankRec.status.${s}`);

  const buildExcel = () => {
    const r = report!;
    const col = (key: string) => t(`accounting.export.${key}`);
    const money = (l: { amount: number }) => [l.amount > 0 ? l.amount : '', l.amount < 0 ? -l.amount : ''];
    const inCol = t('accounting.cashFlow.cashIn');
    const outCol = t('accounting.cashFlow.cashOut');
    return {
      fileName: `rekonsiliasi-${fileNamePart(bankName?.bankName ?? 'bank')}-${from}_${to}.xlsx`,
      sheets: [
        {
          name: t('accounting.bankRec.statementTitle'),
          rows: [
            [col('date'), col('description'), inCol, outCol, t('accounting.bankRec.statusCol'), t('accounting.bankRec.matchedTo')],
            ...r.lines.map((l) => [
              showDate(l.date),
              l.description,
              ...money(l),
              statusLabel(l.status),
              l.matches.map((m) => m.entryNumber ?? m.memo ?? '').join(', '),
            ]),
          ],
          money: [2, 3],
          widths: [12, 48, 16, 16, 14, 24],
        },
        {
          name: t('accounting.bankRec.bookTitle'),
          rows: [
            [col('date'), col('entry'), col('description'), inCol, outCol],
            ...r.bookLines.filter((b) => b.inPeriod).map((b) => [showDate(b.date), b.entryNumber ?? '', b.memo ?? '', ...money(b)]),
          ],
          money: [3, 4],
          widths: [12, 14, 48, 16, 16],
        },
      ],
    };
  };

  const select = (
    label: string,
    value: number | null,
    onChange: (v: number | null) => void,
    optional = true,
  ) => (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600 block mb-1.5">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={inputCls}
      >
        {optional && <option value="">—</option>}
        {columns.map((c) => (
          <option key={c.index} value={c.index}>{c.label}</option>
        ))}
      </select>
    </label>
  );

  // The inline form for correcting a statement line or typing a new one, in the statement table.
  const editorRow = (key: string) =>
    editing && (
      <tr key={key} className="bg-blue-50/50 border-t border-blue-100 align-top">
        <td className="px-3 py-2">
          <DatePicker
            value={editing.date}
            disabled={editing.matched}
            onChange={(v) => setEditing({ ...editing, date: v })}
            aria-label={t('accounting.export.date')}
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={editing.description}
            maxLength={500}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            placeholder={t('accounting.export.description')}
            className={inputCls}
          />
        </td>
        <td colSpan={2} className="px-3 py-2">
          <MoneyInput
            allowNegative
            value={editing.amount}
            disabled={editing.matched}
            onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
            aria-label={t('common.amount')}
            className={`${inputCls} text-right tabular-nums`}
          />
          <span className="block text-[11px] text-gray-500 mt-1">{t('accounting.bankRec.amountHint')}</span>
        </td>
        <td colSpan={2} className="px-3 py-2 text-right whitespace-nowrap">
          <div className="inline-flex gap-2">
            <button type="button" onClick={() => setEditing(null)} className={btnSecondary}>
              {t('common.cancel')}
            </button>
            <button type="button" onClick={saveLine} disabled={busy} className={btnPrimary}>
              <Save size={14} />
              {t('common.save')}
            </button>
          </div>
        </td>
      </tr>
    );

  if (banks && banks.length === 0) {
    return (
      <PageFrame icon={ArrowLeftRight} title={t('nav.items.bankReconciliation')} subtitle={t('accounting.bankRec.subtitle')}>
        <Card>
          <p className="text-sm text-gray-600">
            {t('accounting.bankRec.noBankAccounts')}{' '}
            <Link href="/settings" className="text-blue-700 hover:underline font-medium">{t('accounting.bankRec.openSettings')}</Link>
          </p>
        </Card>
      </PageFrame>
    );
  }

  return (
    <PageFrame icon={ArrowLeftRight} title={t('nav.items.bankReconciliation')} subtitle={t('accounting.bankRec.subtitle')} width="max-w-6xl">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-56">
            <span className="text-xs font-semibold text-gray-600 block mb-1.5">{t('accounting.bankRec.bankAccount')}</span>
            <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={inputCls}>
              {(banks ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.bankName} · {b.accountNumber}</option>
              ))}
            </select>
          </label>
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, tt) => {
              if (f) setFrom(f);
              if (tt) setTo(tt);
            }}
          />
          <div className="flex-1" />
          <ExportExcelButton disabled={!report || loading} build={buildExcel} />
          <button type="button" onClick={autoMatch} disabled={!report || busy || report.summary.unmatched === 0} className={btnSecondary}>
            <Sparkles size={14} />
            {t('accounting.bankRec.autoMatch')}
          </button>
          <button
            type="button"
            onClick={() => setEditing({ id: 'new', date: to, description: '', amount: '', matched: false })}
            disabled={!bankAccountId || busy}
            className={btnSecondary}
          >
            <Plus size={14} />
            {t('accounting.bankRec.addLine')}
          </button>
          <button type="button" onClick={() => setImportOpen((o) => !o)} disabled={!bankAccountId} className={btnPrimary}>
            <Upload size={14} />
            {t('accounting.bankRec.importStatement')}
          </button>
        </div>
      </Card>

      <ErrorNote message={error} />
      {notice && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-md px-3 py-2 flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0" />
          {notice}
        </div>
      )}

      {importOpen && (
        <Card title={t('accounting.bankRec.importTitle')}>
          <p className="text-xs text-gray-500 mb-3">{t('accounting.bankRec.importHint')}</p>
          <input
            type="file"
            accept=".csv,.xls,.xlsx,text/csv"
            onChange={(e) => pickFile(e.target.files?.[0])}
            className="block w-full text-sm text-gray-600 file:mr-3 file:text-sm file:font-medium file:bg-white file:border file:border-gray-300 file:rounded-md file:px-3 file:py-2 file:text-gray-800 hover:file:bg-gray-50"
          />
          {sheetRows && mapping && parsed && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600 block mb-1.5">{t('accounting.bankRec.headerRow')}</span>
                  <select
                    value={mapping.headerRow}
                    onChange={(e) => setMapping({ ...mapping, headerRow: Number(e.target.value) })}
                    className={inputCls}
                  >
                    {sheetRows.slice(0, 30).map((row, i) => (
                      <option key={i} value={i}>
                        {i + 1}: {row.filter(Boolean).slice(0, 3).join(' | ').slice(0, 40) || '—'}
                      </option>
                    ))}
                  </select>
                </label>
                {select(t('accounting.bankRec.dateCol'), mapping.date, (v) => setMapping({ ...mapping, date: v ?? 0 }), false)}
                {select(t('accounting.bankRec.descriptionCol'), mapping.description, (v) => setMapping({ ...mapping, description: v ?? 0 }), false)}
                {select(t('accounting.bankRec.balanceCol'), mapping.balance, (v) => setMapping({ ...mapping, balance: v }))}
                {select(t('accounting.bankRec.outCol'), mapping.debit, (v) => setMapping({ ...mapping, debit: v, amount: v != null ? null : mapping.amount }))}
                {select(t('accounting.bankRec.inCol'), mapping.credit, (v) => setMapping({ ...mapping, credit: v, amount: v != null ? null : mapping.amount }))}
                {select(t('accounting.bankRec.amountCol'), mapping.amount, (v) => setMapping({ ...mapping, amount: v, ...(v != null && { debit: null, credit: null }) }))}
                {select(t('accounting.bankRec.directionCol'), mapping.direction, (v) => setMapping({ ...mapping, direction: v }))}
              </div>
              <p className="text-sm text-gray-700">
                {t('accounting.bankRec.previewSummary', { count: parsed.lines.length, skipped: parsed.skipped })}
              </p>
              {parsed.lines.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className={thCls}>{t('accounting.export.date')}</th>
                        <th className={thCls}>{t('accounting.export.description')}</th>
                        <th className={`${thCls} text-right`}>{t('accounting.cashFlow.cashIn')}</th>
                        <th className={`${thCls} text-right`}>{t('accounting.cashFlow.cashOut')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.lines.slice(0, 5).map((l, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className={`${tdCls} whitespace-nowrap`}>{showDate(l.date)}</td>
                          <td className={tdCls}>{l.description}</td>
                          <td className={`${tdCls} text-right tabular-nums`}>{l.amount > 0 ? formatIDR(l.amount) : ''}</td>
                          <td className={`${tdCls} text-right tabular-nums`}>{l.amount < 0 ? formatIDR(-l.amount) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setImportOpen(false)} className={btnSecondary}>{t('common.cancel')}</button>
                <button type="button" onClick={runImport} disabled={busy || parsed.lines.length === 0} className={btnPrimary}>
                  {busy ? t('accounting.bankRec.importing') : t('accounting.bankRec.importCount', { count: parsed.lines.length })}
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}

      {report && !loading && (
        <>
          <Card title={t('accounting.bankRec.summaryTitle')}>
            <div className="max-w-xl">
              <table className="w-full">
                <tbody>
                  {[
                    [t('accounting.bankRec.bookBalance', { account: accountName(report.ledgerAccount.name) }), report.summary.bookBalance],
                    [t('accounting.bankRec.plusStatement'), report.summary.unmatchedStatement],
                    [t('accounting.bankRec.lessBook'), 0 - report.summary.unmatchedBook],
                  ].map(([label, value]) => (
                    <tr key={String(label)} className="border-t border-gray-100 first:border-0">
                      <td className={tdCls}>{label}</td>
                      <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{formatIDR(Number(value))}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-gray-300 font-semibold">
                    <td className={tdCls}>{t('accounting.bankRec.expected')}</td>
                    <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{formatIDR(report.summary.expectedStatementBalance)}</td>
                  </tr>
                  <tr className="border-t border-gray-100">
                    <td className={tdCls}>{t('accounting.bankRec.statementBalance')}</td>
                    <td className="px-3 py-1 text-right">
                      <MoneyInput allowNegative
                        value={statementBalance}
                        aria-label={t('accounting.bankRec.statementBalance')}
                        onChange={(e) => setStatementBalance(e.target.value)}
                        className={`${inputCls.replace('w-full ', '')} w-44 ml-auto text-right tabular-nums`}
                      />
                    </td>
                    <td className="py-1 pl-1">
                      <button
                        type="button"
                        onClick={saveStatementBalance}
                        disabled={
                          busy ||
                          report.lines.length === 0 ||
                          (typedBalance ?? null) === (report.summary.lastStatementBalance ?? null)
                        }
                        title={report.lines.length === 0 ? t('accounting.bankRec.balanceNeedsLine') : undefined}
                        className={btnPrimary}
                      >
                        <Save size={14} />
                        {t('common.save')}
                      </button>
                    </td>
                  </tr>
                  {difference != null && (
                    <tr className={`border-t border-gray-300 font-bold ${Math.abs(difference) < 0.005 ? 'text-green-700' : 'text-red-700'}`}>
                      <td className={tdCls}>{Math.abs(difference) < 0.005 ? t('accounting.bankRec.reconciled') : t('accounting.bankRec.difference')}</td>
                      <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{formatIDR(difference)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {t('accounting.bankRec.counts', { matched: report.summary.matched, unmatched: report.summary.unmatched, ignored: report.summary.ignored })}
            </p>
          </Card>

          <Card
            title={t('accounting.bankRec.statementTitle')}
            actions={
              report.lines.some((l) => l.status !== 'MATCHED') ? (
                <button type="button" onClick={clearOpen} disabled={busy} className={btnDanger}>
                  <Trash2 size={14} />
                  {t('accounting.bankRec.clearOpen')}
                </button>
              ) : undefined
            }
          >
            {report.lines.length === 0 && editing?.id !== 'new' ? (
              <p className="text-sm text-gray-400">{t('accounting.bankRec.noLines')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className={thCls}>{t('accounting.export.date')}</th>
                      <th className={thCls}>{t('accounting.export.description')}</th>
                      <th className={`${thCls} text-right`}>{t('accounting.cashFlow.cashIn')}</th>
                      <th className={`${thCls} text-right`}>{t('accounting.cashFlow.cashOut')}</th>
                      <th className={thCls}>{t('accounting.bankRec.statusCol')}</th>
                      <th className={thCls} />
                    </tr>
                  </thead>
                  <tbody>
                    {editing?.id === 'new' && editorRow('new-line')}
                    {report.lines.map((line) => {
                      const expanded = openLineId === line.id && line.status === 'UNMATCHED';
                      if (editing?.id === line.id) return editorRow(line.id);
                      return [
                        <tr key={line.id} className="border-t border-gray-100 align-top">
                          <td className={`${tdCls} whitespace-nowrap`}>{showDate(line.date)}</td>
                          <td className={tdCls}>
                            {line.description || '—'}
                            {line.matches.length > 0 && (
                              <span className="block text-xs text-gray-500">
                                {line.matches.map((m) => m.entryNumber ?? m.memo).join(', ')}
                              </span>
                            )}
                          </td>
                          <td className={`${tdCls} text-right tabular-nums`}>{line.amount > 0 ? formatIDR(line.amount) : ''}</td>
                          <td className={`${tdCls} text-right tabular-nums`}>{line.amount < 0 ? formatIDR(-line.amount) : ''}</td>
                          <td className={tdCls}>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_CLS[line.status]}`}>
                              {statusLabel(line.status)}
                            </span>
                          </td>
                          <td className={`${tdCls} text-right whitespace-nowrap`}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setEditing({
                                  id: line.id,
                                  date: line.date.slice(0, 10),
                                  description: line.description,
                                  amount: String(line.amount),
                                  matched: line.status === 'MATCHED',
                                })
                              }
                              className="inline-flex items-center gap-0.5 text-xs font-semibold text-gray-500 hover:text-blue-700 hover:underline mr-3"
                            >
                              <Pencil size={12} />
                              {t('common.edit')}
                            </button>
                            {line.status === 'UNMATCHED' && (
                              <div className="inline-flex gap-3 text-xs font-semibold">
                                <button
                                  type="button"
                                  onClick={() => (expanded ? setOpenLineId(null) : openLine(line, 'match'))}
                                  className="inline-flex items-center gap-0.5 text-blue-700 hover:underline"
                                >
                                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  {t('accounting.bankRec.work')}
                                </button>
                                <button type="button" disabled={busy} onClick={() => act(`/bank-reconciliation/lines/${line.id}/ignore`, { ignored: true })} className="text-gray-500 hover:underline">
                                  {t('accounting.bankRec.ignore')}
                                </button>
                              </div>
                            )}
                            {line.status === 'MATCHED' && (
                              <button type="button" disabled={busy} onClick={() => act(`/bank-reconciliation/lines/${line.id}/unmatch`)} className="text-xs font-semibold text-gray-500 hover:underline">
                                {t('accounting.bankRec.unmatch')}
                              </button>
                            )}
                            {line.status === 'IGNORED' && (
                              <button type="button" disabled={busy} onClick={() => act(`/bank-reconciliation/lines/${line.id}/ignore`, { ignored: false })} className="text-xs font-semibold text-gray-500 hover:underline">
                                {t('accounting.bankRec.restore')}
                              </button>
                            )}
                          </td>
                        </tr>,
                        expanded && (
                          <tr key={`${line.id}-work`} className="bg-blue-50/40">
                            <td colSpan={6} className="px-3 py-3">
                              <div className="flex gap-1.5 mb-3">
                                {(['match', 'record'] as const).map((m) => (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMode(m)}
                                    className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                                      mode === m ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-blue-50'
                                    }`}
                                  >
                                    {m === 'match' ? t('accounting.bankRec.tabMatch') : t('accounting.bankRec.tabRecord')}
                                  </button>
                                ))}
                              </div>
                              {mode === 'match' ? (
                                candidates.length === 0 ? (
                                  <p className="text-sm text-gray-500">{t('accounting.bankRec.noCandidates')}</p>
                                ) : (
                                  <>
                                    <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 bg-white border border-gray-200 rounded-md">
                                      {candidates.map((b) => (
                                        <li key={b.id}>
                                          <label className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                                            <input
                                              type="checkbox"
                                              checked={picked.includes(b.id)}
                                              onChange={(e) => setPicked((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))}
                                            />
                                            <span className="whitespace-nowrap text-gray-500">{showDate(b.date)}</span>
                                            <span className="min-w-0 flex-1 truncate">{b.memo ?? b.entryNumber}</span>
                                            <span className={`tabular-nums whitespace-nowrap ${Math.abs(b.amount - line.amount) < 0.005 ? 'font-semibold text-green-700' : ''}`}>
                                              {formatIDR(Math.abs(b.amount))}
                                            </span>
                                          </label>
                                        </li>
                                      ))}
                                    </ul>
                                    <div className="flex flex-wrap items-center justify-end gap-3 mt-3">
                                      <span className="text-xs text-gray-600">
                                        {t('accounting.bankRec.pickedTotal', { picked: formatIDR(Math.abs(pickedTotal)), target: formatIDR(Math.abs(line.amount)) })}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={busy || !canMatch}
                                        onClick={async () => {
                                          if (await act(`/bank-reconciliation/lines/${line.id}/match`, { journalEntryLineIds: picked })) setOpenLineId(null);
                                        }}
                                        className={btnPrimary}
                                      >
                                        {t('accounting.bankRec.match')}
                                      </button>
                                    </div>
                                  </>
                                )
                              ) : (
                                <div className="space-y-3">
                                  <p className="text-xs text-gray-500">{t('accounting.bankRec.recordHint')}</p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="block">
                                      <span className="text-xs font-semibold text-gray-600 block mb-1.5">{t('accounting.export.account')}</span>
                                      <select value={recordAccount} onChange={(e) => setRecordAccount(e.target.value)} className={inputCls}>
                                        <option value="">{t('accounting.bankRec.chooseAccount')}</option>
                                        {recordAccounts.map((a) => (
                                          <option key={a.id} value={a.id}>{a.code} · {accountName(a.name)}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="block">
                                      <span className="text-xs font-semibold text-gray-600 block mb-1.5">{t('accounting.export.description')}</span>
                                      <input value={recordMemo} maxLength={300} onChange={(e) => setRecordMemo(e.target.value)} className={inputCls} />
                                    </label>
                                  </div>
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      disabled={busy || !recordAccount}
                                      onClick={async () => {
                                        if (await act(`/bank-reconciliation/lines/${line.id}/record`, { accountId: recordAccount, memo: recordMemo })) setOpenLineId(null);
                                      }}
                                      className={btnPrimary}
                                    >
                                      {t('accounting.bankRec.record')}
                                    </button>
                                  </div>
                                </div>
                              )}
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

          <Card title={t('accounting.bankRec.bookTitle')}>
            <p className="text-xs text-gray-500 mb-3">{t('accounting.bankRec.bookHint')}</p>
            {report.bookLines.filter((b) => b.inPeriod).length === 0 ? (
              <p className="text-sm text-gray-400">{t('accounting.bankRec.noBookLines')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className={thCls}>{t('accounting.export.date')}</th>
                      <th className={thCls}>{t('accounting.export.entry')}</th>
                      <th className={thCls}>{t('accounting.export.description')}</th>
                      <th className={`${thCls} text-right`}>{t('accounting.cashFlow.cashIn')}</th>
                      <th className={`${thCls} text-right`}>{t('accounting.cashFlow.cashOut')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.bookLines.filter((b) => b.inPeriod).map((b) => (
                      <tr key={b.id} className="border-t border-gray-100">
                        <td className={`${tdCls} whitespace-nowrap`}>{showDate(b.date)}</td>
                        <td className={`${tdCls} whitespace-nowrap`}>{b.entryNumber ?? '—'}</td>
                        <td className={tdCls}>{b.memo ?? '—'}</td>
                        <td className={`${tdCls} text-right tabular-nums`}>{b.amount > 0 ? formatIDR(b.amount) : ''}</td>
                        <td className={`${tdCls} text-right tabular-nums`}>{b.amount < 0 ? formatIDR(-b.amount) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </PageFrame>
  );
}
