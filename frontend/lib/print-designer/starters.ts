import {
  type Band,
  type DocType,
  type ImageElement,
  type Layout,
  type LayoutElement,
  type LineElement,
  type PaperSize,
  type RectElement,
  type TableColumn,
  type TextElement,
  newElementId,
} from './types';

// Ready-made designs a new template starts from: close to the app's own
// built-in layouts, so a business only moves what it wants to change.

type Lang = 'en' | 'id';

export function textEl(x: number, y: number, w: number, h: number, text: string, style: Partial<TextElement> = {}): TextElement {
  return {
    id: newElementId(),
    type: 'text',
    x,
    y,
    w,
    h,
    showIf: '',
    text,
    fontFamily: '',
    fontSize: 9,
    bold: false,
    italic: false,
    underline: false,
    uppercase: false,
    align: 'left',
    vAlign: 'top',
    color: '#000000',
    fit: 'shrink',
    hideIfEmpty: true,
    ...style,
  };
}

export function lineEl(x: number, y: number, w: number, h = 0, style: Partial<LineElement> = {}): LineElement {
  return { id: newElementId(), type: 'line', x, y, w, h, showIf: '', thickness: 0.3, color: '#000000', lineStyle: 'solid', ...style };
}

export function rectEl(x: number, y: number, w: number, h: number, style: Partial<RectElement> = {}): RectElement {
  return {
    id: newElementId(),
    type: 'rect',
    x,
    y,
    w,
    h,
    showIf: '',
    borderWidth: 0.3,
    borderColor: '#000000',
    fill: '',
    radius: 0,
    lineStyle: 'solid',
    ...style,
  };
}

export function imageEl(x: number, y: number, w: number, h: number, src = 'logo'): ImageElement {
  return { id: newElementId(), type: 'image', x, y, w, h, showIf: '', src, fit: 'contain' };
}

const L = {
  en: {
    billTo: 'BILL TO',
    quotedTo: 'QUOTED TO',
    vehicle: 'VEHICLE',
    no: 'No.',
    date: 'Date',
    due: 'Due',
    validUntil: 'Valid until',
    po: 'PO no.',
    item: 'Item',
    qty: 'Qty',
    price: 'Price',
    disc: 'Disc.',
    total: 'Total',
    type: 'Type',
    subtotal: 'Subtotal',
    discount: 'Discount',
    tax: 'Tax',
    paid: 'Paid',
    balance: 'Balance due',
    words: 'In words: {totals.words}',
    payTo: 'PAYMENT TO',
    bankLine: '{bank.name} {bank.accountNumber} a/n {bank.accountName}',
    notes: 'NOTES',
    terms: 'TERMS & CONDITIONS',
    received: 'Received by',
    regards: 'Regards',
    page: 'Page {page.number} of {page.count}',
    customer: 'Customer',
    mechanic: 'Mechanic',
    odometer: 'Odometer',
    complaint: 'COMPLAINT',
    estimate: 'Estimate',
    advisor: 'Service advisor',
    approval: 'Customer approval',
  },
  id: {
    billTo: 'KEPADA YTH.',
    quotedTo: 'DITAWARKAN KEPADA',
    vehicle: 'KENDARAAN',
    no: 'No.',
    date: 'Tanggal',
    due: 'Jatuh tempo',
    validUntil: 'Berlaku s/d',
    po: 'No. PO',
    item: 'Barang / Jasa',
    qty: 'Qty',
    price: 'Harga',
    disc: 'Diskon',
    total: 'Jumlah',
    type: 'Jenis',
    subtotal: 'Subtotal',
    discount: 'Diskon',
    tax: 'Pajak',
    paid: 'Dibayar',
    balance: 'Sisa tagihan',
    words: 'Terbilang: {totals.words}',
    payTo: 'PEMBAYARAN KE',
    bankLine: '{bank.name} {bank.accountNumber} a.n. {bank.accountName}',
    notes: 'CATATAN',
    terms: 'SYARAT & KETENTUAN',
    received: 'Penerima',
    regards: 'Hormat kami',
    page: 'Halaman {page.number} dari {page.count}',
    customer: 'Pelanggan',
    mechanic: 'Mekanik',
    odometer: 'Odometer',
    complaint: 'KELUHAN',
    estimate: 'Estimasi',
    advisor: 'Service advisor',
    approval: 'Persetujuan pelanggan',
  },
};

