import type { InvoiceView } from '@/app/components/invoices/types';
import type { QuotationView } from '@/app/components/quotations/types';
import type { SpkPrintView } from '@/app/components/workshop/SpkA4Template';
import { formatIDR } from '@/lib/format';
import { formatDMY, parseCalendarDate } from '@/lib/dates';
import { terbilang } from '@/lib/terbilang';
import type { ColumnKey, DocType } from './types';

// One document, flattened into what a design can print: field values as
// display strings ('' = nothing to show) and one row per line item.

export type PrintRow = Record<ColumnKey, string> & { serials: string };

export type PrintData = {
  fields: Record<string, string>;
  rows: PrintRow[];
  logoUrl: string | null;
};

type T = (key: string, vars?: Record<string, string | number>) => string;

const money = (n: number | null | undefined) => (n != null ? formatIDR(n) : '');
// Amounts that only print when there is one (discount, tax, paid).
const moneyIf = (n: number | null | undefined) => (n ? formatIDR(n) : '');
const calendar = (d: string | Date | null | undefined) => (d ? formatDMY(parseCalendarDate(d)) : '');
const instant = (d: string | Date | null | undefined) => (d ? formatDMY(new Date(d)) : '');
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('id-ID', { maximumFractionDigits: 3 }));
const odometer = (km: number | null | undefined) => (km != null ? `${km.toLocaleString('id-ID')} km` : '');
const words = (n: number) => (n > 0 ? terbilang(n) : '');

function business(v: {
  businessName: string | null;
  businessLegalName: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessNpwp: string | null;
}) {
  return {
    'business.name': v.businessName ?? '',
    'business.legalName': v.businessLegalName ?? '',
    'business.address': v.businessAddress ?? '',
    'business.phone': v.businessPhone ?? '',
    'business.npwp': v.businessNpwp ?? '',
  };
}

function row(no: number, r: Partial<Omit<PrintRow, 'qty' | 'unit'>> & { qty: number; unit: string | null }): PrintRow {
  return {
    no: String(no),
    name: r.name ?? '',
    sku: r.sku ?? '',
    type: r.type ?? '',
    qty: qtyText(r.qty),
    unit: r.unit ?? '',
    qtyUnit: r.unit ? `${qtyText(r.qty)} ${r.unit}` : qtyText(r.qty),
    price: r.price ?? '',
    discount: r.discount ?? '',
    total: r.total ?? '',
    serials: r.serials ?? '',
  };
}

export function invoicePrintData(invoice: InvoiceView, t: T): PrintData {
  const paid = invoice.amountPaid ?? 0;
  const status =
    invoice.paymentStatus === 'PAID'
      ? t('sales.invoiceTemplate.paymentBadgePaid')
      : invoice.paymentStatus === 'PARTIAL'
        ? t('sales.invoiceTemplate.paymentBadgePartial')
        : invoice.paymentStatus === 'UNPAID'
          ? t('sales.invoiceTemplate.paymentBadgeUnpaid')
          : '';
  return {
    logoUrl: invoice.businessLogoUrl,
    fields: {
      ...business(invoice),
      'branch.name': invoice.branchName ?? '',
      'doc.title': t('sales.invoiceTemplate.invoiceWord'),
      'doc.number': invoice.invoiceNumber ?? '',
      'doc.date': invoice.invoiceDate ? calendar(invoice.invoiceDate) : instant(invoice.issuedAt),
      'doc.dueDate': calendar(invoice.dueDate),
      'doc.paymentTerms': invoice.paymentTerms ?? '',
      'doc.poNumber': invoice.customerPoNumber ?? '',
      'doc.notes': invoice.notes ?? '',
      'doc.status': status,
      'doc.printedAt': formatDMY(new Date()),
      'customer.name': invoice.customerName ?? '',
      'customer.address': invoice.customerAddress ?? '',
      'customer.billingAddress': invoice.billingAddress ?? invoice.customerAddress ?? '',
      'customer.phone': invoice.customerPhone ?? '',
      'customer.npwp': invoice.customerNpwp ?? '',
      'vehicle.plate': invoice.vehiclePlateNumber ?? '',
      'vehicle.model': invoice.vehicleModel ?? '',
      'vehicle.vin': invoice.vehicleVin ?? '',
      'vehicle.odometer': odometer(invoice.vehicleOdometer),
      'totals.subtotal': money(invoice.subtotal),
      'totals.discount': moneyIf(invoice.discount),
      'totals.tax': moneyIf(invoice.taxAmount),
      'totals.total': money(invoice.total),
      'totals.paid': moneyIf(paid),
      'totals.balance': money(Math.max(invoice.total - paid, 0)),
      'totals.words': words(invoice.total),
      'totals.itemCount': String(invoice.items.length),
      'bank.name': invoice.bankName ?? '',
      'bank.accountNumber': invoice.bankAccountNumber ?? '',
      'bank.accountName': invoice.bankAccountName ?? '',
    },
    rows: invoice.items.map((item, i) =>
      row(i + 1, {
        name: item.productName,
        sku: item.sku ?? '',
        qty: item.quantity,
        unit: item.unit,
        price: money(item.unitPrice),
        discount: moneyIf(item.itemDiscount),
        total: money(item.itemTotal),
        serials: item.serialNumbers?.length ? `S/N: ${item.serialNumbers.join(', ')}` : '',
      }),
    ),
  };
}

