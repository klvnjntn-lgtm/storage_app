'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Send,
  CheckCircle2,
  XCircle,
  Printer,
  Download,
  ArrowRightCircle,
  FileText,
  Pencil,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { parseCalendarDate } from '@/lib/dates';
import { QuotationA4Template } from '@/app/components/quotations/template/QuotationA4Template';
import { QuotationPrintView, toQuotationView } from '@/lib/quotation-mapper';

type QuotationDetail = {
  id: string;
  quotationNumber: string | null;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'CONVERTED';
  customerName: string | null;
  customer: { name: string; phone: string | null } | null;
  location: { name: string } | null;
  validUntil: string | null;
  createdAt: string;
  sentAt: string | null;
  items: { id: string }[];
  salesOrders: { id: string; orderNumber: string | null; status: string }[];
  invoices: { id: string; invoiceNumber: string | null; status: string }[];
};

export default function QuotationDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

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
        setError(body?.message ?? `Request failed (${detailRes.status})`);
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
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runAction(action: string, path: string, method = 'POST') {
    setActionLoading(action);
    setError(null);
    try {
      const res = await apiFetch(path, { method });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      return body;
    } catch {
      setError('Could not reach the server.');
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
    if (!confirm('Discard this draft quotation? This cannot be undone.')) return;
    const res = await apiFetch(`/sales-quotations/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/sales/quotations');
  }

  async function handleConvertToOrder() {
    const order = await runAction('convert-order', `/sales-orders/from-quotation/${id}`);
    if (order?.id) {
      load();
      router.push(`/sales/orders/${order.id}`);
    }
  }

  // Once CONVERTED (via handleConvertToOrder above), this button
  // disappears with the rest of the SENT/ACCEPTED action group — invoicing
  // from that point on happens from the sales order's own detail page via
  // /invoices/from-order/:orderId, not from here.
  async function handleConvertToInvoice() {
    const invoice = await runAction('convert-invoice', `/invoices/from-quotation/${id}`);
    if (invoice?.id) {
      load();
      router.push(`/sales/invoices/${invoice.id}`);
    }
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
        throw new Error(`Failed to generate PDF (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${quotation.quotationNumber ?? 'quotation'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || 'Could not generate PDF.');
    } finally {
      setPdfGenerating(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-gray-500">Loading...</p>
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

      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 border-b-2 border-gray-300 print:hidden">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => router.push('/sales/quotations')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to quotations
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">
                {quotation.quotationNumber ?? 'Unissued draft'}
              </h1>
              <p className="text-xs text-gray-500">
                {quotation.customer?.name ?? quotation.customerName ?? 'No customer'} ·{' '}
                {quotation.location?.name ?? '—'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {quotation.status === 'DRAFT' && (
                <>
                  <button
                    onClick={() => router.push(`/sales/quotations/new?draftId=${quotation.id}`)}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-black font-semibold hover:bg-gray-100"
                  >
                    <Pencil size={14} strokeWidth={2} />
                    Edit
                  </button>
                  <button
                    disabled={actionLoading === 'send'}
                    onClick={handleSend}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 disabled:opacity-50"
                  >
                    <Send size={14} strokeWidth={2} />
                    Send
                  </button>
                  <button
                    onClick={handleDiscard}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-600 font-semibold hover:bg-red-50"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                    Discard
                  </button>
                </>
              )}

              {quotation.status === 'SENT' && (
                <>
                  <button
                    disabled={actionLoading === 'accept'}
                    onClick={handleAccept}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50"
                  >
                    <CheckCircle2 size={14} strokeWidth={2} />
                    Accept
                  </button>
                  <button
                    disabled={actionLoading === 'reject'}
                    onClick={handleReject}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-600 font-semibold hover:bg-red-50 disabled:opacity-50"
                  >
                    <XCircle size={14} strokeWidth={2} />
                    Reject
                  </button>
                </>
              )}

{(quotation.status === 'SENT' || quotation.status === 'ACCEPTED') && (
  <button
    disabled={actionLoading === 'convert-order'}
    onClick={handleConvertToOrder}
    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-black font-semibold hover:bg-gray-100 disabled:opacity-50"
  >
    <ArrowRightCircle size={14} strokeWidth={2} />
    Convert to Sales Order
  </button>
)}

{['SENT', 'ACCEPTED', 'CONVERTED'].includes(quotation.status) &&
  quotation.invoices.length === 0 && (
    <button
      disabled={actionLoading === 'convert-invoice'}
      onClick={handleConvertToInvoice}
      className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-black font-semibold hover:bg-gray-100 disabled:opacity-50"
    >
      <FileText size={14} strokeWidth={2} />
      Convert to Invoice
    </button>
  )}
              {quotation.status !== 'DRAFT' && (
                <>
                  <button
                    onClick={handleDownloadPdf}
                    disabled={pdfGenerating}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-black font-semibold hover:bg-gray-100 disabled:opacity-50"
                  >
                    <Download size={14} strokeWidth={2} />
                    {pdfGenerating ? 'Generating...' : 'Download PDF'}
                  </button>
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800"
                  >
                    <Printer size={14} strokeWidth={2} />
                    Print
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 space-y-3 print:hidden">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
        )}

        {(quotation.salesOrders.length > 0 || quotation.invoices.length > 0) && (
          <div className="border-2 border-purple-200 bg-purple-50/50 rounded-md p-3 text-sm">
            <p className="font-semibold text-purple-900 mb-1">Converted documents</p>
            {quotation.salesOrders.map((so) => (
              <p key={so.id}>
                Sales Order{' '}
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
                Invoice{' '}
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
            Valid until{' '}
            <span className="font-medium">
              {parseCalendarDate(quotation.validUntil).toLocaleDateString('id-ID')}
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
              {previewError ? 'Could not load a print preview for this quotation.' : 'Loading preview...'}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}