const col = (key: TableColumn['key'], label: string, width: number, align: TableColumn['align'] = 'left', hideIfEmpty = false): TableColumn => ({
  key,
  label,
  width,
  align,
  hideIfEmpty,
});

function emptyBand(height = 0): Band {
  return { height, elements: [] };
}

function baseLayout(paper: PaperSize): Layout {
  const m = paper === 'A4' ? 12 : 8;
  return {
    version: 1,
    page: { margins: { top: m, right: m, bottom: m, left: m } },
    font: { family: 'sans', size: 9 },
    bands: { pageHeader: emptyBand(), header: emptyBand(), footer: emptyBand(), pageFooter: emptyBand() },
    footerAtBottom: false,
    table: {
      columns: [],
      fontSize: paper === 'A4' ? 8.5 : 8,
      headerFontSize: paper === 'A4' ? 8.5 : 8,
      headerBold: true,
      headerBg: '#f1f5f9',
      headerColor: '#000000',
      borders: 'rows',
      borderColor: '#9ca3af',
      rowPadding: paper === 'A4' ? 1.5 : 1,
      zebra: '',
      minRows: 0,
      gapBefore: 2,
      gapAfter: 3,
    },
  };
}

// Business block, top left: logo then name, address, phone, NPWP.
function businessBlock(paper: PaperSize): LayoutElement[] {
  if (paper === 'A4') {
    return [
      imageEl(0, 0, 22, 22),
      textEl(25, 0, 95, 8, '{business.name}', { fontSize: 15, bold: true }),
      textEl(25, 8, 95, 4.5, '{branch.name}', { fontSize: 8.5, bold: true }),
      textEl(25, 12.5, 95, 4.5, '{business.address}', { fontSize: 8 }),
      textEl(25, 17, 95, 4.5, '{business.phone}', { fontSize: 8 }),
      textEl(25, 21.5, 95, 4.5, 'NPWP: {business.npwp}', { fontSize: 8 }),
    ];
  }
  return [
    imageEl(0, 0, 15, 15),
    textEl(18, 0, 100, 6, '{business.name}', { fontSize: 12, bold: true }),
    textEl(18, 6, 100, 4, '{business.address}', { fontSize: 7.5 }),
    textEl(18, 10, 100, 4, '{business.phone}   NPWP: {business.npwp}', { fontSize: 7.5 }),
  ];
}

// Title and number block, top right; `extra` = more "label: {field}" rows.
function docBlock(paper: PaperSize, lang: Lang, extra: [string, string][]): LayoutElement[] {
  const t = L[lang];
  const x = paper === 'A4' ? 120 : 128;
  const w = paper === 'A4' ? 66 : 66;
  const rowH = paper === 'A4' ? 5 : 4;
  const fs = paper === 'A4' ? 9 : 8;
  const rows: [string, string][] = [[t.no, '{doc.number}'], [t.date, '{doc.date}'], ...extra];
  return [
    textEl(x, 0, w, paper === 'A4' ? 9 : 7, '{doc.title}', { fontSize: paper === 'A4' ? 16 : 13, bold: true, align: 'right', uppercase: true }),
    ...rows.map(([label, value], i) =>
      textEl(x, (paper === 'A4' ? 10 : 7.5) + i * rowH, w, rowH, `${label}: ${value}`, { fontSize: fs, align: 'right' }),
    ),
  ];
}

