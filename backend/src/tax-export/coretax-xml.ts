// Coretax (DJP, 2025+) "Faktur Pajak Keluaran" bulk-import XML.
//
// Element names and order follow DJP's sample file for the
// Excel-to-XML converter (TaxInvoiceBulk, v1.4) — DJP publishes no XSD.
// Note DJP's own spelling "BuyerAdress".
//
// Only the common case is generated: PPN 11% effective, filed as
// transaction code 04 ("DPP Nilai Lain", PMK 131/2024) — tax base
// 11/12 × DPP at the 12% rate. Anything else is reported back to the
// user to enter by hand rather than guessed at.

export type CoretaxLine = {
  isService: boolean;
  name: string;
  unit: string | null;
  unitPrice: number;
  quantity: number;
  discount: number;
  taxBase: number; // DPP: quantity × unitPrice − discount
};

export type CoretaxInvoice = {
  date: string; // YYYY-MM-DD
  reference: string;
  buyerTin: string; // 16 digits
  buyerName: string;
  buyerAddress: string;
  buyerEmail: string;
  lines: CoretaxLine[];
};

// Unit names staff type on products → Coretax unit codes (UM.xxxx, DJP
// reference list). Unknown units fall back to "Lainnya"; labour lines
// use "Kegiatan".
const UNIT_CODES: Record<string, string> = {
  pcs: 'UM.0021', pc: 'UM.0021', piece: 'UM.0021', buah: 'UM.0021', bh: 'UM.0021', biji: 'UM.0021',
  unit: 'UM.0018', unt: 'UM.0018',
  set: 'UM.0019', 'set/kit': 'UM.0019', kit: 'UM.0019',
  lusin: 'UM.0017', dozen: 'UM.0017', lsn: 'UM.0017',
  lembar: 'UM.0020', lbr: 'UM.0020', sheet: 'UM.0020',
  box: 'UM.0022', boks: 'UM.0022', kotak: 'UM.0022', dus: 'UM.0037', karton: 'UM.0037', carton: 'UM.0037', ctn: 'UM.0037',
  liter: 'UM.0007', ltr: 'UM.0007', l: 'UM.0007', lt: 'UM.0007',
  kg: 'UM.0003', kilogram: 'UM.0003', gram: 'UM.0004', gr: 'UM.0004', g: 'UM.0004',
  meter: 'UM.0013', m: 'UM.0013', mtr: 'UM.0013', cm: 'UM.0015', inch: 'UM.0014', inci: 'UM.0014',
  drum: 'UM.0036', ton: 'UM.0001',
};
const UNIT_OTHER = 'UM.0033';
const UNIT_ACTIVITY = 'UM.0030';

export function coretaxUnit(unit: string | null, isService: boolean): string {
  if (isService) return UNIT_ACTIVITY;
  return UNIT_CODES[(unit ?? '').trim().toLowerCase()] ?? UNIT_OTHER;
}

// NPWP as Coretax wants it: 16 digits. A pre-2024 15-digit NPWP becomes
// 16 by a leading zero (DJP's own conversion). Null when unusable.
export function normalizeTin(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 16) return digits;
  if (digits.length === 15) return `0${digits}`;
  return null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function num(n: number): string {
  return String(round2(n));
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters other than tab/newline aren't legal in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function el(name: string, value: string | number | null | undefined, indent: string): string {
  const v = value == null || value === '' ? null : typeof value === 'number' ? num(value) : esc(value);
  return v == null ? `${indent}<${name}/>` : `${indent}<${name}>${v}</${name}>`;
}

// Code-04 amounts for one line: "other" tax base 11/12 × DPP, PPN 12% of it.
export function code04Amounts(taxBase: number) {
  const otherTaxBase = round2((taxBase * 11) / 12);
  return { otherTaxBase, vatRate: 12, vat: round2(otherTaxBase * 0.12) };
}

export function buildCoretaxXml(sellerTin: string, invoices: CoretaxInvoice[]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="utf-8" ?>',
    '<TaxInvoiceBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="TaxInvoice.xsd">',
    el('TIN', sellerTin, '\t'),
    '\t<ListOfTaxInvoice>',
  ];
  for (const inv of invoices) {
    const i3 = '\t\t\t';
    out.push(
      '\t\t<TaxInvoice>',
      el('TaxInvoiceDate', inv.date, i3),
      el('TaxInvoiceOpt', 'Normal', i3),
      el('TrxCode', '04', i3),
      el('AddInfo', null, i3),
      el('CustomDoc', null, i3),
      el('CustomDocMonthYear', null, i3),
      el('RefDesc', inv.reference, i3),
      el('FacilityStamp', null, i3),
      // NITKU: the NPWP plus 000000 for the head office.
      el('SellerIDTKU', `${sellerTin}000000`, i3),
      el('BuyerTin', inv.buyerTin, i3),
      el('BuyerDocument', 'TIN', i3),
      // ISO 3166 alpha-3 for Indonesia. DJP's sample has "IND", which is
      // India in that same standard.
      el('BuyerCountry', 'IDN', i3),
      el('BuyerDocumentNumber', null, i3),
      el('BuyerName', inv.buyerName, i3),
      el('BuyerAdress', inv.buyerAddress, i3),
      el('BuyerEmail', inv.buyerEmail, i3),
      el('BuyerIDTKU', `${inv.buyerTin}000000`, i3),
      `${i3}<ListOfGoodService>`,
    );
    const i5 = '\t\t\t\t\t';
    for (const line of inv.lines) {
      const { otherTaxBase, vatRate, vat } = code04Amounts(line.taxBase);
      out.push(
        '\t\t\t\t<GoodService>',
        el('Opt', line.isService ? 'B' : 'A', i5),
        el('Code', '000000', i5),
        el('Name', line.name, i5),
        el('Unit', coretaxUnit(line.unit, line.isService), i5),
        el('Price', String(round2(line.unitPrice)), i5),
        el('Qty', String(round2(line.quantity)), i5),
        el('TotalDiscount', String(round2(line.discount)), i5),
        el('TaxBase', String(round2(line.taxBase)), i5),
        el('OtherTaxBase', String(otherTaxBase), i5),
        el('VATRate', String(vatRate), i5),
        el('VAT', String(vat), i5),
        el('STLGRate', '0', i5),
        el('STLG', '0', i5),
        '\t\t\t\t</GoodService>',
      );
    }
    out.push(`${i3}</ListOfGoodService>`, '\t\t</TaxInvoice>');
  }
  out.push('\t</ListOfTaxInvoice>', '</TaxInvoiceBulk>', '');
  return out.join('\n');
}
