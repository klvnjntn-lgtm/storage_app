// app/print/sales-orders/[id]/page.tsx — corrected to route raw JSON
// through a mapper, same as invoice/quotation, instead of trusting the
// fetch response's types at face value.
import { SalesOrderA4Template } from '@/app/components/sales-orders/template/SalesOrderA4Template';
import { SalesOrderPrintView, toSalesOrderView } from '@/lib/sales-order.mapper';

async function getPrintData(id: string, token: string): Promise<SalesOrderPrintView | null> {
  const base = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  const res = await fetch(`${base}/print/sales-orders/${id}?token=${token}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function PrintSalesOrderPage({
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
    return <div style={{ padding: 24 }}>Unable to load sales order for printing.</div>;
  }

  const order = toSalesOrderView(raw);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        body { margin: 0; }
      `}</style>
      <SalesOrderA4Template order={order} />
    </>
  );
}