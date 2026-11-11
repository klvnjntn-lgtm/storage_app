// app/print/quotations/[id]/page.tsx
import { QuotationA4Template } from '@/app/components/quotations/templates/QuotationA4Template';
import { QuotationPrintError } from '@/app/components/quotations/templates/QuotationPrintError';
import { DESIGN_PAGE_CSS, DesignedQuotation } from '@/app/components/print-designer/DesignedPrint';
import { QuotationPrintView, toQuotationView } from '@/lib/mappers/quotation-mapper';
import type { ResolvedTemplate } from '@/lib/print-designer/types';

type PrintData = QuotationPrintView & { printTemplate?: ResolvedTemplate };

async function getPrintData(id: string, token: string, templateId?: string): Promise<PrintData | null> {
  const base = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  const q = new URLSearchParams({ token, ...(templateId && { templateId }) });
  const res = await fetch(`${base}/print/quotations/${encodeURIComponent(id)}?${q}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function PrintQuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; templateId?: string }>;
}) {
  const { id } = await params;
  const { token, templateId } = await searchParams;

  const raw = await getPrintData(id, token ?? '', templateId);
  if (!raw) {
    return <QuotationPrintError />;
  }

  const quotation = toQuotationView(raw);

  if (raw.printTemplate) {
    return (
      <>
        <style>{DESIGN_PAGE_CSS}</style>
        <DesignedQuotation design={raw.printTemplate} quotation={quotation} />
      </>
    );
  }

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
