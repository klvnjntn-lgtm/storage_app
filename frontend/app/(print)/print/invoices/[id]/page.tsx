// app/print/invoices/[id]/page.tsx
import { InvoicePrintArea } from '@/app/components/invoices/templates/InvoicePrintArea';
import { InvoiceFormat } from '@/app/components/invoices/types';
import { DESIGN_PAGE_CSS, DesignedInvoice } from '@/app/components/print-designer/DesignedPrint';
import { PAGE_CSS } from '@/lib/mappers/invoice-format';
import { InvoicePrintView, toInvoiceView } from '@/lib/mappers/invoice-mapper';
import type { ResolvedTemplate } from '@/lib/print-designer/types';

type PrintData = InvoicePrintView & { printTemplate?: ResolvedTemplate };

async function getPrintData(id: string, token: string, format?: string, templateId?: string): Promise<PrintData | null> {
  const base = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  const q = new URLSearchParams({ token, ...(format && { format }), ...(templateId && { templateId }) });
  const res = await fetch(`${base}/print/invoices/${encodeURIComponent(id)}?${q}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function PrintInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; format?: string; templateId?: string }>;
}) {
  const { id } = await params;
  const { token, format: formatParam, templateId } = await searchParams;

  const raw = await getPrintData(id, token ?? '', formatParam, templateId);
  if (!raw) {
    return <div style={{ padding: 24 }}>Unable to load invoice for printing.</div>;
  }

  const invoice = toInvoiceView(raw);
  // A print design (picked, or the branch default) replaces the built-in layout.
  if (raw.printTemplate) {
    return (
      <>
        <style>{DESIGN_PAGE_CSS}</style>
        <DesignedInvoice design={raw.printTemplate} invoice={invoice} />
      </>
    );
  }
  const format = (formatParam as InvoiceFormat) ?? invoice.format;

  return (
    <>
      <style>{PAGE_CSS[format] ?? PAGE_CSS.A4}</style>
      <InvoicePrintArea format={format} invoice={invoice} alwaysVisible />
    </>
  );
}
