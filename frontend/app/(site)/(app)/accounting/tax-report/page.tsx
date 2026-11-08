'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { FileText, FileDown, Printer, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY, parseCalendarDate } from '@/lib/dates';
import { downloadExcel, fileNamePart, type ExcelCell, type ExcelSheet } from '@/lib/excel-export';
import { useLanguage } from '@/app/context/LanguageContext';
import { useBranches } from '@/lib/hooks/useBranches';
import { BranchFilter } from '@/app/components/shared/BranchFilter';
import { PageFrame, ErrorNote, btnPrimary, inputCls } from '@/app/components/shared/PageFrame';

type SaleLine = {
  name: string;
  sku: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  discount: number;
  net: number;
};
type Sale = {
  id: string;
  invoiceNumber: string | null;
  date: string;
  branch: string | null;
  branchNitku: string | null;
  customerId: string | null;
  customerName: string | null;
  customerNpwp: string | null;
  needsNpwp: boolean;
  customerAddress: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: 'ISSUED' | 'VOID';
  lastChangedAt: string | null;
  changedAfterPeriod: boolean;
  linesDiffer: boolean;
  items?: SaleLine[];
};
type SalesReturn = {
  id: string;
  date: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  memo: string | null;
  branch: string | null;
  customerId: string | null;
  customerName: string | null;
  customerNpwp: string | null;
  needsNpwp: boolean;
  amount: number;
};
type CustomerDepositRow = {
  id: string;
  date: string;
  depositNumber: string;
  branch: string | null;
  customerName: string;
  customerNpwp: string | null;
  needsNpwp: boolean;
  amount: number;
  voided: boolean;
};
type SupplierDepositRow = {
  id: string;
  date: string;
  depositNumber: string;
  branch: string | null;
  supplierId: string;
  supplierName: string;
  supplierNpwp: string | null;
  amount: number;
  voided: boolean;
};
type Purchase = {
  id: string;
  purchaseOrderId: string;
  date: string;
  billNumber: string;
  poNumber: string | null;
  branch: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierNpwp: string | null;
  amount: number;
  voided: boolean;
};
type PurchaseReturn = {
  id: string;
  purchaseOrderId: string;
  date: string;
  returnNumber: string | null;
  poNumber: string | null;
  branch: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierNpwp: string | null;
  amount: number;
};
type ExpenseRow = {
  id: string;
  date: string;
  branch: string | null;
  category: string;
  description: string | null;
  amount: number;
};
type Unassigned = { count: number; total: number };
type Report = {
  month: string;
  generatedAt: string;
  business: {
    name: string;
    legalName: string | null;
    npwp: string | null;
    address: string | null;
    pricesIncludePpn: boolean | null;
  };
  branch: { id: string; name: string; nitku: string | null } | null;
  sales: Sale[];
  salesReturns: SalesReturn[];
  customerDeposits: CustomerDepositRow[];
  purchases: Purchase[];
  purchaseReturns: PurchaseReturn[];
  supplierDeposits: SupplierDepositRow[];
  expenses: ExpenseRow[];
  summary: {
    sales: { count: number; subtotal: number; discount: number; tax: number; total: number };
    voidedInvoices: number;
    changedAfterPeriod: number;
    linesDiffer: number;
    salesReturns: { count: number; total: number };
    netSales: number;
    customerDeposits: { count: number; total: number };
    purchases: { count: number; total: number };
    purchaseReturns: { count: number; total: number };
    netPurchases: number;
    supplierDeposits: { count: number; total: number };
    expenses: { count: number; total: number };
  };
  notes: {
    customersMissingNpwp: number;
    suppliersMissingNpwp: number;
    receivedWithoutBill: { poNumber: string | null; supplierName: string | null }[];
    separateTaxpayers: { name: string; npwp: string | null }[];
    unassigned: { sales: Unassigned; purchases: Unassigned; purchaseReturns: Unassigned; expenses: Unassigned };
  };
};

// One definition per column, read by the screen, the printout and the Excel
// file alike, so the three can't drift apart.
type Column<T> = {
  key: string;
  label: string;
  // Text stays text in Excel, which keeps a 16-digit NPWP intact.
  value: (row: T) => string | number;
  money?: boolean;
  href?: (row: T) => string | null;
  warn?: (row: T) => boolean;
  nowrap?: boolean;
};
type Section<T> = {
  key: string;
  title: string;
  rows: T[];
  columns: Column<T>[];
  // Column key -> the section's total. Voided rows are already left out.
  totals: Record<string, number>;
  muted?: (row: T) => boolean;
};