function pageFooter(paper: PaperSize, lang: Lang, width: number): Band {
  return {
    height: paper === 'A4' ? 6 : 5,
    elements: [
      textEl(0, 0.5, 90, 4.5, '{doc.number}', { fontSize: 7, color: '#6b7280' }),
      textEl(width - 70, 0.5, 70, 4.5, L[lang].page, { fontSize: 7, color: '#6b7280', align: 'right' }),
    ],
  };
}

function signatures(labels: string[], y: number, width: number, paper: PaperSize, lastName = ''): LayoutElement[] {
  const boxW = paper === 'A4' ? 48 : 42;
  const gap = labels.length > 1 ? (width - boxW * labels.length) / (labels.length - 1) : 0;
  const tall = paper === 'A4' ? 20 : 13;
  return labels.flatMap((label, i) => {
    const x = Math.round((i * (boxW + gap)) * 10) / 10;
    const els: LayoutElement[] = [
      textEl(x, y, boxW, 5, label, { align: 'center', fontSize: paper === 'A4' ? 9 : 8 }),
      lineEl(x + 3, y + 5 + tall, boxW - 6, 0, { thickness: 0.25 }),
    ];
    if (i === labels.length - 1 && lastName) {
      els.push(textEl(x, y + 6 + tall, boxW, 4.5, lastName, { align: 'center', fontSize: 8 }));
    }
    return els;
  });
}

// Totals on the right: [label, field, showIf, bold]
function totalsBlock(rows: [string, string, string, boolean][], x: number, width: number, paper: PaperSize): LayoutElement[] {
  const rowH = paper === 'A4' ? 5 : 4.2;
  const fs = paper === 'A4' ? 9 : 8;
  const labelW = width * 0.45;
  const els: LayoutElement[] = [];
  let y = 0;
  for (const [label, field, showIf, bold] of rows) {
    if (label === '—') {
      els.push(lineEl(x, y + 0.5, width, 0, { thickness: 0.4 }));
      y += 1.5;
      continue;
    }
    const big = bold && field === '{totals.total}';
    const h = big ? rowH + 1.5 : rowH;
    els.push(textEl(x, y, labelW, h, label, { fontSize: big ? fs + 2 : fs, bold, showIf }));
    els.push(textEl(x + labelW, y, width - labelW, h, field, { fontSize: big ? fs + 2 : fs, bold, align: 'right', showIf }));
    y += h;
  }
  return els;
}

