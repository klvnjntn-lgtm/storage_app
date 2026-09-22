// app/print/delivery-orders/[id]/page.tsx
//
// Puppeteer navigates here directly (see DeliveryOrderService.renderPdf():
// `${FRONTEND_URL}/print/delivery-orders/${id}?token=...`), with no session
// cookie — auth is the signed print token in the query string.
//
// FIX — this page used to be a client component that fetched
// `${NEXT_PUBLIC_API_URL}/delivery-orders/:id/print` with the print token
// as an `Authorization: Bearer` header. That route is behind
// JwtAuthGuard/OrgGuard (a real user session JWT, not a print token) —
// every request 401'd, so every delivery-order PDF/print rendered as this
// page's own error message instead of the document. The actual
// unauthenticated route is `GET print/delivery-orders/:id?token=...`
// (DeliveryOrderPrintController), which every sibling print page
// (invoices, sales-orders, quotations, purchase-orders) already uses via
// this same server-component pattern — matching that here instead of
// guessing at a client-side fetch.
import { DeliveryOrderA4Template } from '@/app/components/delivery-orders/templates/DeliveryOrderA4Template';
import { toDeliveryOrderView } from '@/lib/mappers/delivery-orders-mapper';
import type { DeliveryOrderPrintView } from '@/app/components/delivery-orders/types';

async function getPrintData(id: string, token: string): Promise<DeliveryOrderPrintView | null> {
  const base = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  const res = await fetch(`${base}/print/delivery-orders/${id}?token=${token}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function DeliveryOrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;

  if (!token) {
    return <div style={{ padding: 24 }}>Missing print token.</div>;
  }

  const raw = await getPrintData(id, token);
  if (!raw) {
    return <div style={{ padding: 24 }}>Unable to load delivery order for printing.</div>;
  }

  const order = toDeliveryOrderView(raw);

  return (
    <>
      {/* preferCSSPageSize on the puppeteer side reads this */}
      <style>{`
        @page { size: A4; margin: 0; }
        html, body { margin: 0; padding: 0; }
      `}</style>
      <DeliveryOrderA4Template order={order} />
    </>
  );
}
