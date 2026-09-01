// app/print/purchase-orders/[id]/page.tsx
import { PurchaseOrderTemplate } from '@/app/components/purchase-orders/templates/PurchaseOrderTemplate';
import { PurchaseOrderPrintView } from '@/app/components/purchase-orders/types';

async function getPrintData(id: string, token: string): Promise<PurchaseOrderPrintView | null> {
  const base = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  const res = await fetch(`${base}/print/purchase-orders/${id}?token=${token}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function PrintPurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;

  const po = await getPrintData(id, token ?? '');
  if (!po) {
    return <div style={{ padding: 24 }}>Unable to load purchase order for printing.</div>;
  }

  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        body { margin: 0; }
      `}</style>
      <PurchaseOrderTemplate po={po} />
    </>
  );
}