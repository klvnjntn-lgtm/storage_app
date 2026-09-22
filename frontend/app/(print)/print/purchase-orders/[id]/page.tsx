// app/print/purchase-orders/[id]/page.tsx — routes raw JSON through a
// mapper, same as invoice/quotation/sales-order, instead of trusting the
// fetch response's types at face value. See lib/mappers/purchase-order-mapper.ts.
import { PurchaseOrderTemplate } from '@/app/components/purchase-orders/templates/PurchaseOrderTemplate';
import { PrintLoadError } from '@/app/components/purchase-orders/PrintLoadError';
import { RawPurchaseOrderPrintView, toPurchaseOrderView } from '@/lib/mappers/purchase-order-mapper';

async function getPrintData(id: string, token: string): Promise<RawPurchaseOrderPrintView | null> {
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

  const raw = await getPrintData(id, token ?? '');
  if (!raw) {
    return <PrintLoadError />;
  }

  const po = toPurchaseOrderView(raw);

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