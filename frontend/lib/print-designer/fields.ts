import type { ColumnKey, DocType } from './types';

// Everything a design can print. Placed on the page as {key} inside a text
// box; the labels are only for the designer's field list.

export type FieldGroup = 'business' | 'document' | 'customer' | 'vehicle' | 'totals' | 'bank' | 'page';

export type FieldDef = {
  key: string;
  group: FieldGroup;
  en: string;
  id: string;
  // Which documents have it; omitted = all.
  docs?: DocType[];
};

const INV: DocType[] = ['INVOICE'];
const QUO: DocType[] = ['QUOTATION'];
const WO: DocType[] = ['WORK_ORDER'];
const INV_QUO: DocType[] = ['INVOICE', 'QUOTATION'];

export const FIELDS: FieldDef[] = [
  { key: 'business.name', group: 'business', en: 'Business name', id: 'Nama usaha' },
  { key: 'business.legalName', group: 'business', en: 'Legal name', id: 'Nama badan usaha' },
  { key: 'business.address', group: 'business', en: 'Address', id: 'Alamat' },
  { key: 'business.phone', group: 'business', en: 'Phone', id: 'Telepon' },
  { key: 'business.npwp', group: 'business', en: 'NPWP', id: 'NPWP' },
  { key: 'branch.name', group: 'business', en: 'Branch', id: 'Cabang' },

  { key: 'doc.title', group: 'document', en: 'Document title', id: 'Judul dokumen' },
  { key: 'doc.number', group: 'document', en: 'Number', id: 'Nomor' },
  { key: 'doc.date', group: 'document', en: 'Date', id: 'Tanggal' },
  { key: 'doc.dueDate', group: 'document', en: 'Due date', id: 'Jatuh tempo', docs: INV },
  { key: 'doc.validUntil', group: 'document', en: 'Valid until', id: 'Berlaku sampai', docs: ['QUOTATION', 'WORK_ORDER'] },
  { key: 'doc.paymentTerms', group: 'document', en: 'Payment terms', id: 'Syarat pembayaran', docs: ['INVOICE', 'WORK_ORDER'] },
  { key: 'doc.poNumber', group: 'document', en: 'Customer PO no.', id: 'No. PO pelanggan', docs: ['INVOICE', 'WORK_ORDER'] },
  { key: 'doc.notes', group: 'document', en: 'Notes', id: 'Catatan', docs: ['INVOICE', 'WORK_ORDER'] },
  { key: 'doc.terms', group: 'document', en: 'Terms & conditions', id: 'Syarat & ketentuan', docs: QUO },
  { key: 'doc.status', group: 'document', en: 'Payment status', id: 'Status bayar', docs: INV },
  { key: 'doc.printedAt', group: 'document', en: 'Print date', id: 'Tanggal cetak' },

  { key: 'customer.name', group: 'customer', en: 'Customer name', id: 'Nama pelanggan' },
  { key: 'customer.company', group: 'customer', en: 'Company', id: 'Perusahaan', docs: WO },
  { key: 'customer.address', group: 'customer', en: 'Address', id: 'Alamat' },
  { key: 'customer.billingAddress', group: 'customer', en: 'Billing address', id: 'Alamat penagihan', docs: INV },
  { key: 'customer.phone', group: 'customer', en: 'Phone', id: 'Telepon' },
  { key: 'customer.npwp', group: 'customer', en: 'NPWP', id: 'NPWP' },

  { key: 'vehicle.plate', group: 'vehicle', en: 'Plate number', id: 'No. polisi' },
  { key: 'vehicle.model', group: 'vehicle', en: 'Vehicle model', id: 'Tipe kendaraan' },
  { key: 'vehicle.vin', group: 'vehicle', en: 'VIN', id: 'No. rangka', docs: INV },
  { key: 'vehicle.odometer', group: 'vehicle', en: 'Odometer', id: 'Odometer' },
  { key: 'vehicle.complaint', group: 'vehicle', en: 'Complaint', id: 'Keluhan', docs: ['QUOTATION', 'WORK_ORDER'] },
  { key: 'mechanic.name', group: 'vehicle', en: 'Mechanic', id: 'Mekanik', docs: WO },

  { key: 'totals.subtotal', group: 'totals', en: 'Subtotal', id: 'Subtotal' },
  { key: 'totals.discount', group: 'totals', en: 'Discount', id: 'Diskon' },
  { key: 'totals.tax', group: 'totals', en: 'Tax', id: 'Pajak' },
  { key: 'totals.total', group: 'totals', en: 'Total', id: 'Total' },
  { key: 'totals.paid', group: 'totals', en: 'Paid', id: 'Dibayar', docs: INV },
  { key: 'totals.balance', group: 'totals', en: 'Balance due', id: 'Sisa tagihan', docs: INV },
  { key: 'totals.words', group: 'totals', en: 'Total in words', id: 'Terbilang' },
  { key: 'totals.itemCount', group: 'totals', en: 'Number of lines', id: 'Jumlah baris' },

  { key: 'bank.name', group: 'bank', en: 'Bank', id: 'Bank', docs: INV_QUO },
  { key: 'bank.accountNumber', group: 'bank', en: 'Account number', id: 'No. rekening', docs: INV_QUO },
  { key: 'bank.accountName', group: 'bank', en: 'Account holder', id: 'Atas nama', docs: INV_QUO },

  { key: 'page.number', group: 'page', en: 'Page number', id: 'Nomor halaman' },
  { key: 'page.count', group: 'page', en: 'Page count', id: 'Jumlah halaman' },
];

