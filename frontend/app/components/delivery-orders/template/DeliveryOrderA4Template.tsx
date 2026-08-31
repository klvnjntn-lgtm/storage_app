// app/components/delivery-orders/template/DeliveryOrderA4Template.tsx
import type { DeliveryOrderView } from '@/lib/delivery-orders-mapper';

export function DeliveryOrderA4Template({ order }: { order: DeliveryOrderView }) {
  return (
    <div className="bg-white text-black text-sm" style={{ width: '210mm', minHeight: '297mm', padding: '15mm' }}>
      <div className="flex items-start justify-between pb-4 border-b-2 border-black">
        <div className="flex items-center gap-3">
          {order.business.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={order.business.logoUrl} alt="" className="h-14 w-14 object-contain" />
          )}
          <div>
            <p className="font-bold text-lg">{order.business.legalName ?? order.business.name}</p>
            {order.business.address && (
              <p className="text-xs text-gray-600 whitespace-pre-line">{order.business.address}</p>
            )}
            {order.business.phone && <p className="text-xs text-gray-600">{order.business.phone}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold tracking-wide">DELIVERY ORDER</p>
          <p className="text-sm font-semibold mt-1">{order.doNumber ?? 'DRAFT'}</p>
        </div>
      </div>

      {/* Facts bar — Delivery Date is shippedAt (null until ship()), kept
          distinct from the order's createdAt so it isn't mistaken for the
          date goods actually left the warehouse. */}
      <div className="grid grid-cols-3 gap-4 py-4 border-b border-gray-200">
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Delivery Date</p>
          <p className="text-sm font-semibold">
            {order.shippedAt ? new Date(order.shippedAt).toLocaleDateString('id-ID') : 'Pending shipment'}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Sales Order Ref</p>
          <p className="text-sm font-semibold">{order.salesOrderNumber ?? '—'}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Order Created</p>
          <p className="text-sm">{new Date(order.createdAt).toLocaleDateString('id-ID')}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 py-4">
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Customer Information</p>
          <p className="font-semibold">{order.customer.name ?? '—'}</p>
          {order.customer.phone && <p className="text-xs text-gray-600">{order.customer.phone}</p>}
          {order.customer.poNumber && <p className="text-xs text-gray-600">Customer PO: {order.customer.poNumber}</p>}
          <p className="text-xs text-gray-600">Ship from: {order.location.name}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Delivery Address</p>
          <p className="text-xs text-gray-700 whitespace-pre-line">{order.deliveryAddress ?? '—'}</p>
        </div>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-y-2 border-black">
            <th className="text-left py-2 w-8">#</th>
            <th className="text-left py-2">Item</th>
            <th className="text-right py-2 w-28">Qty Delivered</th>
            <th className="text-left py-2 w-20 pl-3">Unit</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={item.id} className="border-b border-gray-200">
              <td className="py-2 text-gray-500">{i + 1}</td>
              <td className="py-2">{item.productName}</td>
              <td className="py-2 text-right">{item.quantity}</td>
              <td className="py-2 pl-3">{item.unit ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {order.notes && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes</p>
          <p className="text-xs whitespace-pre-line">{order.notes}</p>
        </div>
      )}

      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mt-10">
        Proof of Delivery
      </p>
      <div className="grid grid-cols-2 gap-8 mt-6">
        <div className="text-center">
          <div className="h-16 border-b border-gray-400 flex items-end justify-center pb-1">
            {order.proofOfDelivery.signedAt && (
              <span className="text-[10px] text-gray-400">
                Signed {new Date(order.proofOfDelivery.signedAt).toLocaleDateString('id-ID')}
              </span>
            )}
          </div>
          <p className="text-xs font-semibold mt-1">Delivered by</p>
          <p className="text-xs text-gray-500">{order.proofOfDelivery.deliveredBy ?? ''}</p>
        </div>
        <div className="text-center">
          <div className="h-16 border-b border-gray-400" />
          <p className="text-xs font-semibold mt-1">Received by</p>
          <p className="text-xs text-gray-500">{order.proofOfDelivery.receivedBy ?? ''}</p>
        </div>
      </div>
    </div>
  );
}