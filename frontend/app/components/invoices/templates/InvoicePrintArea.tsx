// components/invoices/templates/InvoicePrintArea.tsx
import { InvoiceFormat, InvoiceView } from '../types';
import { Thermal58Template } from './Thermal58Template';
import { ReceiptTemplate } from './ReceiptTemplate';
import { A5Template } from './A5Template';
import { A4Template } from './A4Template';

export function InvoicePrintArea({
  format,
  invoice,
  alwaysVisible = false,
}: {
  format: InvoiceFormat;
  invoice: InvoiceView;
  // The standalone /print route (used by Puppeteer for PDF generation)
  // has no other content on the page — it should always render, not
  // depend on @media print matching correctly inside headless Chromium.
  // The in-app detail page keeps the default (hidden until window.print()).
  alwaysVisible?: boolean;
}) {
  return (
    <div id="print-area" className={alwaysVisible ? 'block' : 'hidden print:block'}>
      {format === 'THERMAL_58' && <Thermal58Template invoice={invoice} />}
      {format === 'RECEIPT' && <ReceiptTemplate invoice={invoice} />}
      {format === 'A5' && <A5Template invoice={invoice} />}
      {format === 'A4' && <A4Template invoice={invoice} />}
    </div>
  );
}