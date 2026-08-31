// app/print/invoices/[id]/page.tsx
import { InvoicePrintArea } from '@/app/components/invoices/templates/InvoicePrintArea';
import { InvoiceFormat } from '@/app/components/invoices/types';
import { PAGE_CSS } from '@/lib/invoice-format';
import { InvoicePrintView, toInvoiceView } from '@/lib/invoice-mapper';

async function getPrintData(id: string, token: string): Promise<InvoicePrintView | null> {
  const base = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  const res = await fetch(`${base}/print/invoices/${id}?token=${token}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function PrintInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; format?: string }>;
}) {
  const { id } = await params;
  const { token, format: formatParam } = await searchParams;

  const raw = await getPrintData(id, token ?? '');
  if (!raw) {
    return <div style={{ padding: 24 }}>Unable to load invoice for printing.</div>;
  }

  const invoice = toInvoiceView(raw);
  const format = (formatParam as InvoiceFormat) ?? invoice.format;

  return (
    <>
      <style>{PAGE_CSS[format] ?? PAGE_CSS.A4}</style>
      <InvoicePrintArea format={format} invoice={invoice} alwaysVisible />
    </>
  );
}