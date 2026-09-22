'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Receipt, Printer, Wallet, Bell, X, Download, Pencil, Truck, History, AlertCircle, Ban, Lock } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });
import { useHasModule } from '@/lib/hooks/useHasModule';
import { RecordPaymentDialog } from '@/app/components/invoices/RecordPaymentDialog';
import { VoidInvoiceDialog } from '@/app/components/invoices/VoidInvoiceDialog';
import { InvoicePrintArea } from '@/app/components/invoices/templates/InvoicePrintArea';
import { InvoiceFormat } from '@/app/components/invoices/types';
import { InvoicePrintView, toInvoiceView } from '@/lib/mappers/invoice-mapper';
import { parseCalendarDate, toCalendarDateString } from '@/lib/dates';
import { PAGE_CSS, MARGIN_MM } from '@/lib/mappers/invoice-format';
import { useLanguage } from '@/app/context/LanguageContext';
type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

// NEW — mirrors InvoicePrintView.fulfillmentStatus / InvoiceItem.fulfilledQuantity
// added on the backend. See 07-frontend-type-patches.md for where this
// needs to be declared in lib/invoice-mapper.ts.
type FulfillmentStatus = 'UNFULFILLED' | 'PARTIALLY_FULFILLED' | 'FULFILLED';

type InvoiceActivityEventType = 'CREATED' | 'ISSUED' | 'EDITED' | 'PAYMENT_RECORDED' | 'MARKED_PAID' | 'VOIDED';

type ActivityEntry = {
  id: string;
  eventType: InvoiceActivityEventType;
  reason: string | null;
  oldTotal: number | null;
  newTotal: number | null;
  changes: { label: string; before: string; after: string }[] | null;
  createdAt: string;
  user?: { email: string } | null;
};

const ACTIVITY_LABEL_KEY: Record<InvoiceActivityEventType, string> = {
  CREATED: 'sales.invoiceDetail.activityCreated',
  ISSUED: 'sales.invoiceDetail.activityIssued',
  EDITED: 'sales.invoiceDetail.activityEdited',
  PAYMENT_RECORDED: 'sales.invoiceDetail.activityPaymentRecorded',
  MARKED_PAID: 'sales.invoiceDetail.activityMarkedPaid',
  VOIDED: 'sales.invoiceDetail.activityVoided',
};

const FORMAT_OPTIONS: { value: InvoiceFormat; label: string }[] = [
  { value: 'THERMAL_58', label: '58mm' },
  { value: 'RECEIPT', label: '80mm' },
  { value: 'A5', label: 'A5' },
  { value: 'A4', label: 'A4' },
];

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

type FiscalPeriod = { year: number; month: number; status: 'OPEN' | 'CLOSED' | 'LOCKED' };

// Mirrors the backend's own period resolution (getOrCreateOpenFiscalPeriod
// reads UTC year/month off the business date used when posting the
// invoice's journal entry — invoiceDate, falling back to issuedAt). A
// period with no FiscalPeriod row yet is implicitly OPEN — it's only
// created lazily the first time something posts into it.
function invoicePeriodStatus(invoice: InvoicePrintView | null, periods: FiscalPeriod[] | null): FiscalPeriod | null {
  if (!invoice || !periods) return null;
  const dateStr = invoice.invoiceDate ?? invoice.issuedAt;
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return periods.find((p) => p.year === year && p.month === month) ?? { year, month, status: 'OPEN' };
}

function isOverdue(invoice: InvoicePrintView | null): boolean {
  if (!invoice) return false;
  if (invoice.status !== 'ISSUED') return false;
  if (invoice.paymentStatus === 'PAID') return false;
  if (!invoice.dueDate) return false;

  const due = parseCalendarDate(invoice.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { t } = useLanguage();
  const style =
    status === 'PAID'
      ? 'border-green-600 text-green-700'
      : status === 'PARTIAL'
        ? 'border-amber-600 text-amber-700'
        : 'border-red-600 text-red-700';
  const label =
    status === 'PAID'
      ? t('sales.invoiceDetail.paymentBadgePaid')
      : status === 'PARTIAL'
        ? t('sales.invoiceDetail.paymentBadgePartial')
        : t('sales.invoiceDetail.paymentBadgeUnpaid');
  return (
    <span className={`inline-block border-2 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${style}`}>
      {label}
    </span>
  );
}

// NEW — surfaces InvoicePrintView.fulfillmentStatus. Renders nothing once
// fully fulfilled, so it doesn't clutter the header for the common case.
function FulfillmentBadge({ status }: { status: FulfillmentStatus }) {
  const { t } = useLanguage();
  if (status === 'FULFILLED') return null;
  return (
    <span className="inline-flex items-center gap-1 border-2 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide border-amber-600 text-amber-700 bg-amber-50">
      <Truck size={11} strokeWidth={2} />
      {status === 'PARTIALLY_FULFILLED' ? t('sales.invoiceDetail.fulfillmentPartial') : t('sales.invoiceDetail.fulfillmentBackordered')}
    </span>
  );
}

function OverdueBadge() {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1 border-2 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide border-red-600 text-red-700 bg-red-50">
      <AlertCircle size={11} strokeWidth={2} />
      {t('sales.invoiceDetail.overdueBadge')}
    </span>
  );
}