function invoiceLike(docType: 'INVOICE' | 'QUOTATION', paper: PaperSize, lang: Lang): Layout {
  const t = L[lang];
  const layout = baseLayout(paper);
  const W = 210 - layout.page.margins.left - layout.page.margins.right;
  const a4 = paper === 'A4';
  const isInvoice = docType === 'INVOICE';
  const extra: [string, string][] = isInvoice ? [[t.due, '{doc.dueDate}']] : [[t.validUntil, '{doc.validUntil}']];

  const custY = a4 ? 30 : 17;
  const lh = a4 ? 4.5 : 3.8;
  const fs = a4 ? 9 : 8;
  const half = W / 2 - 4;
  layout.bands.header = {
    height: a4 ? 60 : 38,
    elements: [
      ...businessBlock(paper),
      ...docBlock(paper, lang, extra),
      lineEl(0, custY - 2, W, 0, { thickness: 0.4 }),
      textEl(0, custY, half, lh, isInvoice ? t.billTo : t.quotedTo, { fontSize: fs - 1, bold: true, color: '#374151' }),
      textEl(0, custY + lh, half, lh + 0.5, '{customer.name}', { fontSize: fs + 1, bold: true }),
      textEl(0, custY + lh * 2 + 0.5, half, lh * 2, isInvoice ? '{customer.billingAddress}' : '{customer.address}', { fontSize: fs }),
      textEl(0, custY + lh * 4 + 0.5, half, lh, '{customer.phone}', { fontSize: fs }),
      ...(a4 ? [textEl(0, custY + lh * 5 + 0.5, half, lh, 'NPWP: {customer.npwp}', { fontSize: fs })] : []),
      textEl(W / 2 + 4, custY, half, lh, t.vehicle, { fontSize: fs - 1, bold: true, color: '#374151', showIf: 'vehicle.plate' }),
      textEl(W / 2 + 4, custY + lh, half, lh + 0.5, '{vehicle.plate}  {vehicle.model}', { fontSize: fs + 1, bold: true }),
      textEl(W / 2 + 4, custY + lh * 2 + 0.5, half, lh, `${t.odometer}: {vehicle.odometer}`, { fontSize: fs }),
      ...(isInvoice ? [textEl(W / 2 + 4, custY + lh * 3 + 0.5, half, lh, `${t.po}: {doc.poNumber}`, { fontSize: fs })] : []),
    ],
  };

  layout.table.columns = [
    col('no', t.no, a4 ? 9 : 8),
    col('name', t.item, 0),
    col('qtyUnit', t.qty, a4 ? 20 : 17, 'right'),
    col('price', t.price, a4 ? 28 : 26, 'right'),
    col('discount', t.disc, a4 ? 24 : 22, 'right', true),
    col('total', t.total, a4 ? 30 : 28, 'right'),
  ];

  const tx = a4 ? W - 76 : W - 70;
  const tw = a4 ? 76 : 70;
  const totals = totalsBlock(
    [
      [t.subtotal, '{totals.subtotal}', '', false],
      [t.discount, '-{totals.discount}', 'totals.discount', false],
      [t.tax, '{totals.tax}', 'totals.tax', false],
      ['—', '', '', false],
      [t.total, '{totals.total}', '', true],
      ...(isInvoice
        ? ([
            [t.paid, '{totals.paid}', 'totals.paid', false],
            [t.balance, '{totals.balance}', 'totals.paid', true],
          ] as [string, string, string, boolean][])
        : []),
    ],
    tx,
    tw,
    paper,
  );
  const leftW = tx - 6;
  const left: LayoutElement[] = [
    textEl(0, 0, leftW, a4 ? 9 : 7, t.words, { fontSize: a4 ? 8.5 : 7.5, italic: true }),
    textEl(0, a4 ? 11 : 8, leftW, lh, t.payTo, { fontSize: fs - 1, bold: true, color: '#374151', showIf: 'bank.accountNumber' }),
    textEl(0, a4 ? 11 + lh : 8 + lh, leftW, lh, t.bankLine, { fontSize: fs, showIf: 'bank.accountNumber' }),
    textEl(0, a4 ? 22 : 16.5, leftW, lh, isInvoice ? t.notes : t.terms, {
      fontSize: fs - 1,
      bold: true,
      color: '#374151',
      showIf: isInvoice ? 'doc.notes' : 'doc.terms',
    }),
    textEl(0, a4 ? 22 + lh : 16.5 + lh, leftW, a4 ? 14 : 7, isInvoice ? '{doc.notes}' : '{doc.terms}', { fontSize: a4 ? 8 : 7 }),
  ];
  const sigY = a4 ? 44 : 29;
  layout.bands.footer = {
    height: a4 ? 78 : 50,
    elements: [...totals, ...left, ...signatures([t.received, t.regards], sigY, W, paper, '{business.name}')],
  };
  layout.bands.pageFooter = pageFooter(paper, lang, W);
  return layout;
}

