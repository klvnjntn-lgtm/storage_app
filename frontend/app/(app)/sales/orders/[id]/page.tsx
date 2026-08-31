'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Printer,
  Download,
  Pencil,
  FileText,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { parseCalendarDate } from '@/lib/dates';
import { SalesOrderA4Template } from '@/app/components/sales-orders/template/SalesOrderA4Template';
import { SalesOrderPrintView, toSalesOrderView } from '@/lib/sales-order-mapper';
import { DeliveryOrdersPanel } from '@/app/components/sales-orders/DeliveryOrdersPanel';

type SalesOrderStatus = 'DRAFT' | 'CONFIRMED' | 'PARTIALLY_DELIVERED' | 'FULLY_DELIVERED' | 'CANCELLED';

type SalesOrderDetail = {
  id: string;
  orderNumber: string | null;
  status: SalesOrderStatus;
  customerName: string | null;
  customer: { name: string; phone: string | null } | null;
  location: { name: string } | null;
  locationId: string | null;
  subtotal: number | string;
  taxAmount: number | string;
  total: number | string;
  createdAt: string;
  confirmedAt: string | null;
  items: {
    id: string;
    productId: string | null;
    description: string | null;
    product: { name: string; sku: string | null } | null;
    quantity: number;
    deliveredQuantity: number;
    locationId: string | null;
  }[];
  quotation: { id: string; quotationNumber: string | null; status: string } | null;
  deliveryOrders: { id: string; doNumber: string | null; status: string }[];
  invoices: { id: string; invoiceNumber: string | null; status: string }[];
};

