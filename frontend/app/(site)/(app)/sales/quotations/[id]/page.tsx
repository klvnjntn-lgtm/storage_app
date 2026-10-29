'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Send, CheckCircle2, XCircle, Printer, Download, ArrowRightCircle, FileText, Pencil, Trash2, Link2, Wrench, FilePlus2, Car } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { parseCalendarDate, formatDMY } from '@/lib/dates';
import { QuotationA4Template } from '@/app/components/quotations/templates/QuotationA4Template';
import { QuotationPrintView, toQuotationView } from '@/lib/mappers/quotation-mapper';
import { useWarehouseOps } from '@/lib/hooks/useWarehouseOps';
import { useLanguage } from '@/app/context/LanguageContext';
import { useDialog } from '@/app/components/shared/DialogProvider';
import { errorMessage } from '@/lib/api-error';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { ConvertQuotationDialog, type ConversionLine } from '@/app/components/quotations/ConvertQuotationDialog';


type QuotationDetail = {
  id: string;
  quotationNumber: string | null;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'CONVERTED';
  customerName: string | null;
  customer: { name: string; phone: string | null } | null;
  location: { name: string } | null;
  validUntil: string | null;
  createdAt: string;
  sentAt: string | null;
  items: { id: string }[];
  salesOrders: { id: string; orderNumber: string | null; status: string }[];
  invoices: { id: string; invoiceNumber: string | null; status: string }[];
  // Workshops: the car, why it came in, the customer's online answer, and the job/quotation chain.
  vehicle: { id: string; plateNumber: string; vehicleModel: string } | null;
  odometer: number | null;
  complaint: string | null;
  responseNote: string | null;
  workOrder: { id: string; number: string; status: string } | null;
  parentQuotation: { id: string; quotationNumber: string | null; status: string } | null;
  additions: { id: string; quotationNumber: string | null; status: string }[];
  // Per line: quoted, ordered, invoiced, left — it converts in parts.
  conversion: ConversionLine[];
};