// NEW — proactive disclosure: a closed/locked period blocks void and edit
// on the backend (journal.service.ts's fiscal-period check), but the user
// previously only learned that after submitting. Surfacing it here means
// they see it before they even open the Void dialog.
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function ClosedPeriodBadge({ period }: { period: FiscalPeriod }) {
  const { t, language } = useLanguage();
  const monthNames = language === 'id' ? MONTH_NAMES_ID : MONTH_NAMES_EN;
  const statusLabel =
    period.status === 'CLOSED'
      ? t('sales.invoiceDetail.periodStatusClosed')
      : period.status === 'LOCKED'
        ? t('sales.invoiceDetail.periodStatusLocked')
        : period.status.toLowerCase();
  return (
    <span className="inline-flex items-center gap-1 border-2 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide border-gray-400 text-gray-600 bg-gray-100">
      <Lock size={11} strokeWidth={2} />
      {monthNames[period.month - 1]} {period.year} {statusLabel}
    </span>
  );
}

// NEW — same status→style mapping already used on the delivery order
// detail page, duplicated here rather than shared since there's no
// existing shared-components import path visible for it. Worth lifting
// into a shared util if this page and the delivery-order page keep
// needing to stay in sync.
function doStatusStyle(status: string) {
  switch (status) {
    case 'PACKED':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'SHIPPED':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
}

export default function InvoiceDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');
  const hasWarehouseOps = useHasModule('WAREHOUSE_OPS');
  const { t, language } = useLanguage();

  const [invoice, setInvoice] = useState<InvoicePrintView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriod[] | null>(null);

  // Reprint format — defaults to whatever the invoice was actually issued
  // as, but is a local, non-persisted override: picking A4 here reprints
  // (and now previews) this invoice on A4 paper without changing
  // invoice.format in the DB.
  const [printFormat, setPrintFormat] = useState<InvoiceFormat>('RECEIPT');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [voidingPaymentId, setVoidingPaymentId] = useState<string | null>(null);

  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderNote, setReminderNote] = useState('');
  const [reminderDueDate, setReminderDueDate] = useState('');
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderSaved, setReminderSaved] = useState(false);
  const [reminderError, setReminderError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, historyRes, periodsRes] = await Promise.all([
        apiFetch(`/invoices/${params.id}`),
        apiFetch(`/sales/invoices/${params.id}/edit-history`),
        apiFetch('/accounting/fiscal-periods'),
      ]);
      if (!invRes.ok) {
        const body = await invRes.json().catch(() => null);
        setError(body?.message ?? t('sales.invoiceDetail.failedToLoadInvoice', { status: invRes.status }));
        return;
      }
      const data = await invRes.json();
      setInvoice(data);
      setPrintFormat(data.format);

      if (historyRes.ok) {
        setActivity(await historyRes.json());
      }
      if (periodsRes.ok) {
        setPeriods(await periodsRes.json());
      }
    } catch {
      setError(t('sales.invoiceDetail.serverUnreachable'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  function pickReminderPreset(months: number) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setReminderDueDate(toCalendarDateString(d));
    setReminderSaved(false);
  }

  async function saveReminder() {
    if (!invoice?.vehicleId || !reminderNote.trim() || !reminderDueDate) return;
    setReminderSaving(true);
    setReminderError('');
    try {
      const res = await apiFetch(`/vehicles/${invoice.vehicleId}/reminders`, {
        method: 'POST',
        body: JSON.stringify({
          note: reminderNote.trim(),
          dueDate: reminderDueDate,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || t('sales.invoiceDetail.failedToSaveReminder', { status: res.status }));
      }
      setReminderSaved(true);
      setReminderNote('');
      setReminderDueDate('');
    } catch (e: any) {
      setReminderError(e.message || t('sales.invoiceDetail.reminderSaveFailed'));
    } finally {
      setReminderSaving(false);
    }
  }

  // CHANGED — now matches the quotation detail page's handlePrint:
  // just triggers the native browser print dialog against #print-area,
  // instead of fetching and downloading a PDF (that's handleDownloadPdf's
  // job now).
  function handlePrint() {
    window.print();
  }

  async function handleConvertToDeliveryOrder() {
    if (!invoice) return;
    setActionLoading('convert-do');
    setError(null);
    try {
      const res = await apiFetch(`/delivery-orders/from-invoice/${invoice.id}`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('sales.invoiceDetail.requestFailed', { status: res.status }));
        return;
      }
      if (body?.id) {
        router.push(`/sales/delivery-orders/${body.id}`);
      }
    } catch {
      setError(t('sales.invoiceDetail.serverUnreachable'));
    } finally {
      setActionLoading(null);
    }
  }
  async function handleVoidPayment(paymentId: string, amount: number) {
    if (!invoice) return;
    const reason = window.prompt(t('sales.invoiceDetail.voidPaymentPrompt', { amount: formatIDR(amount) }));
    if (reason === null) return; // cancelled
    setVoidingPaymentId(paymentId);
    setError(null);
    try {
      const res = await apiFetch(`/invoices/${invoice.id}/payments/${paymentId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('sales.invoiceDetail.requestFailed', { status: res.status }));
        return;
      }
      await load();
    } catch {
      setError(t('sales.invoiceDetail.serverUnreachable'));
    } finally {
      setVoidingPaymentId(null);
    }
  }

  async function handleDownloadPdf() {
    if (!invoice) return;
    setPdfGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(`/invoices/${invoice.id}/pdf?format=${printFormat}`);
      if (!res.ok) {
        throw new Error(t('sales.invoiceDetail.failedToGeneratePdf', { status: res.status }));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoiceNumber ?? 'invoice'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || t('sales.invoiceDetail.couldNotGeneratePdf'));
    } finally {
      setPdfGenerating(false);
    }
  }

  const total = invoice ? Number(invoice.total) : 0;
  const amountPaid = invoice ? Number(invoice.amountPaid) : 0;
  const creditedAmount = invoice ? Number(invoice.creditedAmount) : 0;
  // FIX — was total - amountPaid, so a returned invoice kept showing a
  // balance due for units the customer no longer owes for.
  const balanceDue = Math.max(total - amountPaid - creditedAmount, 0);
  const overdue = isOverdue(invoice);
  const period = invoicePeriodStatus(invoice, periods);
  const periodClosed = period?.status === 'CLOSED' || period?.status === 'LOCKED';

  return (
    <main className="min-h-screen print:min-h-0 bg-gray-50 text-black">
      <style>{`
  ${PAGE_CSS[printFormat] ?? PAGE_CSS.A4}
  @media print {
    body * { visibility: hidden; }
    #print-area, #print-area * { visibility: visible; }
    #print-area {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
    }
  }
`}</style>

      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)] print:hidden">
        <div className="max-w-5xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Receipt size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div>
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight`}>
                  {invoice?.invoiceNumber ?? t('sales.invoiceDetail.invoiceFallback')}
                </h1>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <p className="text-xs text-gray-500">
                    {invoice
                      ? invoice.status === 'DRAFT'
                        ? t('sales.invoicesList.statusDraftBadge')
                        : invoice.status === 'ISSUED'
                          ? t('sales.invoicesList.statusIssuedBadge')
                          : t('sales.invoicesList.statusVoidBadge')
                      : '\u00A0'}
                  </p>
                  {invoice && <PaymentBadge status={invoice.paymentStatus} />}
                  {invoice && <FulfillmentBadge status={invoice.fulfillmentStatus} />}
                  {overdue && <OverdueBadge />}
                  {periodClosed && period && <ClosedPeriodBadge period={period} />}
                </div>
                {invoice?.invoiceDate && (
                  <p className="text-xs text-gray-500 mt-1">
                    {t('sales.invoiceDetail.invoiceDateLabel')} {parseCalendarDate(invoice.invoiceDate).toLocaleDateString('id-ID')}
                    {invoice.issuedAt && (
                      <span className="text-gray-400">
                        {' '}· {t('sales.invoiceDetail.issuedLabel')} {new Date(invoice.issuedAt).toLocaleDateString('id-ID')}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>

          {invoice && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center bg-gray-100 rounded-md p-1 text-sm font-medium">
                {FORMAT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPrintFormat(opt.value)}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      printFormat === opt.value ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-black'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {invoice.status === 'ISSUED' &&
                invoice.paymentStatus === 'UNPAID' &&
                 (
                  <button
                    onClick={() => router.push(`/sales/invoices/${invoice.id}/edit`)}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 h-fit transition-colors"
                  >
                    <Pencil size={16} strokeWidth={2} />
                    {t('common.edit')}
                  </button>
                )}

              {invoice.status === 'ISSUED' && invoice.paymentStatus === 'UNPAID' && (
                <button
                  onClick={() => setVoidDialogOpen(true)}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-700 font-semibold hover:bg-red-50 h-fit"
                >
                  <Ban size={16} strokeWidth={2} />
                  {t('sales.invoiceDetail.void')}
                </button>
              )}

              {/* CHANGED — was `invoice.deliveryOrders.length === 0`, which only
                  worked under the old one-shot model. createFromInvoice() can now be
                  called repeatedly as backorders get fulfilled in batches, so this
                  needs to key off whether there's still outstanding demand, not
                  whether a delivery order has ever been created before. */}
              {invoice.status === 'ISSUED' && !invoice.salesOrderId && invoice.fulfillmentStatus !== 'FULFILLED' && (
                <button
                  disabled={actionLoading === 'convert-do'}
                  onClick={handleConvertToDeliveryOrder}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 h-fit disabled:opacity-50 transition-colors"
                >
                  <Truck size={16} strokeWidth={2} />
                  {actionLoading === 'convert-do' ? t('sales.invoiceDetail.converting') : t('sales.invoiceDetail.convertToDeliveryOrder')}
                </button>
              )}

              {balanceDue > 0 && invoice.status !== 'VOID' && (
                <button
                  onClick={() => setPaymentDialogOpen(true)}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 h-fit transition-colors"
                >
                  <Wallet size={16} strokeWidth={2} />
                  {t('sales.invoiceDetail.recordPayment')}
                </button>
              )}
              <button
                onClick={handleDownloadPdf}
                disabled={pdfGenerating}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 h-fit disabled:opacity-50 transition-colors"
              >
                <Download size={16} strokeWidth={2} />
                {pdfGenerating ? t('sales.invoiceDetail.generatingPdf') : t('sales.invoiceDetail.downloadPdf')}
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 h-fit transition-colors"
              >
                <Printer size={16} strokeWidth={2} />
                {t('common.print')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 print:hidden">
        {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
            {error}
          </p>
        )}

        {invoice && (
          <>
            {overdue && (
              <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm mb-4">
                <AlertCircle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
                <span>
                  {t('sales.invoiceDetail.overdueNotice', {
                    date: invoice.dueDate ? parseCalendarDate(invoice.dueDate).toLocaleDateString('id-ID') : '',
                  })}
                </span>
              </div>
            )}

            {invoice.employeeName && (
              <p className="text-xs text-gray-500 mb-4">
                {t('sales.invoiceDetail.soldBy')} <span className="font-medium text-gray-800">{invoice.employeeName}</span>
              </p>
            )}

            {hasWorkshopRms && invoice.vehicleId && (
              <div className="border-2 border-gray-300 bg-white rounded-md p-3 mb-4">
                <p className="text-xs text-gray-500 mb-2">
                  {t('sales.invoiceDetail.vehicleLabel')} <span className="font-medium text-gray-800">{invoice.vehiclePlateNumber} · {invoice.vehicleModel}</span>
                  {invoice.vehicleVin && <span> · {t('sales.invoiceDetail.vinLabel', { vin: invoice.vehicleVin })}</span>}
                  {invoice.vehicleOdometer != null && <span> · {t('sales.invoiceDetail.odometerKm', { odometer: invoice.vehicleOdometer })}</span>}
                </p>
                {!reminderOpen ? (
                  <button
                    onClick={() => setReminderOpen(true)}
                    className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-blue-700 transition-colors"
                  >
                    <Bell size={14} strokeWidth={2} />
                    {t('sales.invoiceDetail.setReminderFor', { plate: invoice.vehiclePlateNumber ?? '', model: invoice.vehicleModel ?? '' })}
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                        <Bell size={12} strokeWidth={2} />
                        {t('sales.invoiceDetail.reminderFor', { plate: invoice.vehiclePlateNumber ?? '', model: invoice.vehicleModel ?? '' })}
                      </span>
                      <button onClick={() => setReminderOpen(false)} className="text-gray-400 hover:text-blue-700">
                        <X size={14} strokeWidth={2} />
                      </button>
                    </div>

                    <textarea
                      value={reminderNote}
                      onChange={(e) => setReminderNote(e.target.value)}
                      placeholder={t('sales.invoiceDetail.reminderPlaceholder')}
                      rows={2}
                      className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 resize-none mb-2"
                    />

                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {[
                        { label: t('sales.invoiceDetail.preset1Month'), months: 1 },
                        { label: t('sales.invoiceDetail.preset2Months'), months: 2 },
                        { label: t('sales.invoiceDetail.preset3Months'), months: 3 },
                        { label: t('sales.invoiceDetail.preset6Months'), months: 6 },
                      ].map((preset) => (
                        <button
                          key={preset.months}
                          onClick={() => pickReminderPreset(preset.months)}
                          className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-blue-500/50 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <input
                      type="date"
                      value={reminderDueDate}
                      onChange={(e) => setReminderDueDate(e.target.value)}
                      className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 mb-2"
                    />

                    {reminderError && <p className="text-xs text-red-600 mb-2">{reminderError}</p>}
                    {reminderSaved && <p className="text-xs text-green-700 mb-2">{t('sales.invoiceDetail.reminderSaved')}</p>}

                    <button
                      onClick={saveReminder}
                      disabled={reminderSaving || !reminderNote.trim() || !reminderDueDate}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white rounded-md p-2 text-xs font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                    >
                      {reminderSaving ? t('common.saving') : t('sales.invoiceDetail.saveReminder')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* NEW — invoice.deliveryOrders was already being fetched
                (it's what the old "Convert to Delivery Order" gate
                checked the length of) but never actually rendered.
                Now that an invoice can accumulate more than one delivery
                order over its life (first partial shipment, then a
                second once more stock arrives), it's worth listing. */}
            {invoice.deliveryOrders.length > 0 && (
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-2">
                  <Truck size={16} strokeWidth={2} />
                  {t('sales.invoiceDetail.deliveryOrders')}
                </h2>
                <div className="border-2 border-gray-300 bg-white rounded-md divide-y divide-gray-200">
                  {invoice.deliveryOrders.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => router.push(`/sales/delivery-orders/${d.id}`)}
                      className="w-full text-left p-3 text-sm flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <span className="font-medium">{d.doNumber ?? d.id}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${doStatusStyle(d.status)}`}>
                        {d.status === 'PACKED'
                          ? t('sales.invoiceDetail.doStatusPacked')
                          : d.status === 'SHIPPED'
                            ? t('sales.invoiceDetail.doStatusShipped')
                            : d.status === 'CANCELLED'
                              ? t('sales.invoiceDetail.doStatusCancelled')
                              : d.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Payments — individual Payment rows, each voidable to reverse
                a mistaken/duplicate entry (reverses its ledger entry and
                recomputes amountPaid/paymentStatus). */}
            {invoice.payments.length > 0 && (
              <div className="mt-2">
                <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Wallet size={16} strokeWidth={2} />
                  {t('sales.invoiceDetail.payments')}
                </h2>
                <div className="border-2 border-gray-300 bg-white rounded-md divide-y divide-gray-200">
                  {invoice.payments.map((p) => (
                    <div key={p.id} className="p-3 text-sm flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          {formatIDR(p.amount)}{' '}
                          <span className="text-gray-400 font-normal">
                            {t('sales.invoiceDetail.viaMethod', {
                              method:
                                p.method === 'CASH'
                                  ? t('sales.invoiceDetail.methodCash')
                                  : p.method === 'TRANSFER'
                                    ? t('sales.invoiceDetail.methodTransfer')
                                    : p.method === 'QRIS'
                                      ? t('sales.invoiceDetail.methodQris')
                                      : p.method === 'OTHER'
                                        ? t('sales.invoiceDetail.methodOther')
                                        : p.method,
                            })}
                          </span>
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(p.createdAt).toLocaleString()}
                          {p.note ? ` · ${p.note}` : ''}
                        </p>
                      </div>
                      {invoice.status !== 'VOID' && (
                        <button
                          onClick={() => handleVoidPayment(p.id, p.amount)}
                          disabled={voidingPaymentId === p.id}
                          className="text-[11px] font-semibold text-gray-400 hover:text-red-600 disabled:opacity-50 shrink-0"
                        >
                          {voidingPaymentId === p.id ? '...' : t('sales.invoiceDetail.voidPayment')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Activity — created/issued/edited/payment/paid/voided events
                for this invoice. */}
            {activity.length > 0 && (
              <div className="mt-2">
                <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <History size={16} strokeWidth={2} />
                  {t('sales.invoiceDetail.activity')}
                </h2>
                <div className="border-2 border-gray-300 bg-white rounded-md divide-y divide-gray-200">
                  {activity.map((ev) => (
                    <div key={ev.id} className="p-3 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <p className={`flex-1 font-medium ${ev.eventType === 'VOIDED' ? 'text-red-700' : ''}`}>
                          {t(ACTIVITY_LABEL_KEY[ev.eventType])}
                          {ev.eventType === 'PAYMENT_RECORDED' && ev.reason ? `: ${ev.reason}` : ''}
                        </p>
                        <p className="text-gray-500 whitespace-nowrap text-xs">
                          {new Date(ev.createdAt).toLocaleString()}
                          {ev.user?.email ? ` · ${ev.user.email}` : ''}
                        </p>
                      </div>

                      {ev.eventType === 'EDITED' && (
                        <>
                          {ev.reason && <p className="text-xs text-gray-600 mt-1">{ev.reason}</p>}
                          {ev.changes && ev.changes.length > 0 && (
                            <ul className="mt-1.5 text-xs text-gray-600 space-y-0.5">
                              {ev.changes.map((c, i) => (
                                <li key={i}>
                                  {c.label}: {c.before} → {c.after}
                                </li>
                              ))}
                            </ul>
                          )}
                          {ev.oldTotal != null && ev.newTotal != null && (
                            <p className="text-xs text-gray-400 mt-1">
                              {t('sales.invoiceDetail.totalChange', {
                                oldTotal: formatIDR(ev.oldTotal),
                                newTotal: formatIDR(ev.newTotal),
                              })}
                            </p>
                          )}
                        </>
                      )}

                      {ev.eventType === 'VOIDED' && ev.reason && (
                        <p className="text-xs text-gray-600 mt-1">{ev.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Paper preview — the item table, totals, business/customer details
          etc. all live inside InvoicePrintArea itself, so this replaces the
          old hand-rolled table + totals block rather than duplicating it.
          Shown visibly on screen (not print:hidden) using printFormat — the
          local reprint override — same as the Print/Download PDF buttons.
          Gray backdrop + centered white sheet + shadow mimics a real
          print-preview (Docs/Canva style), matching the sales order page.
          overflow-x-auto keeps wider formats (A4/A5) from forcing
          horizontal scroll on the whole page on narrow viewports.
          id="print-area" — CHANGED: added so the @media print CSS above
          (which targets #print-area) actually has something to select,
          matching the quotation detail page's pattern. */}
      {invoice && (
        <div className="py-8 px-4 overflow-x-auto print:p-0 print:overflow-visible">
          <div className="mx-auto w-fit">
            <div
              id="print-area"
              style={{ padding: `${MARGIN_MM[printFormat] ?? 0}mm` }}
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] print:shadow-none print:p-0"
            >
              <InvoicePrintArea
                format={printFormat}
                invoice={toInvoiceView(invoice)}
                alwaysVisible
              />
            </div>
          </div>
        </div>
      )}

      {invoice && paymentDialogOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center print:hidden z-50">
          <div className="bg-white rounded-md shadow-lg w-full max-w-sm">
            <RecordPaymentDialog
              invoiceId={invoice.id}
              balanceDue={balanceDue}
              onRecorded={load}
              onClose={() => setPaymentDialogOpen(false)}
            />
          </div>
        </div>
      )}

      {invoice && voidDialogOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center print:hidden z-50">
          <div className="bg-white rounded-md shadow-lg w-full max-w-sm">
            <VoidInvoiceDialog
              invoiceId={invoice.id}
              periodClosed={periodClosed}
              periodLabel={period ? `${(language === 'id' ? MONTH_NAMES_ID : MONTH_NAMES_EN)[period.month - 1]} ${period.year}` : undefined}
              onVoided={() => {
                setVoidDialogOpen(false);
                load();
              }}
              onClose={() => setVoidDialogOpen(false)}
            />
          </div>
        </div>
      )}
    </main>
  );
}