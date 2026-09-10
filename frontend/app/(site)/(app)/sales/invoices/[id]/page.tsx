'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, Receipt, Printer, Wallet, Bell, X, Download, Pencil, Truck, History, AlertCircle, Ban } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });
import { useHasModule } from '@/lib/useHasModule';
import { RecordPaymentDialog } from '@/app/components/invoices/RecordPaymentDialog';
import { VoidInvoiceDialog } from '@/app/components/invoices/VoidInvoiceDialog';
import { InvoicePrintArea } from '@/app/components/invoices/templates/InvoicePrintArea';
import { InvoiceFormat } from '@/app/components/invoices/types';
import { InvoicePrintView, toInvoiceView } from '@/lib/invoice-mapper';
import { parseCalendarDate, toCalendarDateString } from '@/lib/dates';
import { PAGE_CSS, MARGIN_MM } from '@/lib/invoice-format';
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

const ACTIVITY_LABEL: Record<InvoiceActivityEventType, string> = {
  CREATED: 'Invoice created',
  ISSUED: 'Invoice issued',
  EDITED: 'Invoice edited',
  PAYMENT_RECORDED: 'Payment recorded',
  MARKED_PAID: 'Marked as paid',
  VOIDED: 'Invoice voided',
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
  const style =
    status === 'PAID'
      ? 'border-green-600 text-green-700'
      : status === 'PARTIAL'
        ? 'border-amber-600 text-amber-700'
        : 'border-red-600 text-red-700';
  return (
    <span className={`inline-block border-2 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${style}`}>
      {status}
    </span>
  );
}

// NEW — surfaces InvoicePrintView.fulfillmentStatus. Renders nothing once
// fully fulfilled, so it doesn't clutter the header for the common case.
function FulfillmentBadge({ status }: { status: FulfillmentStatus }) {
  if (status === 'FULFILLED') return null;
  return (
    <span className="inline-flex items-center gap-1 border-2 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide border-amber-600 text-amber-700 bg-amber-50">
      <Truck size={11} strokeWidth={2} />
      {status === 'PARTIALLY_FULFILLED' ? 'Partially fulfilled' : 'Backordered'}
    </span>
  );
}