export function quotationPrintData(quotation: QuotationView, t: T): PrintData {
  return {
    logoUrl: quotation.businessLogoUrl,
    fields: {
      ...business(quotation),
      'branch.name': '',
      'doc.title': t('sales.quotationTemplate.quotationLabel'),
      'doc.number': quotation.quotationNumber ?? '',
      'doc.date': calendar(quotation.quotationDate),
      'doc.validUntil': calendar(quotation.validUntil),
      'doc.terms': quotation.termsAndConditions ?? '',
      'doc.printedAt': formatDMY(new Date()),
      'customer.name': quotation.customerName ?? '',
      'customer.address': quotation.customerAddress ?? '',
      'customer.phone': quotation.customerPhone ?? '',
      'customer.npwp': quotation.customerNpwp ?? '',
      'vehicle.plate': quotation.vehiclePlateNumber ?? '',
      'vehicle.model': quotation.vehicleModel ?? '',
      'vehicle.odometer': odometer(quotation.vehicleOdometer),
      'vehicle.complaint': quotation.complaint ?? '',
      'totals.subtotal': money(quotation.subtotal),
      'totals.discount': moneyIf(quotation.discount),
      'totals.tax': moneyIf(quotation.taxAmount),
      'totals.total': money(quotation.total),
      'totals.words': words(quotation.total),
      'totals.itemCount': String(quotation.items.length),
      'bank.name': quotation.bankName ?? '',
      'bank.accountNumber': quotation.bankAccountNumber ?? '',
      'bank.accountName': quotation.bankAccountName ?? '',
    },
    rows: quotation.items.map((item, i) =>
      row(i + 1, {
        name: item.productName,
        sku: item.sku ?? '',
        qty: item.quantity,
        unit: item.unit,
        price: money(item.unitPrice),
        discount: moneyIf(item.itemDiscount),
        total: money(item.itemTotal),
      }),
    ),
  };
}

// An approved job prints as the SPK the mechanic works from: no prices. An
// estimate prints priced, for the customer to approve.
export function workOrderPrintData(view: SpkPrintView, t: T): PrintData {
  const { workOrder: wo, business: biz } = view;
  const s = (key: string) => t(`workshop.workOrders.spk.${key}`);
  const isEstimate = wo.status === 'ESTIMATE';
  const priced = isEstimate ? view.pricing : null;
  const total = priced ? priced.total : isEstimate ? Number(wo.estimatedTotal) : 0;
  return {
    logoUrl: biz.logoUrl,
    fields: {
      'business.name': biz.name,
      'business.legalName': biz.legalName ?? '',
      'business.address': biz.address ?? '',
      'business.phone': biz.phone ?? '',
      'business.npwp': biz.npwp ?? '',
      'branch.name': wo.branch?.name ?? '',
      'doc.title': isEstimate ? s('estimateTitle') : s('title'),
      'doc.number': wo.number,
      'doc.date': instant(wo.createdAt),
      'doc.validUntil': isEstimate ? calendar(wo.validUntil) : '',
      'doc.paymentTerms': wo.paymentTerms ?? '',
      'doc.poNumber': wo.customerPoNumber ?? '',
      'doc.notes': wo.notes ?? '',
      'doc.printedAt': formatDMY(new Date()),
      'customer.name': wo.customer.name,
      'customer.company': wo.customer.companyName ?? '',
      'customer.address': wo.customer.address ?? '',
      'customer.phone': wo.customer.phone ?? '',
      'customer.npwp': wo.customer.npwp ?? '',
      'vehicle.plate': wo.vehicle.plateNumber,
      'vehicle.model': wo.vehicle.vehicleModel,
      'vehicle.odometer': odometer(wo.odometer),
      'vehicle.complaint': wo.complaint ?? '',
      'mechanic.name': wo.mechanic?.name ?? '',
      'totals.subtotal': priced ? money(priced.subtotal) : '',
      'totals.discount': priced ? moneyIf(priced.discountAmount) : '',
      'totals.tax': priced ? moneyIf(priced.taxAmount) : '',
      'totals.total': total ? money(total) : '',
      'totals.words': words(total),
      'totals.itemCount': String(wo.items.length),
    },
    rows: wo.items.map((item, i) =>
      row(i + 1, {
        name: item.product?.name ?? item.description ?? '',
        sku: item.product?.sku ?? '',
        type: item.productId ? s('part') : s('labour'),
        qty: Number(item.quantity),
        unit: null,
        price: priced?.lines[i] ? money(priced.lines[i].unitPrice) : '',
        total: priced?.lines[i] ? money(priced.lines[i].lineTotal) : '',
      }),
    ),
  };
}