function statusStyle(status: SalesOrderStatus) {
  switch (status) {
    case 'DRAFT':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'CONFIRMED':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'PARTIALLY_DELIVERED':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'FULLY_DELIVERED':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
}

// Non-WAREHOUSE_OPS: all three of these remain invoiceable directly, at
// full order quantity — no competing delivery workflow to conflict with.
const CAN_INVOICE_NO_WAREHOUSE_OPS: SalesOrderStatus[] = ['CONFIRMED', 'PARTIALLY_DELIVERED', 'FULLY_DELIVERED'];

export default function SalesOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [order, setOrder] = useState<SalesOrderDetail | null>(null);
  const [printView, setPrintView] = useState<SalesOrderPrintView | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  // ASSUMPTION: GET /organization/modules returns a plain string[] of
  // enabled ModuleKey values, mirroring
  // OrganizationModulesService.getEnabledModules()'s shape. Adjust the
  // fetch below if your actual endpoint differs (e.g. lives under
  // /organization/settings instead).
  const [hasWarehouseOps, setHasWarehouseOps] = useState(false);

  const CAN_DELIVER: SalesOrderStatus[] = ['CONFIRMED', 'PARTIALLY_DELIVERED'];

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, printRes] = await Promise.all([
        apiFetch(`/sales-orders/${id}`),
        apiFetch(`/sales-orders/${id}/print-view`),
      ]);
      if (!detailRes.ok) {
        const body = await detailRes.json().catch(() => null);
        setError(body?.message ?? `Request failed (${detailRes.status})`);
        return;
      }
      setOrder(await detailRes.json());

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

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/organization/modules');
      if (res.ok) {
        const modules: string[] = await res.json();
        setHasWarehouseOps(modules.includes('WAREHOUSE_OPS'));
      }
    })();
  }, []);

  async function runAction(action: string, path: string, init?: RequestInit) {
    setActionLoading(action);
    setError(null);
    try {
      const res = await apiFetch(path, { method: 'POST', ...init });
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

  async function handleConfirm() {
    if (await runAction('confirm', `/sales-orders/${id}/confirm`)) load();
  }

  async function handleCancel() {
    const reason = window.prompt('Reason for cancelling this order:');
    if (reason === null) return;
    if (!reason.trim()) {
      setError('A reason is required to cancel an order.');
      return;
    }
    if (
      await runAction('cancel', `/sales-orders/${id}/cancel`, {
        body: JSON.stringify({ reason: reason.trim() }),
      })
    ) {
      load();
    }
  }

  // Backend gates this the same way (createDraftFromSalesOrder throws
  // outside the allowed statuses) — this is UX, not the actual guard.
  // Under WAREHOUSE_OPS only FULLY_DELIVERED is accepted, since delivery
  // exclusively owns stock movement there and this order can only ever
  // be invoiced once — see canInvoiceDirectly below.
  async function handleConvertToInvoice() {
    const invoice = await runAction('convert-invoice', `/invoices/from-order/${id}`);
    if (invoice?.id) {
      router.push(`/sales/invoices/${invoice.id}`);
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
      const res = await apiFetch(`/sales-orders/${order.id}/pdf`);
      if (!res.ok) {
        throw new Error(`Failed to generate PDF (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${order.orderNumber ?? 'sales-order'}.pdf`;
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

  // WAREHOUSE_OPS: only a fully delivered order is directly invoiceable
  // (delivery owns stock movement, and the order can only be invoiced
  // once — see backend createDraftFromSalesOrder). Non-WAREHOUSE_OPS:
  // unchanged three-status list, full order quantity, no delivery
  // workflow to conflict with.
  const canInvoiceDirectly = hasWarehouseOps
    ? order.status === 'FULLY_DELIVERED'
    : CAN_INVOICE_NO_WAREHOUSE_OPS.includes(order.status);

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
            onClick={() => router.push('/sales/orders')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to sales orders
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h1 className="text-xl sm:text-2xl font-bold">
                  {order.orderNumber ?? 'Unissued draft'}
                </h1>
                <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(order.status)}`}>
                  {order.status.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {order.customer?.name ?? order.customerName ?? 'No customer'} ·{' '}
                {order.location?.name ?? '—'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {order.status === 'DRAFT' && (
                <>
                  <button
                    onClick={() => router.push(`/sales/orders/new?draftId=${order.id}`)}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-black font-semibold hover:bg-gray-100"
                  >
                    <Pencil size={14} strokeWidth={2} />
                    Edit
                  </button>
                  <button
                    disabled={actionLoading === 'confirm'}
                    onClick={handleConfirm}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 disabled:opacity-50"
                  >
                    <CheckCircle2 size={14} strokeWidth={2} />
                    Confirm
                  </button>
                  <button
                    disabled={actionLoading === 'cancel'}
                    onClick={handleCancel}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-600 font-semibold hover:bg-red-50 disabled:opacity-50"
                  >
                    <XCircle size={14} strokeWidth={2} />
                    Cancel
                  </button>
                </>
              )}

              {canInvoiceDirectly && (
                <button
                  disabled={actionLoading === 'convert-invoice'}
                  onClick={handleConvertToInvoice}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-black font-semibold hover:bg-gray-100 disabled:opacity-50"
                >
                  <FileText size={14} strokeWidth={2} />
                  Convert to Invoice
                </button>
              )}

              {order.status !== 'DRAFT' && (
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

          {/* Only shown when WAREHOUSE_OPS is blocking direct invoicing —
              tells the user why the button above isn't there, rather than
              leaving them to guess. */}
          {hasWarehouseOps &&
            !canInvoiceDirectly &&
            (order.status === 'CONFIRMED' || order.status === 'PARTIALLY_DELIVERED') && (
              <p className="text-xs text-gray-500 mt-2">
                This order can be invoiced once it's fully delivered — create delivery orders for the remaining items below.
              </p>
            )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 space-y-3 print:hidden">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
        )}
{order.locationId && (
  <DeliveryOrdersPanel
    salesOrderId={order.id}
    locationId={order.locationId}
    items={order.items}
    onChanged={load}
          />
        )}

        {/* Existing delivery orders — Ship / Record Return actions live
            here, separate from the create-new-delivery form above. */}

        {(order.quotation || order.deliveryOrders.length > 0 || order.invoices.length > 0) && (
          <div className="border-2 border-purple-200 bg-purple-50/50 rounded-md p-3 text-sm">
            <p className="font-semibold text-purple-900 mb-1">Related documents</p>
            {order.quotation && (
              <p>
                From Quotation{' '}
                <button className="underline font-medium" onClick={() => router.push(`/sales/quotations/${order.quotation!.id}`)}>
                  {order.quotation.quotationNumber ?? order.quotation.id}
                </button>{' '}
                — {order.quotation.status}
              </p>
            )}
            {order.invoices.map((inv) => (
              <p key={inv.id}>
                Invoice{' '}
                <button className="underline font-medium" onClick={() => router.push(`/sales/invoices/${inv.id}`)}>
                  {inv.invoiceNumber ?? inv.id}
                </button>{' '}
                — {inv.status}
              </p>
            ))}
          </div>
        )}
        {order.confirmedAt && (
          <p className="text-sm text-gray-600">
            Confirmed{' '}
            <span className="font-medium">
              {parseCalendarDate(order.confirmedAt).toLocaleDateString('id-ID')}
            </span>
          </p>
        )}
      </div>

      <div className="py-8 px-4 overflow-x-auto print:p-0 print:overflow-visible">
        <div className="mx-auto w-fit">
          {printView ? (
            <div
              id="print-area"
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] print:shadow-none"
            >
              <SalesOrderA4Template order={toSalesOrderView(printView)} />
            </div>
          ) : (
            <div
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] flex items-center justify-center text-sm text-gray-400"
              style={{ width: '210mm', height: '297mm' }}
            >
              {previewError ? 'Could not load a print preview for this order.' : 'Loading preview...'}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}