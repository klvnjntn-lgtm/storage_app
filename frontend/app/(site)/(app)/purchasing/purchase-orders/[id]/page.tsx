// app/(app)/purchasing/purchase-orders/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Send, XCircle, Printer, Download, Pencil, ClipboardList } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { PurchaseOrderTemplate } from '@/app/components/purchase-orders/templates/PurchaseOrderTemplate';
import { PurchaseOrderDetail, PurchaseOrderPrintView } from '@/app/components/purchase-orders/types';

function statusBadgeClasses(status: string) {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-200 text-gray-700';
    case 'SENT':
      return 'bg-blue-100 text-blue-700';
    case 'PARTIALLY_RECEIVED':
      return 'bg-amber-100 text-amber-700';
    case 'FULLY_RECEIVED':
      return 'bg-green-100 text-green-700';
    case 'CANCELLED':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-200 text-gray-700';
  }
}

export default function PurchaseOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [printView, setPrintView] = useState<PurchaseOrderPrintView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, printRes] = await Promise.all([
        apiFetch(`/purchase-orders/${id}`),
        apiFetch(`/purchase-orders/${id}/print-view`),
      ]);
      if (!detailRes.ok) {
        const body = await detailRes.json().catch(() => null);
        setError(body?.message ?? `Request failed (${detailRes.status})`);
        return;
      }
      setPo(await detailRes.json());
      if (printRes.ok) setPrintView(await printRes.json());
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

  async function runAction(action: string, path: string) {
    setActionLoading(action);
    setError(null);
    try {
      const res = await apiFetch(path, { method: 'POST' });
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
    if (await runAction('send', `/purchase-orders/${id}/send`)) load();
  }
  async function handleCancel() {
    if (!confirm('Cancel this purchase order? This cannot be undone.')) return;
    if (await runAction('cancel', `/purchase-orders/${id}/cancel`)) load();
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    if (!po) return;
    setPdfGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(`/purchase-orders/${po.id}/pdf`);
      if (!res.ok) {
        throw new Error(`Failed to generate PDF (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${po.poNumber ?? 'purchase-order'}.pdf`;
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

  if (error && !po) {
    return (
      <main className="min-h-screen bg-white text-black p-6">
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
      </main>
    );
  }

  if (!po) return null;

  return (
    <main className="min-h-screen print:min-h-0 bg-gray-50 text-black">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 border-b-2 border-gray-300 print:hidden">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => router.push('/purchasing/purchase-orders')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to purchase orders
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <ClipboardList size={20} strokeWidth={2} className="text-gray-700" />
                {po.poNumber ?? 'Unissued draft'}
              </h1>
              <p className="text-xs text-gray-500">
                {printView?.supplierName ?? 'No supplier'} · {printView?.locationName ?? '—'}
              </p>
              <span
                className={`inline-block mt-1 text-xs font-semibold px-2 py-1 rounded-full ${statusBadgeClasses(po.status)}`}
              >
                {po.status.replace('_', ' ')}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {po.status === 'DRAFT' && (
                <>
                  <button
                    onClick={() => router.push(`/purchasing/purchase-orders/new?id=${po.id}`)}
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
                </>
              )}

              {(po.status === 'DRAFT' || po.status === 'SENT') && (
                <button
                  disabled={actionLoading === 'cancel'}
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-600 font-semibold hover:bg-red-50 disabled:opacity-50"
                >
                  <XCircle size={14} strokeWidth={2} />
                  Cancel
                </button>
              )}

              {po.status !== 'DRAFT' && (
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

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-4 print:hidden">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
        )}
      </div>

      <div className="py-8 px-4 overflow-x-auto print:p-0 print:overflow-visible">
        <div className="mx-auto w-fit">
          {printView ? (
            <div
              id="print-area"
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] print:shadow-none"
            >
              <PurchaseOrderTemplate po={printView} />
            </div>
          ) : (
            <div
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] flex items-center justify-center text-sm text-gray-400"
              style={{ width: '210mm', height: '297mm' }}
            >
              Could not load a print preview for this purchase order.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}