const showDate = (date: string) => formatDMY(parseCalendarDate(date));

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ReportTable<T extends { id: string }>({ section, empty }: { section: Section<T>; empty: string }) {
  const { title, rows, columns, totals, muted } = section;
  const firstMoney = columns.findIndex((c) => c.money);
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="text-sm font-bold text-black mb-2">
        {title} <span className="font-normal text-gray-500">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">{empty}</p>
      ) : (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-300 text-left">
                {columns.map((c) => (
                  <th key={c.key} className={`py-1.5 px-1.5 font-semibold whitespace-nowrap ${c.money ? 'text-right' : ''}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={`border-b border-gray-200 ${muted?.(row) ? 'text-gray-400 line-through' : ''}`}>
                  {columns.map((c) => {
                    const value = c.value(row);
                    const warn = c.warn?.(row) ?? false;
                    const href = c.href?.(row) ?? null;
                    const text: ReactNode = c.money ? formatIDR(Number(value)) : value === '' ? '—' : value;
                    return (
                      <td
                        key={c.key}
                        className={`py-1 px-1.5 align-top ${c.money ? 'text-right whitespace-nowrap' : ''} ${c.nowrap ? 'whitespace-nowrap' : ''} ${
                          warn ? 'bg-amber-100 print:bg-transparent' : ''
                        }`}
                      >
                        {href ? (
                          <Link href={href} className="text-blue-700 hover:underline print:text-black print:no-underline">
                            {text}
                          </Link>
                        ) : (
                          text
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {firstMoney >= 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 font-semibold">
                  {columns.map((c, i) => (
                    <td key={c.key} className={`py-1.5 px-1.5 ${c.money ? 'text-right whitespace-nowrap' : ''}`}>
                      {c.key in totals ? formatIDR(totals[c.key]) : i === 0 ? 'Total' : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

export default function TaxReportPage() {
  const { t, language } = useLanguage();
  const { multiBranch } = useBranches();
  const [month, setMonth] = useState(lastMonth);
  const [branchId, setBranchId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = (lines: boolean) => {
    const params = new URLSearchParams({ month });
    if (branchId) params.set('branchId', branchId);
    if (lines) params.set('lines', 'true');
    return `/tax-report?${params}`;
  };

  useEffect(() => {
    if (!month) return;
    let stale = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(query(false));
        const body = await res.json().catch(() => null);
        if (stale) return;
        if (!res.ok) {
          setReport(null);
          setError(body?.message ?? t('accounting.taxReport.loadFailed'));
          return;
        }
        setReport(body);
      } catch {
        if (!stale) {
          setReport(null);
          setError(t('accounting.taxReport.serverError'));
        }
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
    // query() and t only read month, branchId and the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, branchId]);

  const periodLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-GB', {
      month: 'long',
      year: 'numeric',
    });
  };

  const pricesLabel = (value: boolean | null) =>
    value === null
      ? t('accounting.taxReport.pricesUnset')
      : value
        ? t('accounting.taxReport.pricesIncluded')
        : t('accounting.taxReport.pricesExcluded');

  // A branch column only says something when several branches are listed.
  const showBranch = multiBranch && !report?.branch;

  function buildSections(r: Report) {
    const col = (key: string) => t(`accounting.taxReport.col.${key}`);
    const date = { key: 'date', label: col('date') };
    const branch = showBranch
      ? [{ key: 'branch', label: col('branch'), value: (row: { branch: string | null }) => row.branch ?? '' }]
      : [];
    const walkIn = t('accounting.taxReport.walkIn');

    const sales: Section<Sale> = {
      key: 'sales',
      title: t('accounting.taxReport.sections.sales'),
      rows: r.sales,
      totals: {
        subtotal: r.summary.sales.subtotal,
        discount: r.summary.sales.discount,
        tax: r.summary.sales.tax,
        total: r.summary.sales.total,
      },
      muted: (s) => s.status === 'VOID',
      columns: [
        { ...date, value: (s) => showDate(s.date), nowrap: true },
        { key: 'invoice', label: col('invoice'), value: (s) => s.invoiceNumber ?? '', href: (s) => `/sales/invoices/${s.id}`, nowrap: true, warn: (s) => s.linesDiffer },
        ...branch,
        // In a branch's own report its NITKU is in the header instead.
        ...(r.sales.some((s) => s.branchNitku)
          ? [{ key: 'nitku', label: col('nitku'), value: (s: Sale) => s.branchNitku ?? '', nowrap: true }]
          : []),
        { key: 'customer', label: col('customer'), value: (s) => s.customerName ?? walkIn },
        { key: 'npwp', label: col('npwp'), value: (s) => s.customerNpwp ?? '', warn: (s) => s.needsNpwp && s.status !== 'VOID' },
        { key: 'address', label: col('address'), value: (s) => s.customerAddress ?? '' },
        { key: 'subtotal', label: col('subtotal'), value: (s) => s.subtotal, money: true },
        { key: 'discount', label: col('discount'), value: (s) => s.discount, money: true },
        // Only older or imported invoices still carry recorded tax.
        ...(r.summary.sales.tax > 0 || r.sales.some((s) => s.tax > 0)
          ? [{ key: 'tax', label: col('recordedTax'), value: (s: Sale) => s.tax, money: true }]
          : []),
        { key: 'total', label: col('total'), value: (s) => s.total, money: true },
        { key: 'status', label: col('status'), value: (s) => t(`accounting.taxReport.status.${s.status}`) },
        {
          key: 'lastChanged',
          label: col('lastChanged'),
          value: (s) => (s.lastChangedAt ? formatDMY(new Date(s.lastChangedAt)) : ''),
          warn: (s) => s.changedAfterPeriod,
        },
      ],
    };
    const salesReturns: Section<SalesReturn> = {
      key: 'salesReturns',
      title: t('accounting.taxReport.sections.salesReturns'),
      rows: r.salesReturns,
      totals: { amount: r.summary.salesReturns.total },
      columns: [
        { ...date, value: (x) => showDate(x.date) },
        {
          key: 'originalInvoice',
          label: col('originalInvoice'),
          value: (x) => x.invoiceNumber ?? x.memo ?? '',
          href: (x) => (x.invoiceId ? `/sales/invoices/${x.invoiceId}` : null),
        },
        ...branch,
        { key: 'customer', label: col('customer'), value: (x) => x.customerName ?? '' },
        { key: 'npwp', label: col('npwp'), value: (x) => x.customerNpwp ?? '', warn: (x) => x.needsNpwp },
        { key: 'amount', label: col('amount'), value: (x) => x.amount, money: true },
      ],
    };
    const customerDeposits: Section<CustomerDepositRow> = {
      key: 'customerDeposits',
      title: t('accounting.taxReport.sections.customerDeposits'),
      rows: r.customerDeposits,
      totals: { amount: r.summary.customerDeposits.total },
      muted: (d) => d.voided,
      columns: [
        { ...date, value: (d) => showDate(d.date), nowrap: true },
        { key: 'depositNumber', label: col('depositNumber'), value: (d) => d.depositNumber, nowrap: true },
        ...branch,
        { key: 'customer', label: col('customer'), value: (d) => d.customerName },
        { key: 'npwp', label: col('npwp'), value: (d) => d.customerNpwp ?? '', warn: (d) => d.needsNpwp && !d.voided },
        { key: 'amount', label: col('amount'), value: (d) => d.amount, money: true },
        { key: 'status', label: col('status'), value: (d) => t(`accounting.taxReport.status.${d.voided ? 'VOID' : 'ACTIVE'}`) },
      ],
    };
    const purchases: Section<Purchase> = {
      key: 'purchases',
      title: t('accounting.taxReport.sections.purchases'),
      rows: r.purchases,
      totals: { amount: r.summary.purchases.total },
      muted: (p) => p.voided,
      columns: [
        { ...date, value: (p) => showDate(p.date) },
        { key: 'bill', label: col('bill'), value: (p) => p.billNumber },
        { key: 'po', label: col('po'), value: (p) => p.poNumber ?? '', href: (p) => `/purchasing/purchase-orders/${p.purchaseOrderId}` },
        ...branch,
        { key: 'supplier', label: col('supplier'), value: (p) => p.supplierName ?? '' },
        { key: 'npwp', label: col('npwp'), value: (p) => p.supplierNpwp ?? '', warn: (p) => !!p.supplierId && !p.supplierNpwp && !p.voided },
        { key: 'amount', label: col('amount'), value: (p) => p.amount, money: true },
        { key: 'status', label: col('status'), value: (p) => t(`accounting.taxReport.status.${p.voided ? 'VOID' : 'ACTIVE'}`) },
      ],
    };
    const purchaseReturns: Section<PurchaseReturn> = {
      key: 'purchaseReturns',
      title: t('accounting.taxReport.sections.purchaseReturns'),
      rows: r.purchaseReturns,
      totals: { amount: r.summary.purchaseReturns.total },
      columns: [
        { ...date, value: (x) => showDate(x.date) },
        { key: 'return', label: col('returnNumber'), value: (x) => x.returnNumber ?? '' },
        { key: 'po', label: col('po'), value: (x) => x.poNumber ?? '', href: (x) => `/purchasing/purchase-orders/${x.purchaseOrderId}` },
        ...branch,
        { key: 'supplier', label: col('supplier'), value: (x) => x.supplierName ?? '' },
        { key: 'npwp', label: col('npwp'), value: (x) => x.supplierNpwp ?? '', warn: (x) => !!x.supplierId && !x.supplierNpwp },
        { key: 'amount', label: col('amount'), value: (x) => x.amount, money: true },
      ],
    };
    const supplierDeposits: Section<SupplierDepositRow> = {
      key: 'supplierDeposits',
      title: t('accounting.taxReport.sections.supplierDeposits'),
      rows: r.supplierDeposits,
      totals: { amount: r.summary.supplierDeposits.total },
      muted: (d) => d.voided,
      columns: [
        { ...date, value: (d) => showDate(d.date), nowrap: true },
        { key: 'depositNumber', label: col('depositNumber'), value: (d) => d.depositNumber, nowrap: true },
        ...branch,
        { key: 'supplier', label: col('supplier'), value: (d) => d.supplierName },
        { key: 'npwp', label: col('npwp'), value: (d) => d.supplierNpwp ?? '', warn: (d) => !d.supplierNpwp && !d.voided },
        { key: 'amount', label: col('amount'), value: (d) => d.amount, money: true },
        { key: 'status', label: col('status'), value: (d) => t(`accounting.taxReport.status.${d.voided ? 'VOID' : 'ACTIVE'}`) },
      ],
    };
    const expenses: Section<ExpenseRow> = {
      key: 'expenses',
      title: t('accounting.taxReport.sections.expenses'),
      rows: r.expenses,
      totals: { amount: r.summary.expenses.total },
      columns: [
        { ...date, value: (e) => showDate(e.date) },
        ...branch,
        { key: 'category', label: col('category'), value: (e) => e.category },
        { key: 'description', label: col('description'), value: (e) => e.description ?? '' },
        { key: 'amount', label: col('amount'), value: (e) => e.amount, money: true },
      ],
    };
    return { sales, salesReturns, customerDeposits, purchases, purchaseReturns, supplierDeposits, expenses };
  }

  const summaryRows = (r: Report): { label: string; count: number | null; amount: number; strong?: boolean }[] => [
    { label: t('accounting.taxReport.sections.sales'), count: r.summary.sales.count, amount: r.summary.sales.total },
    { label: t('accounting.taxReport.sections.salesReturns'), count: r.summary.salesReturns.count, amount: 0 - r.summary.salesReturns.total },
    { label: t('accounting.taxReport.summary.netSales'), count: null, amount: r.summary.netSales, strong: true },
    { label: t('accounting.taxReport.sections.customerDeposits'), count: r.summary.customerDeposits.count, amount: r.summary.customerDeposits.total },
    { label: t('accounting.taxReport.sections.purchases'), count: r.summary.purchases.count, amount: r.summary.purchases.total },
    { label: t('accounting.taxReport.sections.purchaseReturns'), count: r.summary.purchaseReturns.count, amount: 0 - r.summary.purchaseReturns.total },
    { label: t('accounting.taxReport.summary.netPurchases'), count: null, amount: r.summary.netPurchases, strong: true },
    { label: t('accounting.taxReport.sections.supplierDeposits'), count: r.summary.supplierDeposits.count, amount: r.summary.supplierDeposits.total },
    { label: t('accounting.taxReport.sections.expenses'), count: r.summary.expenses.count, amount: r.summary.expenses.total, strong: true },
  ];

  // Notes that bear on whether the numbers are complete, so they print too.
  const reportNotes = (r: Report): string[] => {
    const notes: string[] = [];
    if (r.notes.separateTaxpayers.length > 0) {
      notes.push(
        t('accounting.taxReport.notes.separateTaxpayers', {
          list: r.notes.separateTaxpayers.map((b) => `${b.name} (${b.npwp})`).join(', '),
        }),
      );
    }
    if (r.summary.voidedInvoices > 0) {
      notes.push(t('accounting.taxReport.notes.voided', { count: r.summary.voidedInvoices }));
    }
    if (r.summary.changedAfterPeriod > 0) {
      notes.push(t('accounting.taxReport.notes.changedAfter', { count: r.summary.changedAfterPeriod }));
    }
    if (r.summary.customerDeposits.count > 0 || r.summary.supplierDeposits.count > 0) {
      notes.push(t('accounting.taxReport.notes.customerDeposits'));
    }
    if (r.summary.linesDiffer > 0) {
      notes.push(t('accounting.taxReport.notes.linesDiffer', { count: r.summary.linesDiffer }));
    }
    if (r.notes.receivedWithoutBill.length > 0) {
      notes.push(
        t('accounting.taxReport.notes.receivedWithoutBill', {
          count: r.notes.receivedWithoutBill.length,
          list: r.notes.receivedWithoutBill.map((p) => p.poNumber ?? '—').join(', '),
        }),
      );
    }
    const u = r.notes.unassigned;
    const loose: [string, Unassigned][] = [
      [t('accounting.taxReport.sections.sales'), u.sales],
      [t('accounting.taxReport.sections.purchases'), u.purchases],
      [t('accounting.taxReport.sections.purchaseReturns'), u.purchaseReturns],
      [t('accounting.taxReport.sections.expenses'), u.expenses],
    ];
    for (const [section, { count, total }] of loose) {
      if (count > 0) {
        notes.push(t('accounting.taxReport.notes.unassigned', { section, count, total: formatIDR(total) }));
      }
    }
    return notes;
  };

  async function handleDownloadExcel() {
    setDownloading(true);
    setError(null);
    try {
      const res = await apiFetch(query(true));
      const r: Report | null = await res.json().catch(() => null);
      if (!res.ok || !r) {
        setError(t('accounting.taxReport.loadFailed'));
        return;
      }
      const sheets: ExcelSheet[] = [];
      const addSheet = (name: string, rows: ExcelCell[][], money: number[], widths: number[]) =>
        sheets.push({ name, rows, money, widths });

      const titleRows: ExcelCell[][] = [
        [t('accounting.taxReport.title')],
        [r.business.legalName || r.business.name],
        [t('accounting.taxReport.col.npwp'), r.business.npwp ?? ''],
        ...(r.branch?.nitku ? [[t('accounting.taxReport.col.nitku'), r.branch.nitku]] : []),
        [t('accounting.taxReport.col.address'), r.business.address ?? ''],
        [t('accounting.taxReport.period'), periodLabel(r.month)],
        [t('accounting.taxReport.scope'), r.branch?.name ?? t('accounting.taxReport.wholeBusiness')],
        [t('accounting.taxReport.pricesLabel'), pricesLabel(r.business.pricesIncludePpn)],
        [],
      ];
      const summary = summaryRows(r).map((s) => [s.label, s.amount, s.count ?? '']);
      const notes = reportNotes(r);
      addSheet(
        t('accounting.taxReport.summary.title'),
        [
          ...titleRows,
          [t('accounting.taxReport.summary.section'), t('accounting.taxReport.col.amount'), t('accounting.taxReport.summary.count')],
          ...summary,
          ...(notes.length ? [[], [t('accounting.taxReport.notes.title')], ...notes.map((n) => [n])] : []),
          [],
          [t('accounting.taxReport.disclaimer')],
        ],
        [1],
        [28, 22, 10],
      );

      const addSection = <T extends { id: string }>(section: Section<T>) => {
        const header = section.columns.map((c) => c.label);
        const body = section.rows.map((row) => section.columns.map((c) => c.value(row)));
        const footer = section.columns.map((c, i) => (c.key in section.totals ? section.totals[c.key] : i === 0 ? 'Total' : ''));
        addSheet(
          section.title,
          [header, ...body, footer],
          section.columns.flatMap((c, i) => (c.money ? [i] : [])),
          section.columns.map((c) => (c.money ? 16 : c.key === 'address' || c.key === 'description' ? 36 : c.key === 'npwp' ? 20 : 18)),
        );
      };
      const sections = buildSections(r);
      addSection(sections.sales);

      // What Coretax needs per faktur: each issued invoice's lines.
      const lineHeader = ['date', 'invoice', 'customer', 'npwp', 'item', 'sku', 'unit', 'quantity', 'unitPrice', 'subtotal', 'discount', 'net'].map(
        (k) => t(`accounting.taxReport.col.${k}`),
      );
      const lineRows = r.sales.flatMap((s) =>
        (s.items ?? []).map((l) => [
          showDate(s.date),
          s.invoiceNumber ?? '',
          s.customerName ?? t('accounting.taxReport.walkIn'),
          s.customerNpwp ?? '',
          l.name,
          l.sku ?? '',
          l.unit ?? '',
          l.quantity,
          l.unitPrice,
          l.lineTotal,
          l.discount,
          l.net,
        ]),
      );
      addSheet(t('accounting.taxReport.sections.salesLines'), [lineHeader, ...lineRows], [8, 9, 10, 11], [12, 18, 24, 20, 36, 14, 8, 8, 14, 14, 14, 14]);

      addSection(sections.salesReturns);
      addSection(sections.customerDeposits);
      addSection(sections.purchases);
      addSection(sections.purchaseReturns);
      addSection(sections.supplierDeposits);
      addSection(sections.expenses);

      const scope = r.branch ? `-${fileNamePart(r.branch.name)}` : '';
      await downloadExcel({ fileName: `laporan-pajak-${r.month}${scope}.xlsx`, sheets });
    } catch {
      setError(t('accounting.taxReport.serverError'));
    } finally {
      setDownloading(false);
    }
  }

  const sections = useMemo(
    () => (report ? buildSections(report) : null),
    // buildSections only reads the report, the branch column choice and the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report, showBranch, language],
  );
  const notes = report ? reportNotes(report) : [];
  const empty = t('accounting.taxReport.noRows');

  return (
    <PageFrame
      icon={FileText}
      title={t('accounting.taxReport.title')}
      subtitle={t('accounting.taxReport.subtitle')}
    >
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body * { visibility: hidden; }
          #tax-report-print, #tax-report-print * { visibility: visible; }
          #tax-report-print { position: absolute; top: 0; left: 0; width: 100%; }
          #tax-report-print a { color: inherit; text-decoration: none; }
          #tax-report-print thead { display: table-header-group; }
          #tax-report-print tfoot { display: table-row-group; }
          #tax-report-print tr { break-inside: avoid; }
        }
      `}</style>

      {/* Filters in a row above the report, like the balance sheet and profit & loss. */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 print:hidden">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600 block mb-1.5">{t('accounting.taxReport.period')}</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} />
        </label>
        <BranchFilter
          value={branchId}
          onChange={setBranchId}
          selectClassName="text-sm border border-blue-500/20 rounded-lg px-2.5 py-2 bg-white outline-none focus:border-blue-500/50"
        />
        <div className="sm:ml-auto flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!report || loading}
          className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-blue-500/20 text-blue-700 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-medium"
        >
          <Printer size={16} strokeWidth={2} />
          {t('accounting.taxReport.print')}
        </button>
        <button type="button" onClick={handleDownloadExcel} disabled={!report || loading || downloading} className={`${btnPrimary} inline-flex items-center gap-2`}>
          <FileDown size={16} strokeWidth={2} />
          {downloading ? t('accounting.taxReport.downloading') : t('accounting.taxReport.downloadExcel')}
        </button>
        </div>
      </div>

      <ErrorNote message={error} />
      {loading && !report && <p className="text-sm text-gray-500">{t('accounting.taxReport.loading')}</p>}

      {report && sections && (
        <>
          {(!report.business.npwp || report.business.pricesIncludePpn === null || report.notes.customersMissingNpwp > 0 || report.notes.suppliersMissingNpwp > 0) && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:hidden">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} strokeWidth={2} />
                {t('accounting.taxReport.fixTitle')}
              </p>
              <ul className="mt-1.5 ml-6 list-disc space-y-0.5">
                {(!report.business.npwp || report.business.pricesIncludePpn === null) && (
                  <li>
                    {!report.business.npwp && t('accounting.taxReport.fix.businessNpwp')}{' '}
                    {report.business.pricesIncludePpn === null && t('accounting.taxReport.fix.prices')}{' '}
                    <Link href="/settings" className="underline font-medium">
                      {t('accounting.taxReport.fix.openSettings')}
                    </Link>
                  </li>
                )}
                {report.notes.customersMissingNpwp > 0 && (
                  <li>{t('accounting.taxReport.fix.customers', { count: report.notes.customersMissingNpwp })}</li>
                )}
                {report.notes.suppliersMissingNpwp > 0 && (
                  <li>{t('accounting.taxReport.fix.suppliers', { count: report.notes.suppliersMissingNpwp })}</li>
                )}
              </ul>
            </div>
          )}

          <div
            id="tax-report-print"
            className={`bg-white border border-blue-500/15 rounded-xl p-4 sm:p-6 shadow-sm print:border-0 print:shadow-none print:p-0 ${loading ? 'opacity-60' : ''}`}
          >
            <header className="border-b-2 border-gray-300 pb-3 mb-4 flex flex-wrap justify-between gap-3">
              <div>
                <p className="text-base font-bold text-black">{report.business.legalName || report.business.name}</p>
                <p className="text-xs text-black">
                  {t('accounting.taxReport.col.npwp')}: {report.business.npwp || '—'}
                </p>
                {report.branch?.nitku && (
                  <p className="text-xs text-black">
                    {t('accounting.taxReport.col.nitku')}: {report.branch.nitku}
                  </p>
                )}
                {report.business.address && <p className="text-xs text-black">{report.business.address}</p>}
              </div>
              <div className="sm:text-right">
                <p className="text-base font-bold text-black">{t('accounting.taxReport.title')}</p>
                <p className="text-xs text-black">
                  {t('accounting.taxReport.period')}: {periodLabel(report.month)}
                </p>
                <p className="text-xs text-black">
                  {t('accounting.taxReport.scope')}: {report.branch?.name ?? t('accounting.taxReport.wholeBusiness')}
                </p>
                <p className="text-xs font-semibold text-black">
                  {t('accounting.taxReport.pricesLabel')}: {pricesLabel(report.business.pricesIncludePpn)}
                </p>
              </div>
            </header>

            <section className="mb-6">
              <h2 className="text-sm font-bold text-black mb-2">{t('accounting.taxReport.summary.title')}</h2>
              <table className="w-full max-w-xl text-xs border-collapse">
                <tbody>
                  {summaryRows(report).map((row) => (
                    <tr key={row.label} className={`border-b border-gray-200 ${row.strong ? 'font-semibold' : ''}`}>
                      <td className="py-1 px-1.5">{row.label}</td>
                      <td className="py-1 px-1.5 text-right text-gray-500">{row.count ?? ''}</td>
                      <td className="py-1 px-1.5 text-right whitespace-nowrap">{formatIDR(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {notes.length > 0 && (
                <ul className="mt-3 ml-4 list-disc space-y-0.5 text-xs text-black">
                  {notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </section>

            <ReportTable section={sections.sales} empty={empty} />
            <ReportTable section={sections.salesReturns} empty={empty} />
            <ReportTable section={sections.customerDeposits} empty={empty} />
            <ReportTable section={sections.purchases} empty={empty} />
            <ReportTable section={sections.purchaseReturns} empty={empty} />
            <ReportTable section={sections.supplierDeposits} empty={empty} />
            <ReportTable section={sections.expenses} empty={empty} />

            <p className="mt-6 pt-3 border-t border-gray-200 text-[11px] text-gray-500">{t('accounting.taxReport.disclaimer')}</p>
          </div>
        </>
      )}
    </PageFrame>
  );
}