function OverdueBadge() {
  return (
    <span className="inline-flex items-center gap-1 border-2 rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide border-red-600 text-red-700 bg-red-50">
      <AlertCircle size={11} strokeWidth={2} />
      Overdue
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

  const [invoice, setInvoice] = useState<InvoicePrintView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);

  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  // Reprint format — defaults to whatever the invoice was actually issued
  // as, but is a local, non-persisted override: picking A4 here reprints
  // (and now previews) this invoice on A4 paper without changing
  // invoice.format in the DB.
  const [printFormat, setPrintFormat] = useState<InvoiceFormat>('RECEIPT');
const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

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
      const [invRes, historyRes] = await Promise.all([
        apiFetch(`/invoices/${params.id}`),
        apiFetch(`/sales/invoices/${params.id}/edit-history`),
      ]);
      if (!invRes.ok) {
        const body = await invRes.json().catch(() => null);
        setError(body?.message ?? `Failed to load invoice (${invRes.status})`);
        return;
      }
      const data = await invRes.json();
      setInvoice(data);
      setPrintFormat(data.format);

      if (historyRes.ok) {
        setActivity(await historyRes.json());
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
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
        throw new Error(err?.message || `Failed to save reminder (${res.status})`);
      }
      setReminderSaved(true);
      setReminderNote('');
      setReminderDueDate('');
    } catch (e: any) {
      setReminderError(e.message || 'Could not save reminder');
    } finally {
      setReminderSaving(false);
    }
  }

  async function handlePrint() {
  if (!invoice) return;
  setPdfGenerating(true);
  setError(null);
  try {
    const res = await apiFetch(`/invoices/${invoice.id}/pdf?format=${printFormat}`);
    if (!res.ok) {
      throw new Error(`Failed to generate PDF (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // Open in a new tab so Chrome's own PDF viewer handles it — this is
    // the pipeline that already prints A5/landscape correctly, since the
    // PDF's page geometry is baked in rather than negotiated live via
    // @page CSS against a driver.
    const printWindow = window.open(url, '_blank');

    // Auto-trigger the print dialog once the PDF has actually loaded.
    // A fixed delay is a fallback for popup blockers / slow loads —
    // print() on a window that hasn't finished loading its PDF can
    // silently no-op in some Chrome versions.
    if (printWindow) {
      printWindow.addEventListener('load', () => {
        printWindow.print();
      });
    }

    // Revoke a bit later, not immediately — the new tab needs the blob
    // URL to still be valid when it loads and when print() fires.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e: any) {
    setError(e.message || 'Could not generate PDF for printing.');
  } finally {
    setPdfGenerating(false);
  }
}
async function handleConvertToDeliveryOrder() {
  if (!invoice) return;
  setActionLoading('convert-do');
  setError(null);
  try {
    const res = await apiFetch(`/delivery-orders/from-invoice/${invoice.id}`, { method: 'POST' });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? `Request failed (${res.status})`);
      return;
    }
    if (body?.id) {
      router.push(`/sales/delivery-orders/${body.id}`);
    }
  } catch {
    setError('Could not reach the server.');
  } finally {
    setActionLoading(null);
  }
}
  async function handleDownloadPdf() {
    if (!invoice) return;
    setPdfGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(`/invoices/${invoice.id}/pdf?format=${printFormat}`);
      if (!res.ok) {
        throw new Error(`Failed to generate PDF (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoiceNumber ?? 'invoice'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || 'Could not generate PDF.');
    } finally {
      setPdfGenerating(false);
    }
  }

  const total = invoice ? Number(invoice.total) : 0;
  const amountPaid = invoice ? Number(invoice.amountPaid) : 0;
  const balanceDue = Math.max(total - amountPaid, 0);
  const overdue = isOverdue(invoice);

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
            <button
              onClick={() => router.push('/sales/invoices')}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
            >
              <ArrowLeft size={16} strokeWidth={2} />
              Back to Invoices
            </button>

            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                <Receipt size={18} strokeWidth={2} className="text-blue-700" />
              </span>
              <div>
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight`}>
                  {invoice?.invoiceNumber ?? 'Invoice'}
                </h1>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <p className="text-xs text-gray-500">
                    {invoice?.status ?? '\u00A0'}
                  </p>
                  {invoice && <PaymentBadge status={invoice.paymentStatus} />}
                  {invoice && <FulfillmentBadge status={invoice.fulfillmentStatus} />}
                  {overdue && <OverdueBadge />}
                </div>
                {invoice?.invoiceDate && (
                  <p className="text-xs text-gray-500 mt-1">
                    Invoice date: {parseCalendarDate(invoice.invoiceDate).toLocaleDateString('id-ID')}
                    {invoice.issuedAt && (
                      <span className="text-gray-400">
                        {' '}· Issued {new Date(invoice.issuedAt).toLocaleDateString('id-ID')}
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
                !hasWarehouseOps && (
                  <button
                    onClick={() => router.push(`/sales/invoices/${invoice.id}/edit`)}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 h-fit transition-colors"
                  >
                    <Pencil size={16} strokeWidth={2} />
                    Edit
                  </button>
                )}

{invoice.status === 'ISSUED' && invoice.paymentStatus === 'UNPAID' && (
  <button
    onClick={() => setVoidDialogOpen(true)}
    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-700 font-semibold hover:bg-red-50 h-fit"
  >
    <Ban size={16} strokeWidth={2} />
    Void
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
    {actionLoading === 'convert-do' ? 'Converting...' : 'Convert to Delivery Order'}
  </button>
)}

              {balanceDue > 0 && invoice.status !== 'VOID' && (
                <button
                  onClick={() => setPaymentDialogOpen(true)}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 h-fit transition-colors"
                >
                  <Wallet size={16} strokeWidth={2} />
                  Record payment
                </button>
              )}
              <button
                onClick={handleDownloadPdf}
                disabled={pdfGenerating}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 h-fit disabled:opacity-50 transition-colors"
              >
                <Download size={16} strokeWidth={2} />
                {pdfGenerating ? 'Generating...' : 'Download PDF'}
              </button>
<button
  onClick={handlePrint}
  disabled={pdfGenerating}
  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 h-fit disabled:opacity-50 transition-colors"
>
  <Printer size={16} strokeWidth={2} />
  {pdfGenerating ? 'Preparing...' : 'Print'}
</button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 print:hidden">
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
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
                  This invoice was due {invoice.dueDate && parseCalendarDate(invoice.dueDate).toLocaleDateString('id-ID')} and is now overdue.
                </span>
              </div>
            )}

            {hasWorkshopRms && invoice.vehicleId && (
              <div className="border-2 border-gray-300 bg-white rounded-md p-3 mb-4">
                <p className="text-xs text-gray-500 mb-2">
                  Vehicle: <span className="font-medium text-gray-800">{invoice.vehiclePlateNumber} · {invoice.vehicleModel}</span>
                  {invoice.vehicleVin && <span> · VIN {invoice.vehicleVin}</span>}
                  {invoice.vehicleOdometer != null && <span> · {invoice.vehicleOdometer} km</span>}
                </p>
                {!reminderOpen ? (
                  <button
                    onClick={() => setReminderOpen(true)}
                    className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-blue-700 transition-colors"
                  >
                    <Bell size={14} strokeWidth={2} />
                    Set a reminder for {invoice.vehiclePlateNumber} · {invoice.vehicleModel}
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                        <Bell size={12} strokeWidth={2} />
                        Reminder for {invoice.vehiclePlateNumber} · {invoice.vehicleModel}
                      </span>
                      <button onClick={() => setReminderOpen(false)} className="text-gray-400 hover:text-blue-700">
                        <X size={14} strokeWidth={2} />
                      </button>
                    </div>

                    <textarea
                      value={reminderNote}
                      onChange={(e) => setReminderNote(e.target.value)}
                      placeholder="e.g. Needs another oil change"
                      rows={2}
                      className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 resize-none mb-2"
                    />

                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {[
                        { label: '1 month', months: 1 },
                        { label: '2 months', months: 2 },
                        { label: '3 months', months: 3 },
                        { label: '6 months', months: 6 },
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
                    {reminderSaved && <p className="text-xs text-green-700 mb-2">Reminder saved.</p>}

                    <button
                      onClick={saveReminder}
                      disabled={reminderSaving || !reminderNote.trim() || !reminderDueDate}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white rounded-md p-2 text-xs font-semibold hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                    >
                      {reminderSaving ? 'Saving...' : 'Save reminder'}
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
                  Delivery orders
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
                        {d.status}
                      </span>
                    </button>
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
                  Activity
                </h2>
                <div className="border-2 border-gray-300 bg-white rounded-md divide-y divide-gray-200">
                  {activity.map((ev) => (
                    <div key={ev.id} className="p-3 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <p className={`flex-1 font-medium ${ev.eventType === 'VOIDED' ? 'text-red-700' : ''}`}>
                          {ACTIVITY_LABEL[ev.eventType]}
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
                              Total: {formatIDR(ev.oldTotal)} → {formatIDR(ev.newTotal)}
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
          horizontal scroll on the whole page on narrow viewports. */}
{invoice && (
<div className="py-8 px-4 overflow-x-auto print:p-0 print:overflow-visible">
  <div className="mx-auto w-fit">
    <div
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