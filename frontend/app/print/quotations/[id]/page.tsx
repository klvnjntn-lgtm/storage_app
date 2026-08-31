// app/print/quotations/[id]/page.tsx
import { QuotationA4Template } from '@/app/components/quotations/template/QuotationA4Template';
import { QuotationPrintView, toQuotationView } from '@/lib/quotation-mapper';

async function getPrintData(id: string, token: string): Promise<QuotationPrintView | null> {
  const base = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  const res = await fetch(`${base}/print/quotations/${id}?token=${token}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function PrintQuotationPage({
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
    return <div style={{ padding: 24 }}>Unable to load quotation for printing.</div>;
  }

  const quotation = toQuotationView(raw);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        body { margin: 0; }
      `}</style>
      <QuotationA4Template quotation={quotation} />
    </>
  );
}