// Made-up data for the designer's preview, with the business's real name
// and logo when known. stress = many lines with long names, to see breaks.
export function samplePrintData(
  docType: DocType,
  biz: Partial<Record<'name' | 'legalName' | 'address' | 'phone' | 'npwp' | 'branch', string | null>> & { logoUrl?: string | null },
  opts: { lines: number; long?: boolean; locale: 'en' | 'id' },
): PrintData {
  const id = opts.locale === 'id';
  const names = id
    ? ['Oli Mesin 10W-40 1L', 'Filter Oli', 'Kampas Rem Depan', 'Jasa Servis Berkala', 'Busi Iridium', 'Air Radiator 1L']
    : ['Engine Oil 10W-40 1L', 'Oil Filter', 'Front Brake Pads', 'Periodic Service', 'Iridium Spark Plug', 'Radiator Coolant 1L'];
  const longSuffix = id
    ? ' — termasuk pemasangan, pengecekan ulang dan garansi bengkel 3 bulan'
    : ' — including fitting, re-check and a 3-month workshop warranty';
  const rows: PrintRow[] = Array.from({ length: opts.lines }, (_, i) => {
    const price = [85000, 45000, 320000, 150000, 95000, 40000][i % 6];
    const qty = (i % 3) + 1;
    return row(i + 1, {
      name: names[i % names.length] + (opts.long && i % 2 === 0 ? longSuffix : ''),
      sku: `SKU-${1001 + i}`,
      type: i % 6 === 3 ? (id ? 'Jasa' : 'Labour') : 'Part',
      qty,
      unit: 'pcs',
      price: formatIDR(price),
      discount: i % 4 === 1 ? formatIDR(5000) : '',
      total: formatIDR(price * qty - (i % 4 === 1 ? 5000 : 0)),
      serials: i === 2 ? 'S/N: BRK-88213, BRK-88214' : '',
    });
  });
  const subtotal = 1_250_000;
  const title = { INVOICE: id ? 'FAKTUR' : 'INVOICE', QUOTATION: id ? 'PENAWARAN HARGA' : 'QUOTATION', WORK_ORDER: id ? 'SURAT PERINTAH KERJA' : 'WORK ORDER' }[docType];
  return {
    logoUrl: biz.logoUrl ?? null,
    fields: {
      'business.name': biz.name || (id ? 'Bengkel Maju Jaya' : 'Maju Jaya Motors'),
      'business.legalName': biz.legalName || 'PT Maju Jaya Sejahtera',
      'business.address': biz.address || 'Jl. Raya Darmo No. 12, Surabaya',
      'business.phone': biz.phone || '0812-3456-7890',
      'business.npwp': biz.npwp || '01.234.567.8-901.000',
      'branch.name': biz.branch || (id ? 'Cabang Pusat' : 'Main branch'),
      'doc.title': title,
      'doc.number': { INVOICE: 'INV/2026/11/0042', QUOTATION: 'QUO/2026/11/0017', WORK_ORDER: 'WO-2026-0088' }[docType],
      'doc.date': formatDMY(new Date()),
      'doc.dueDate': formatDMY(new Date(Date.now() + 14 * 864e5)),
      'doc.validUntil': formatDMY(new Date(Date.now() + 7 * 864e5)),
      'doc.paymentTerms': 'Net 14',
      'doc.poNumber': 'PO-7781',
      'doc.notes': id ? 'Barang yang sudah dibeli tidak dapat dikembalikan.' : 'Goods sold are not returnable.',
      'doc.terms': id ? 'Harga berlaku 7 hari. Pembayaran 50% di muka.' : 'Prices valid for 7 days. 50% paid upfront.',
      'doc.status': id ? 'Belum Lunas' : 'Unpaid',
      'doc.printedAt': formatDMY(new Date()),
      'customer.name': 'Budi Santoso',
      'customer.company': 'CV Sumber Rejeki',
      'customer.address': 'Jl. Kenjeran No. 45, Surabaya',
      'customer.billingAddress': 'Jl. Kenjeran No. 45, Surabaya',
      'customer.phone': '0813-9876-5432',
      'customer.npwp': '02.345.678.9-012.000',
      'vehicle.plate': 'L 1234 AB',
      'vehicle.model': 'Toyota Avanza 1.3 G',
      'vehicle.vin': 'MHKM1BA3JKK012345',
      'vehicle.odometer': '45.200 km',
      'vehicle.complaint': id ? 'Rem bunyi saat mengerem, AC kurang dingin.' : 'Brakes squeal, AC not cold enough.',
      'mechanic.name': 'Agus',
      'totals.subtotal': formatIDR(subtotal),
      'totals.discount': formatIDR(50_000),
      'totals.tax': formatIDR(132_000),
      'totals.total': formatIDR(1_332_000),
      'totals.paid': formatIDR(500_000),
      'totals.balance': formatIDR(832_000),
      'totals.words': words(1_332_000),
      'totals.itemCount': String(opts.lines),
      'bank.name': 'BCA',
      'bank.accountNumber': '123-456-7890',
      'bank.accountName': 'PT Maju Jaya Sejahtera',
    },
    rows,
  };
}
