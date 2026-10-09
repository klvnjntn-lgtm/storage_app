// app/(app)/sales/delivery-orders/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Truck, Ban, Printer, Download, PackageCheck, FileText, MapPin, MapPinOff, X } from 'lucide-react';
import GoogleMapsLink from '@/app/components/delivery/GoogleMapsLink';
import { apiFetch } from '@/lib/apifetch';
import { DeliveryOrderA4Template } from '@/app/components/delivery-orders/templates/DeliveryOrderA4Template';
import { toDeliveryOrderView, mapDeliveryOrderToDetail, type DeliveryOrderView } from '@/lib/mappers/delivery-orders-mapper';
import type { DeliveryOrderDetail } from '@/app/components/delivery-orders/types';
import { useLanguage } from '@/app/context/LanguageContext';
import ProofPhoto from '@/app/components/delivery/ProofPhoto';
import CustomerAddressPicker, { useCustomerAddresses } from '@/app/components/delivery/CustomerAddressPicker';


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
  const { t } = useLanguage();
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

  const [changingAddress, setChangingAddress] = useState(false);
  const [addressChoice, setAddressChoice] = useState('');
  const [defaultCustomer, setDefaultCustomer] = useState<{ address: string | null; hasLocation: boolean } | null>(null);
  const { addresses } = useCustomerAddresses(changingAddress ? order?.customerId : null);

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
        setError(body?.message ?? t('sales.deliveryOrderDetail.requestFailed', { status: detailRes.status }));
        return;
      }
      // FIX — was a bare type-assertion-via-annotation on the raw fetch
      // response. mapDeliveryOrderToDetail was defined for exactly this
      // and had zero callers anywhere.
      const detail: DeliveryOrderDetail = mapDeliveryOrderToDetail(await detailRes.json());
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
      setError(t('sales.deliveryOrderDetail.couldNotReachServer'));
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
        setError(resBody?.message ?? t('sales.deliveryOrderDetail.requestFailed', { status: res.status }));
        return;
      }
      return resBody;
    } catch {
      setError(t('sales.deliveryOrderDetail.couldNotReachServer'));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleShip() {
    if (await runAction('ship', `/delivery-orders/${id}/ship`)) load();
  }

  async function handleCancel() {
    if (!confirm(t('sales.deliveryOrderDetail.confirmCancel'))) return;
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

  async function openChangeAddress() {
    if (!order?.customerId) return;
    setAddressChoice('');
    setChangingAddress(true);
    const res = await apiFetch(`/customers/${order.customerId}`);
    if (res.ok) {
      const c = await res.json();
      setDefaultCustomer({ address: c.address ?? null, hasLocation: !!(c.latitude && c.longitude) });
    }
  }

  async function handleApplyAddress() {
    const ok = await runAction('address', `/delivery-orders/${id}/address`, 'PATCH', {
      customerAddressId: addressChoice || undefined,
    });
    if (ok) {
      setChangingAddress(false);
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
      if (!res.ok) throw new Error(t('sales.deliveryOrderDetail.failedGeneratePdf', { status: res.status }));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${order.doNumber ?? 'delivery-order'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || t('sales.deliveryOrderDetail.couldNotGeneratePdf'));
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

      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)] print:hidden">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight`}>{order.doNumber ?? order.id}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(order.status)}`}>
                  {t(`sales.deliveryOrderDetail.badge.${order.status}`)}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {order.customerName ?? t('sales.deliveryOrderDetail.noCustomer')} · {order.location?.name ?? '—'}
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
                    · {t('sales.deliveryOrderDetail.invoiceLabel')}{' '}
                    <button
                      className="underline font-medium"
                      onClick={() => router.push(`/sales/invoices/${order.invoiceId}`)}
                    >
                      {order.invoice.invoiceNumber}
                    </button>
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {order.status === 'PACKED' && (
                <>
                  <button
                    disabled={actionLoading === 'ship'}
                    onClick={handleShip}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    <Truck size={14} strokeWidth={2} />
                    {t('sales.deliveryOrderDetail.markShipped')}
                  </button>
                  <button
                    disabled={actionLoading === 'cancel'}
                    onClick={handleCancel}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-red-300 text-red-600 font-semibold hover:bg-red-50 disabled:opacity-50"
                  >
                    <Ban size={14} strokeWidth={2} />
                    {t('common.cancel')}
                  </button>
                </>
              )}

              {order.status === 'SHIPPED' && !order.invoice && (
                <button
                  disabled={actionLoading === 'convert-invoice'}
                  onClick={handleConvertToInvoice}
                  className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  <FileText size={14} strokeWidth={2} />
                  {t('sales.deliveryOrderDetail.convertToInvoice')}
                </button>
              )}

              {order.status !== 'PACKED' && (
                <>
                  <button
                    onClick={handleDownloadPdf}
                    disabled={pdfGenerating}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors"
                  >
                    <Download size={14} strokeWidth={2} />
                    {pdfGenerating ? t('sales.deliveryOrderDetail.generating') : t('sales.deliveryOrderDetail.downloadPdf')}
                  </button>
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                  >
                    <Printer size={14} strokeWidth={2} />
                    {t('common.print')}
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

        {order.invoice && (
          <div className="border-2 border-purple-200 bg-purple-50/50 rounded-md p-3">
            <p className="font-semibold text-purple-900 mb-1">{t('sales.deliveryOrderDetail.convertedFromInvoice')}</p>
            <p>{order.invoice.invoiceNumber}</p>
          </div>
        )}

        <div
          className={`flex items-start justify-between gap-3 border-2 rounded-md p-3 ${
            order.destinationLatitude ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0">
            {order.destinationLatitude ? (
              <MapPin size={16} className="text-green-700 shrink-0 mt-0.5" />
            ) : (
              <MapPinOff size={16} className="text-amber-700 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {t('delivery.addresses.deliveryAddress')}
                <span
                  className={`ml-2 text-[11px] font-medium px-1.5 py-0.5 rounded-full border ${
                    order.destinationLatitude
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-amber-100 text-amber-800 border-amber-300'
                  }`}
                >
                  {order.destinationLatitude ? t('delivery.routeDetail.locationSet') : t('delivery.routeDetail.noLocation')}
                </span>
              </p>
              <p className="text-xs text-gray-600 whitespace-pre-line">
                {order.deliveryAddress || t('delivery.addresses.noAddressText')}
              </p>
              <GoogleMapsLink lat={order.destinationLatitude} lng={order.destinationLongitude} />
            </div>
          </div>
          {order.customerId && (
            <button
              onClick={openChangeAddress}
              className="text-xs px-2.5 py-1.5 rounded-md border-2 border-gray-300 bg-white font-semibold hover:border-blue-500/40 transition-colors shrink-0"
            >
              {t('delivery.addresses.change')}
            </button>
          )}
        </div>

        {needsProof && (
          <div className="border-2 border-gray-300 rounded-md p-3 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-sm">
              <PackageCheck size={15} strokeWidth={2} />
              {t('sales.deliveryOrderDetail.recordProof')}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                value={deliveredBy}
                onChange={(e) => setDeliveredBy(e.target.value)}
                placeholder={t('sales.deliveryOrderDetail.deliveredByPlaceholder')}
                className="text-sm px-2.5 py-2 rounded-md border-2 border-gray-300 focus:outline-none focus:border-blue-500"
              />
              <input
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                placeholder={t('sales.deliveryOrderDetail.receivedByPlaceholder')}
                className="text-sm px-2.5 py-2 rounded-md border-2 border-gray-300 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              disabled={actionLoading === 'proof' || (!deliveredBy.trim() && !receivedBy.trim())}
              onClick={handleRecordProof}
              className="text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {t('sales.deliveryOrderDetail.saveSignature')}
            </button>
          </div>
        )}

        {order.hasProofPhoto && <ProofPhoto linkPath={`/delivery-orders/${order.id}/proof-photo-link`} />}
      </div>

      {changingAddress && (
        <div className="fixed inset-0 bg-black/25 flex items-end sm:items-center justify-center z-[60] sm:p-4 print:hidden">
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-lg w-full max-w-lg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('delivery.addresses.changeTitle')}</h3>
              <button onClick={() => setChangingAddress(false)} aria-label={t('common.cancel')} className="p-2 -m-2 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <CustomerAddressPicker
              addresses={addresses}
              defaultAddress={defaultCustomer?.address}
              defaultHasLocation={defaultCustomer?.hasLocation}
              value={addressChoice}
              onChange={setAddressChoice}
            />
            {addresses.length === 0 && <p className="text-xs text-gray-500">{t('delivery.addresses.noneSavedHint')}</p>}
            <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2">
              <button
                onClick={() => setChangingAddress(false)}
                className="text-sm font-medium border border-gray-300 rounded-md px-3 py-2.5 sm:py-1.5"
              >
                {t('common.cancel')}
              </button>
              <button
                disabled={actionLoading === 'address'}
                onClick={handleApplyAddress}
                className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
              >
                {actionLoading === 'address' ? t('common.saving') : t('delivery.addresses.useThisAddress')}
              </button>
            </div>
          </div>
        </div>
      )}

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
              {previewError ? t('sales.deliveryOrderDetail.previewError') : t('sales.deliveryOrderDetail.loadingPreview')}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
