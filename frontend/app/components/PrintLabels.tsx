import Barcode from 'react-barcode';

type Item = {
  sku: string;
  name: string;
};

type PrintLabelsProps = {
  printTarget: Item[] | null;
};

/**
 * Print-only label grid. Renders nothing visible on screen; only shown
 * via the `.print-only` class when the browser print dialog is active.
 * Keep this as its own component so the print stylesheet and markup
 * stay isolated from the interactive page.
 */
export default function PrintLabels({ printTarget }: PrintLabelsProps) {
  return (
    <>
      <div className="print-only label-grid">
        {(printTarget ?? []).map((item, idx) => (
          <div key={`${item.sku}-${idx}`} className="label-card">
            <p className="font-bold text-sm truncate w-full">{item.sku}</p>
            <p className="text-xs text-gray-600 mb-2 truncate w-full">{item.name}</p>
            <Barcode value={item.sku} height={30} width={1.3} fontSize={10} margin={0} />
          </div>
        ))}
      </div>

      <style jsx global>{`
.print-only {
  display: none;
}

@media print {
  /* Hide everything by default, including layout chrome (navbar, sidebars)
     that lives outside this component's tree and can't be reached with
     .no-print alone — then explicitly reveal just the label grid. */
  body * {
    visibility: hidden;
  }

  .print-only,
  .print-only * {
    visibility: visible;
  }

  .print-only.label-grid {
    display: grid !important;
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }

  html, body {
    margin: 0;
    padding: 0;
  }

  @page {
    size: A4 portrait;
    margin: 0.4in;
  }

  .print-only.label-grid {
    grid-template-columns: repeat(auto-fill, 2in);
    grid-auto-rows: 1in;
    gap: 0.15in;
    justify-content: start;
    align-content: start;
  }

  .label-card {
    box-sizing: border-box;
    border: 1px dashed #ccc !important;
    border-radius: 0 !important;
    width: 2in;
    height: 1in;
    padding: 0.05in 0.1in !important;
    display: flex !important;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .label-card p {
    margin: 0 !important;
    line-height: 1.1;
  }

  .label-card svg {
    max-width: 100%;
    height: auto !important;
  }
}
      `}</style>
    </>
  );
}