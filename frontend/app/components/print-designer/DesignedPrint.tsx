'use client';

import { useMemo } from 'react';
import { useLanguage } from '@/app/context/LanguageContext';
import type { InvoiceView } from '@/app/components/invoices/types';
import type { QuotationView } from '@/app/components/quotations/types';
import type { SpkPrintView } from '@/app/components/workshop/SpkA4Template';
import { invoicePrintData, quotationPrintData, workOrderPrintData } from '@/lib/print-designer/context';
import type { Layout, PaperSize } from '@/lib/print-designer/types';
import { TemplateDocument } from './TemplateDocument';

type Design = { layout: Layout; paperSize: PaperSize };

// A design always prints on A4 sheets: A4 pages fill them, A5 pages sit on
// the top half (the same as the built-in A5 invoice).
export const DESIGN_PAGE_CSS = '@page { size: A4; margin: 0; }';

export function DesignedInvoice({ design, invoice, pageGap }: { design: Design; invoice: InvoiceView; pageGap?: number }) {
  const { t } = useLanguage();
  const data = useMemo(() => invoicePrintData(invoice, t), [invoice, t]);
  return <TemplateDocument layout={design.layout} paper={design.paperSize} data={data} pageGap={pageGap} />;
}

export function DesignedQuotation({ design, quotation, pageGap }: { design: Design; quotation: QuotationView; pageGap?: number }) {
  const { t } = useLanguage();
  const data = useMemo(() => quotationPrintData(quotation, t), [quotation, t]);
  return <TemplateDocument layout={design.layout} paper={design.paperSize} data={data} pageGap={pageGap} />;
}

export function DesignedWorkOrder({ design, view, pageGap }: { design: Design; view: SpkPrintView; pageGap?: number }) {
  const { t } = useLanguage();
  const data = useMemo(() => workOrderPrintData(view, t), [view, t]);
  return <TemplateDocument layout={design.layout} paper={design.paperSize} data={data} pageGap={pageGap} />;
}
