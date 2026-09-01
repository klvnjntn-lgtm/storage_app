// app/print/delivery-orders/[id]/page.tsx
//
// Puppeteer navigates here directly (see DeliveryOrderService.renderPdf():
// `${FRONTEND_URL}/print/delivery-orders/${id}?token=...`), with no session
// cookie — auth is the signed print token in the query string, verified
// server-side via PrintTokenService.verifyDocumentToken. This route must
// stay outside the authenticated (app) layout group: no sidebar, no nav,
// nothing that needs a logged-in session.
//
// ASSUMPTION: the backend exposes the print-view JSON at
// `${NEXT_PUBLIC_API_URL}/delivery-orders/:id/print` and accepts the print
// token as `Authorization: Bearer <token>` for unauthenticated requests —
// mirroring how the interactive detail page hits the same path under normal
// session auth. Adjust the fetch below if your controller expects the token
// a different way (e.g. as a query param instead of a header).
'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { DeliveryOrderA4Template } from '@/app/components/delivery-orders/template/DeliveryOrderA4Template';
import { toDeliveryOrderView, type DeliveryOrderView } from '@/lib/delivery-orders-mapper';

export default function DeliveryOrderPrintPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [order, setOrder] = useState<DeliveryOrderView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing print token.');
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/delivery-orders/${params.id}/print`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          setError(`Could not load this delivery order (${res.status}).`);
          return;
        }
        setOrder(toDeliveryOrderView(await res.json()));
      } catch {
        setError('Could not reach the server.');
      }
    })();
  }, [params.id, token]);

  if (error) {
    return (
      <div className="p-8 text-sm text-red-600">
        {error}
      </div>
    );
  }

  if (!order) {
    return <div className="p-8 text-sm text-gray-400">Loading...</div>;
  }

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