export default function QuotationDetailPage() {
  const dialog = useDialog();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { t } = useLanguage();
  const warehouseOps = useWarehouseOps();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');
  // Work orders are an org setting on top of the module.
  const [workOrdersEnabled, setWorkOrdersEnabled] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  useEffect(() => {
    if (!hasWorkshopRms) return;
    apiFetch('/work-orders/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setWorkOrdersEnabled(!!body?.enabled))
      .catch(() => {});
  }, [hasWorkshopRms]);

  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  // Flat print-shaped data for the paper preview — separate fetch from
  // the nested getOne() shape (`quotation`) driving the header/actions.
  const [printView, setPrintView] = useState<QuotationPrintView | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, printRes] = await Promise.all([
        apiFetch(`/sales-quotations/${id}`),
        apiFetch(`/sales-quotations/${id}/print-view`),
      ]);
      if (!detailRes.ok) {
        const body = await detailRes.json().catch(() => null);
        setError(body?.message ?? t('sales.quotationDetail.requestFailed', { status: detailRes.status }));
        return;
      }
      setQuotation(await detailRes.json());

      if (printRes.ok) {
        setPrintView(await printRes.json());
        setPreviewError(false);
      } else {
        setPreviewError(true);
      }
    } catch {
      setError(t('sales.quotationDetail.serverUnreachable'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runAction(action: string, path: string, method = 'POST', payload?: object) {
    setActionLoading(action);
    setError(null);
    try {
      const res = await apiFetch(path, { method, ...(payload && { body: JSON.stringify(payload) }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('sales.quotationDetail.requestFailed', { status: res.status }));
        return;
      }
      return body;
    } catch {
      setError(t('sales.quotationDetail.serverUnreachable'));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSend() {
    if (await runAction('send', `/sales-quotations/${id}/send`)) load();
  }
  async function handleAccept() {
    if (await runAction('accept', `/sales-quotations/${id}/accept`)) load();
  }
  async function handleReject() {
    if (await runAction('reject', `/sales-quotations/${id}/reject`)) load();
  }
  async function handleDiscard() {
    if (!(await dialog.confirm(t('sales.quotationDetail.confirmDiscardDraft'), { danger: true }))) return;
    const res = await apiFetch(`/sales-quotations/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/sales/quotations');
  }

  // Which conversion's quantity picker is open.
  const [converting, setConverting] = useState<'order' | 'invoice' | null>(null);

  async function handleConvertToOrder(lines?: { quotationItemId: string; quantity: number }[]) {
    const order = await runAction('convert-order', `/sales-orders/from-quotation/${id}`, 'POST', { lines });
    if (order?.id) {
      load();
      router.push(`/sales/orders/${order.id}`);
    }
  }

  // Once CONVERTED (via handleConvertToOrder above), this button
  // disappears with the rest of the SENT/ACCEPTED action group — invoicing
  // from that point on happens from the sales order's own detail page via
  // /invoices/from-order/:orderId, not from here.
  async function handleConvertToInvoice(lines?: { quotationItemId: string; quantity: number }[]) {
    const invoice = await runAction('convert-invoice', `/invoices/from-quotation/${id}`, 'POST', { lines });
    if (invoice?.id) {
      load();
      router.push(`/sales/invoices/${invoice.id}`);
    }
  }

  // The customer's approval link, onto the clipboard (a draft is sent first, so reload).
  async function handleCopyLink() {
    const body = await runAction('copy-link', `/sales-quotations/${id}/approval-link`);
    if (!body?.token) return;
    const url = `${window.location.origin}/estimate/${body.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      await dialog.alert(url);
    }
    load();
  }

  async function handleConvertToWorkOrder() {
    const wo = await runAction('convert-wo', `/work-orders/from-quotation/${id}`);
    if (wo?.id) router.push(`/workshop/work-orders/${wo.id}`);
  }

  async function handleAddition() {
    const addition = await runAction('addition', `/sales-quotations/${id}/additions`);
    if (addition?.id) router.push(`/sales/quotations/new?draftId=${addition.id}`);
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    if (!quotation) return;
    setPdfGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(`/sales-quotations/${quotation.id}/pdf`);
      if (!res.ok) {
        throw new Error(t('sales.quotationDetail.pdfGenerationFailed', { status: res.status }));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${quotation.quotationNumber ?? 'quotation'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorMessage(e) || t('sales.quotationDetail.couldNotGeneratePdf'));
    } finally {
      setPdfGenerating(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </main>
    );
  }

  if (error && !quotation) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
      </main>
    );
  }

  if (!quotation) return null;
  const anyLeft = quotation.conversion.some((l) => l.remaining > 0);
  const partlyConverted = quotation.conversion.some((l) => l.ordered > 0 || l.invoiced > 0);

  return (
    <main className="min-h-screen print:min-h-0 bg-gray-50 text-black">
      <style>{`
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

      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)] print:hidden">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight`}>
                {quotation.quotationNumber ?? t('sales.quotationDetail.unissuedDraft')}
              </h1>
              <p className="text-xs text-gray-500">
                {quotation.customer?.name ?? quotation.customerName ?? t('sales.quotationDetail.noCustomer')}
                {warehouseOps && ` · ${quotation.location?.name ?? '—'}`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {quotation.status === 'DRAFT' && (
                <>
                  <button data-tour="qd-edit"
                    onClick={() => router.push(`/sales/quotations/new?draftId=${quotation.id}`)}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 transition-colors"
                  >
                    <Pencil size={14} strokeWidth={2} />
                    {t('sales.quotationDetail.edit')}
                  </button>
                  <button data-tour="qd-send"
                    disabled={actionLoading === 'send'}
                    onClick={handleSend}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    <Send size={14} strokeWidth={2} />
                    {t('sales.quotationDetail.send')}
                  </button>
                  <button
                    onClick={handleDiscard}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-600 font-semibold hover:bg-red-50"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                    {t('sales.quotationDetail.discard')}
                  </button>
                </>
              )}

              {quotation.status === 'SENT' && (
                <>
                  <button data-tour="qd-accept"
                    disabled={actionLoading === 'accept'}
                    onClick={handleAccept}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50"
                  >
                    <CheckCircle2 size={14} strokeWidth={2} />
                    {t('sales.quotationDetail.accept')}
                  </button>
                  <button
                    disabled={actionLoading === 'reject'}
                    onClick={handleReject}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-600 font-semibold hover:bg-red-50 disabled:opacity-50"
                  >
                    <XCircle size={14} strokeWidth={2} />
                    {t('sales.quotationDetail.reject')}
                  </button>
                </>
              )}

{(quotation.status === 'SENT' || quotation.status === 'ACCEPTED') && !quotation.workOrder && anyLeft && (
  <button data-tour="qd-to-order"
    disabled={actionLoading === 'convert-order'}
    onClick={() => setConverting('order')}
    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors"
  >
    <ArrowRightCircle size={14} strokeWidth={2} />
    {t('sales.quotationDetail.convertToOrder')}
  </button>
)}

{/* Not once CONVERTED: that status also means "converted to a sales
    order", which is invoiced from the order — invoicing here too billed
    the customer twice. */}
{(quotation.status === 'SENT' || quotation.status === 'ACCEPTED') && !quotation.workOrder && anyLeft && (
    <button data-tour="qd-to-invoice"
      disabled={actionLoading === 'convert-invoice'}
      onClick={() => setConverting('invoice')}
      className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors"
    >
      <FileText size={14} strokeWidth={2} />
      {t('sales.quotationDetail.convertToInvoice')}
    </button>
  )}
              {hasWorkshopRms && !quotation.workOrder && ['DRAFT', 'SENT', 'ACCEPTED'].includes(quotation.status) && (
                <button
                  disabled={actionLoading === 'copy-link'}
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  <Link2 size={14} strokeWidth={2} />
                  {linkCopied ? t('sales.quotationWorkshop.linkCopied') : t('sales.quotationWorkshop.copyLink')}
                </button>
              )}
              {hasWorkshopRms &&
                workOrdersEnabled &&
                quotation.vehicle &&
                !quotation.workOrder &&
                !partlyConverted &&
                ['DRAFT', 'SENT', 'ACCEPTED'].includes(quotation.status) && (
                  <button
                    disabled={actionLoading === 'convert-wo'}
                    onClick={handleConvertToWorkOrder}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    <Wrench size={14} strokeWidth={2} />
                    {quotation.parentQuotation
                      ? t('sales.quotationWorkshop.addToWorkOrder')
                      : t('sales.quotationWorkshop.convertToWorkOrder')}
                  </button>
                )}
              {hasWorkshopRms && quotation.workOrder && (
                <button
                  disabled={actionLoading === 'addition'}
                  onClick={handleAddition}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  <FilePlus2 size={14} strokeWidth={2} />
                  {t('sales.quotationWorkshop.additionalQuotation')}
                </button>
              )}
              {quotation.status !== 'DRAFT' && (
                <>
                  <button
                    onClick={handleDownloadPdf}
                    disabled={pdfGenerating}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors"
                  >
                    <Download size={14} strokeWidth={2} />
                    {pdfGenerating ? t('sales.quotationDetail.generatingPdf') : t('sales.quotationDetail.downloadPdf')}
                  </button>
                  <button data-tour="doc-print"
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <Printer size={14} strokeWidth={2} />
                    {t('sales.quotationDetail.print')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 space-y-3 print:hidden">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
        )}

        {(quotation.vehicle || quotation.workOrder || quotation.parentQuotation || quotation.additions.length > 0 || quotation.responseNote) && (
          <div className="border-2 border-blue-200 bg-blue-50/40 rounded-md p-3 text-sm space-y-1">
            {quotation.vehicle && (
              <p className="flex items-center gap-1.5">
                <Car size={14} strokeWidth={2} className="text-blue-700" />
                <span className="font-semibold">{quotation.vehicle.plateNumber}</span> · {quotation.vehicle.vehicleModel}
                {quotation.odometer != null && (
                  <span className="text-gray-600"> · {quotation.odometer.toLocaleString('id-ID')} km</span>
                )}
                {quotation.complaint && <span className="text-gray-600"> — {quotation.complaint}</span>}
              </p>
            )}
            {quotation.responseNote && <p className="text-gray-700">{quotation.responseNote}</p>}
            {quotation.workOrder && (
              <p>
                {t('sales.quotationWorkshop.workOrderLabel')}{' '}
                <button className="underline font-medium" onClick={() => router.push(`/workshop/work-orders/${quotation.workOrder!.id}`)}>
                  {quotation.workOrder.number}
                </button>
              </p>
            )}
            {quotation.parentQuotation && (
              <p>
                {t('sales.quotationWorkshop.additionTo')}{' '}
                <button className="underline font-medium" onClick={() => router.push(`/sales/quotations/${quotation.parentQuotation!.id}`)}>
                  {quotation.parentQuotation.quotationNumber ?? t('sales.quotationDetail.unissuedDraft')}
                </button>
              </p>
            )}
            {quotation.additions.length > 0 && (
              <p>
                {t('sales.quotationWorkshop.additions')}{' '}
                {quotation.additions.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ', '}
                    <button className="underline font-medium" onClick={() => router.push(`/sales/quotations/${a.id}`)}>
                      {a.quotationNumber ?? t('sales.quotationDetail.unissuedDraft')}
                    </button>{' '}
                    ({a.status})
                  </span>
                ))}
              </p>
            )}
          </div>
        )}

        {partlyConverted && (
          <div className="border-2 border-gray-200 bg-white rounded-md p-3 text-sm overflow-x-auto">
            <p className="font-semibold mb-2">{t('sales.quotationConvert.progressTitle')}</p>
            <table className="w-full min-w-[420px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="py-1 pr-2">{t('sales.quotationConvert.item')}</th>
                  <th className="py-1 px-2 text-right">{t('sales.quotationConvert.quoted')}</th>
                  <th className="py-1 px-2 text-right">{t('sales.quotationConvert.ordered')}</th>
                  <th className="py-1 px-2 text-right">{t('sales.quotationConvert.invoiced')}</th>
                  <th className="py-1 pl-2 text-right">{t('sales.quotationConvert.left')}</th>
                </tr>
              </thead>
              <tbody>
                {quotation.conversion.map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="py-1 pr-2">{l.name}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{l.quoted}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{l.ordered}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{l.invoiced}</td>
                    <td className={`py-1 pl-2 text-right tabular-nums font-semibold ${l.remaining ? '' : 'text-gray-400'}`}>{l.remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {converting && (
          <ConvertQuotationDialog
            target={converting}
            lines={quotation.conversion}
            busy={actionLoading === 'convert-order' || actionLoading === 'convert-invoice'}
            onClose={() => setConverting(null)}
            onConfirm={(lines) => {
              setConverting(null);
              if (converting === 'order') handleConvertToOrder(lines);
              else handleConvertToInvoice(lines);
            }}
          />
        )}

        {(quotation.salesOrders.length > 0 || quotation.invoices.length > 0) && (
          <div className="border-2 border-purple-200 bg-purple-50/50 rounded-md p-3 text-sm">
            <p className="font-semibold text-purple-900 mb-1">{t('sales.quotationDetail.convertedDocuments')}</p>
            {quotation.salesOrders.map((so) => (
              <p key={so.id}>
                {t('sales.quotationDetail.salesOrderLabel')}{' '}
                <button
                  className="underline font-medium"
                  onClick={() => router.push(`/sales/orders/${so.id}`)}
                >
                  {so.orderNumber ?? so.id}
                </button>{' '}
                — {so.status}
              </p>
            ))}
            {quotation.invoices.map((inv) => (
              <p key={inv.id}>
                {t('sales.quotationDetail.invoiceLabel')}{' '}
                <button
                  className="underline font-medium"
                  onClick={() => router.push(`/sales/invoices/${inv.id}`)}
                >
                  {inv.invoiceNumber ?? inv.id}
                </button>{' '}
                — {inv.status}
              </p>
            ))}
          </div>
        )}

        {quotation.validUntil && (
          <p className="text-sm text-gray-600">
            {t('sales.quotationDetail.validUntil')}{' '}
            <span className="font-medium">
              {formatDMY(parseCalendarDate(quotation.validUntil))}
            </span>
          </p>
        )}
      </div>

      {/* Paper preview — see SalesOrderDetailPage for the identical
          pattern. Item table/totals/customer block all live inside
          QuotationA4Template now, replacing the old duplicate table. */}
      <div className="py-8 px-4 overflow-x-auto print:p-0 print:overflow-visible">
        <div className="mx-auto w-fit">
          {printView ? (
            <div
              id="print-area"
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] print:shadow-none"
            >
              <QuotationA4Template quotation={toQuotationView(printView)} />
            </div>
          ) : (
            <div
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] flex items-center justify-center text-sm text-gray-400"
              style={{ width: '210mm', height: '297mm' }}
            >
              {previewError
                ? t('sales.quotationDetail.couldNotLoadPreview')
                : t('sales.quotationDetail.loadingPreview')}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}