function workOrder(paper: PaperSize, lang: Lang): Layout {
  const t = L[lang];
  const layout = baseLayout(paper);
  const W = 210 - layout.page.margins.left - layout.page.margins.right;
  const a4 = paper === 'A4';
  const lh = a4 ? 5 : 4;
  const fs = a4 ? 9 : 8;
  const y0 = a4 ? 30 : 17;
  const labelW = a4 ? 28 : 24;
  const half = W / 2 - 4;
  const detail = (x: number, y: number, label: string, value: string) => [
    textEl(x, y, labelW, lh, label, { fontSize: fs, color: '#4b5563', hideIfEmpty: false }),
    textEl(x + labelW, y, half - labelW, lh, value, { fontSize: fs, bold: true }),
  ];
  const complaintY = y0 + lh * 3 + 2;
  layout.bands.header = {
    height: a4 ? 70 : 44,
    elements: [
      ...businessBlock(paper),
      ...docBlock(paper, lang, [[t.validUntil, '{doc.validUntil}']]),
      lineEl(0, y0 - 2, W, 0, { thickness: 0.4 }),
      ...detail(0, y0, t.customer, '{customer.name}'),
      ...detail(0, y0 + lh, '', '{customer.phone}'),
      ...detail(0, y0 + lh * 2, t.mechanic, '{mechanic.name}'),
      ...detail(W / 2 + 4, y0, t.vehicle.charAt(0) + t.vehicle.slice(1).toLowerCase(), '{vehicle.plate}  {vehicle.model}'),
      ...detail(W / 2 + 4, y0 + lh, t.odometer, '{vehicle.odometer}'),
      ...detail(W / 2 + 4, y0 + lh * 2, t.po, '{doc.poNumber}'),
      textEl(0, complaintY, W, lh, t.complaint, { fontSize: fs - 1, bold: true, color: '#374151', hideIfEmpty: false }),
      rectEl(0, complaintY + lh, W, a4 ? 18 : 10, { borderColor: '#9ca3af', radius: 1 }),
      textEl(2, complaintY + lh + 1.5, W - 4, a4 ? 15 : 7, '{vehicle.complaint}', { fontSize: fs }),
    ],
  };
  layout.table.columns = [
    col('no', t.no, a4 ? 9 : 8),
    col('name', t.item, 0),
    col('type', t.type, a4 ? 22 : 18),
    col('qty', t.qty, a4 ? 14 : 12, 'right'),
    col('price', t.price, a4 ? 28 : 26, 'right', true),
    col('total', t.total, a4 ? 30 : 28, 'right', true),
  ];
  const tx = W - (a4 ? 76 : 70);
  layout.bands.footer = {
    height: a4 ? 62 : 40,
    elements: [
      ...totalsBlock(
        [
          [t.subtotal, '{totals.subtotal}', 'totals.discount', false],
          [t.discount, '-{totals.discount}', 'totals.discount', false],
          [t.tax, '{totals.tax}', 'totals.tax', false],
          [t.estimate, '{totals.total}', 'totals.total', true],
        ],
        tx,
        W - tx,
        paper,
      ),
      textEl(0, 0, tx - 6, lh, t.notes, { fontSize: fs - 1, bold: true, color: '#374151', showIf: 'doc.notes' }),
      textEl(0, lh, tx - 6, a4 ? 14 : 8, '{doc.notes}', { fontSize: a4 ? 8.5 : 7.5 }),
      ...signatures([t.customer, t.advisor, t.mechanic], a4 ? 28 : 18, W, paper),
    ],
  };
  layout.bands.pageFooter = pageFooter(paper, lang, W);
  return layout;
}

export function starterLayout(docType: DocType, paper: PaperSize, lang: Lang): Layout {
  if (docType === 'WORK_ORDER') return workOrder(paper, lang);
  return invoiceLike(docType, paper, lang);
}

// An empty page with just an items table.
export function blankLayout(docType: DocType, paper: PaperSize, lang: Lang): Layout {
  const t = L[lang];
  const layout = baseLayout(paper);
  layout.bands.header = emptyBand(paper === 'A4' ? 50 : 30);
  layout.bands.footer = emptyBand(paper === 'A4' ? 40 : 25);
  layout.table.columns = [
    col('no', t.no, 9),
    col('name', t.item, 0),
    ...(docType === 'WORK_ORDER' ? [col('qty', t.qty, 16, 'right')] : [col('qtyUnit', t.qty, 20, 'right')]),
    col('price', t.price, 28, 'right', docType === 'WORK_ORDER'),
    col('total', t.total, 30, 'right', docType === 'WORK_ORDER'),
  ];
  return layout;
}
