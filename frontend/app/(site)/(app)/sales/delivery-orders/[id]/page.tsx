// app/(app)/sales/delivery-orders/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Truck, Ban, Printer, Download, PackageCheck, FileText } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { DeliveryOrderA4Template } from '@/app/components/delivery-orders/template/DeliveryOrderA4Template';
import { toDeliveryOrderView, type DeliveryOrderView } from '@/lib/delivery-orders-mapper';
import type { DeliveryOrderDetail } from '@/app/components/delivery-orders/types';

function statusStyle(status: string) {
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

export default function DeliveryOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [order, setOrder] = useState<DeliveryOrderDetail | null>(null);
  // Flat print-shaped data for the paper preview — separate fetch from
  // the nested getOne() shape (`order`) driving the header/actions, same
  // split as the quotation detail page.
  const [printView, setPrintView] = useState<DeliveryOrderView | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const [deliveredBy, setDeliveredBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, printRes] = await Promise.all([
        apiFetch(`/delivery-orders/${id}`),
        apiFetch(`/delivery-orders/${id}/print`),
      ]);
      if (!detailRes.ok) {
        const body = await detailRes.json().catch(() => null);
        setError(body?.message ?? `Request failed (${detailRes.status})`);
        return;
      }
      const detail: DeliveryOrderDetail = await detailRes.json();
      setOrder(detail);
      setDeliveredBy(detail.deliveredBy ?? '');
      setReceivedBy(detail.receivedBy ?? '');

      if (printRes.ok) {
        setPrintView(toDeliveryOrderView(await printRes.json()));
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

  async function runAction(action: string, path: string, method = 'POST', body?: unknown) {
    setActionLoading(action);
    setError(null);
    try {
      const res = await apiFetch(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const resBody = await res.json().catch(() => null);
      if (!res.ok) {
        setError(resBody?.message ?? `Request failed (${res.status})`);
        return;
      }
      return resBody;
    } catch {
      setError('Could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleShip() {
    if (await runAction('ship', `/delivery-orders/${id}/ship`)) load();
  }

  async function handleCancel() {
    if (!confirm('Cancel this delivery order? This cannot be undone.')) return;
    if (await runAction('cancel', `/delivery-orders/${id}/cancel`)) load();
  }

  async function handleConvertToInvoice() {
    const invoice = await runAction('convert-invoice', `/invoices/from-delivery-order/${id}`);
    if (invoice?.id) {
      load();
      router.push(`/sales/invoices/${invoice.id}`);
    }
  }

  async function handleRecordProof() {
    if (
      await runAction('proof', `/delivery-orders/${id}/proof-of-delivery`, 'PATCH', {
        deliveredBy: deliveredBy.trim() || undefined,
        receivedBy: receivedBy.trim() || undefined,
        signedAt: new Date().toISOString(),
      })
    ) {
      load();
    }
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    if (!order) return;
    setPdfGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(`/delivery-orders/${order.id}/pdf`);
      if (!res.ok) throw new Error(`Failed to generate PDF (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${order.doNumber ?? 'delivery-order'}.pdf`;
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

  if (error && !order) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
      </main>
    );
  }

  if (!order) return null;

  const needsProof = order.status === 'SHIPPED' && !order.signedAt;

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
            onClick={() => router.push('/sales/delivery-orders')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to delivery orders
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold">{order.doNumber ?? order.id}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(order.status)}`}>
                  {order.status}
                </span>
              </div>
<p className="text-xs text-gray-500">
  {order.customerName ?? 'No customer'} · {order.location?.name ?? '—'}
  {order.salesOrder?.orderNumber && (
    <>
      {' '}
      · SO{' '}
      <button
        className="underline font-medium"
        onClick={() => router.push(`/sales/orders/${order.salesOrderId}`)}
      >
        {order.salesOrder.orderNumber}
      </button>
    </>
  )}
  {order.invoice?.invoiceNumber && (
    <>
      {' '}
      · Invoice{' '}
      <button
        className="underline font-medium"
        onClick={() => router.push(`/sales/invoices/${order.invoiceId}`)}
      >
        {order.invoice.invoiceNumber}
      </button>
    </>
  )}
</p>            </div>

            <div className="flex flex-wrap gap-2">
              {order.status === 'PACKED' && (
                <>
                  <button
                    disabled={actionLoading === 'ship'}
                    onClick={handleShip}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 disabled:opacity-50"
                  >
                    <Truck size={14} strokeWidth={2} />
                    Mark Shipped
                  </button>
                  <button
                    disabled={actionLoading === 'cancel'}
                    onClick={handleCancel}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-600 font-semibold hover:bg-red-50 disabled:opacity-50"
                  >
                    <Ban size={14} strokeWidth={2} />
                    Cancel
                  </button>
                </>
              )}

              {order.status === 'SHIPPED' && order.invoices.length === 0 && (
                <button
                  disabled={actionLoading === 'convert-invoice'}
                  onClick={handleConvertToInvoice}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-black font-semibold hover:bg-gray-100 disabled:opacity-50"
                >
                  <FileText size={14} strokeWidth={2} />
                  Convert to Invoice
                </button>
              )}

              {order.status !== 'PACKED' && (
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

        {order.invoices.length > 0 && (
          <div className="border-2 border-purple-200 bg-purple-50/50 rounded-md p-3 text-sm">
            <p className="font-semibold text-purple-900 mb-1">Converted documents</p>
            {order.invoices.map((inv) => (
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

        {needsProof && (
          <div className="border-2 border-gray-300 rounded-md p-3 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-sm">
              <PackageCheck size={15} strokeWidth={2} />
              Record proof of delivery
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                value={deliveredBy}
                onChange={(e) => setDeliveredBy(e.target.value)}
                placeholder="Delivered by"
                className="text-sm px-2.5 py-2 rounded-md border-2 border-gray-300 focus:outline-none focus:border-black"
              />
              <input
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                placeholder="Received by"
                className="text-sm px-2.5 py-2 rounded-md border-2 border-gray-300 focus:outline-none focus:border-black"
              />
            </div>
            <button
              disabled={actionLoading === 'proof' || (!deliveredBy.trim() && !receivedBy.trim())}
              onClick={handleRecordProof}
              className="text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 disabled:opacity-50"
            >
              Save signature
            </button>
          </div>
        )}
      </div>

      {/* Paper preview — see QuotationDetailPage for the identical pattern.
          Item table/signature blocks live inside DeliveryOrderA4Template. */}
      <div className="py-8 px-4 overflow-x-auto print:p-0 print:overflow-visible">
        <div className="mx-auto w-fit">
          {printView ? (
            <div
              id="print-area"
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] print:shadow-none"
            >
              <DeliveryOrderA4Template order={printView} />
            </div>
          ) : (
            <div
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] flex items-center justify-center text-sm text-gray-400"
              style={{ width: '210mm', height: '297mm' }}
            >
              {previewError ? 'Could not load a print preview for this delivery order.' : 'Loading preview...'}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}