export const FIELD_GROUPS: { key: FieldGroup; en: string; id: string }[] = [
  { key: 'business', en: 'Business', id: 'Usaha' },
  { key: 'document', en: 'Document', id: 'Dokumen' },
  { key: 'customer', en: 'Customer', id: 'Pelanggan' },
  { key: 'vehicle', en: 'Vehicle', id: 'Kendaraan' },
  { key: 'totals', en: 'Totals', id: 'Total' },
  { key: 'bank', en: 'Bank', id: 'Bank' },
  { key: 'page', en: 'Page', id: 'Halaman' },
];

export function fieldsFor(docType: DocType) {
  return FIELDS.filter((f) => !f.docs || f.docs.includes(docType));
}

export type ColumnDef = { key: ColumnKey; en: string; id: string; docs?: DocType[] };

export const COLUMNS: ColumnDef[] = [
  { key: 'no', en: 'Line no.', id: 'No.' },
  { key: 'name', en: 'Item (with serial numbers)', id: 'Barang (dengan nomor seri)' },
  { key: 'sku', en: 'SKU', id: 'Kode barang' },
  { key: 'type', en: 'Part / labour', id: 'Part / jasa', docs: ['WORK_ORDER'] },
  { key: 'qty', en: 'Quantity', id: 'Jumlah' },
  { key: 'unit', en: 'Unit', id: 'Satuan' },
  { key: 'qtyUnit', en: 'Quantity + unit', id: 'Jumlah + satuan' },
  { key: 'price', en: 'Unit price', id: 'Harga satuan' },
  { key: 'discount', en: 'Line discount', id: 'Diskon baris' },
  { key: 'total', en: 'Line total', id: 'Jumlah harga' },
];

export function columnsFor(docType: DocType) {
  return COLUMNS.filter((c) => !c.docs || c.docs.includes(docType));
}

// Placeholders in a text box, e.g. "NPWP: {business.npwp}" → ['business.npwp'].
const TOKEN = /\{([a-zA-Z]+\.[a-zA-Z]+)\}/g;

export function tokensIn(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[1]);
}

export function fillTokens(text: string, values: Record<string, string>) {
  return text.replace(TOKEN, (_, key: string) => values[key] ?? '');
}
