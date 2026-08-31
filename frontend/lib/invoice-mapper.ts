import { InvoiceFormat, InvoiceView } from '@/app/components/invoices/types';

// Matches InvoiceService.getOne()'s flat InvoicePrintView shape —
// also what InvoicePrintController#getPrintData returns to Puppeteer.
export type InvoicePrintView = {
  id: string;
  invoiceNumber: string | null;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  format: InvoiceFormat;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';

  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;

  locationName: string;
  locationAddress: string | null;
  locationPhone: string | null;

  customerName: string | null;
  customerAddress: string | null;
  billingAddress: string | null;
  customerPhone: string | null;
  customerNpwp: string | null;
  customerPoNumber: string | null; // NEW — was entirely absent from this type; backend has always returned it (Option 2 policy: optional/reference on Invoice)

  vehicleId: string | null;
  vehiclePlateNumber: string | null;
  vehicleModel: string | null;
  vehicleVin: string | null;
  vehicleOdometer: number | null;

  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  invoiceDate: string | null;
  dueDate: string | null;
  issuedAt: string | null;
  createdAt: string;
  paymentTerms: string | null; // NEW — backend always returned this; type just never declared it
  notes: string | null;        // NEW — same

  taxes: { name: string; percentage: number; amount: number }[];
  items: {
    id: string;
    productName: string;
    sku: string | null;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    itemDiscount: number;
    itemTaxAmount: number;
    itemTotal: number;
    lineTotal: number;
    locationName: string;
  }[];
};

// Maps the backend's InvoicePrintView shape to the frontend InvoiceView
// shape InvoicePrintArea/templates expect. Used by both the in-app detail
// page (on-screen preview) and the /print/invoices/[id] page (Puppeteer's
// PDF render target) — one mapper, so the two can't drift apart again.
export function toInvoiceView(invoice: InvoicePrintView): InvoiceView {
  return {
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt ?? invoice.createdAt,
    invoiceDate: invoice.invoiceDate,
    customerName: invoice.customerName,
    customerPhone: invoice.customerPhone,
    customerAddress: invoice.customerAddress,
    billingAddress: invoice.billingAddress ?? invoice.customerAddress ?? null,
    customerNpwp: invoice.customerNpwp,
    customerPoNumber: invoice.customerPoNumber ?? null, // FIX — was hardcoded null
    format: invoice.format,

    locationName: invoice.locationName,
    sessionId: null,

    vehicleId: invoice.vehicleId,
    vehiclePlateNumber: invoice.vehiclePlateNumber,
    vehicleModel: invoice.vehicleModel,
    vehicleVin: invoice.vehicleVin,
    vehicleOdometer: invoice.vehicleOdometer,

    items: invoice.items.map((item) => ({
      id: item.id,
      productName: item.productName ?? '',
      quantity: item.quantity,
      unit: item.unit ?? null,
      unitPrice: Number(item.unitPrice),
      itemDiscount: Number(item.itemDiscount ?? 0),
      itemTaxAmount: Number(item.itemTaxAmount ?? 0),
      itemTotal: Number(item.itemTotal ?? item.lineTotal),
      lineTotal: Number(item.lineTotal),
      locationName: item.locationName ?? '',
    })),
    subtotal: Number(invoice.subtotal),
    discount: Number(invoice.discount),
    taxAmount: Number(invoice.taxAmount ?? 0),
    taxes: (invoice.taxes ?? []).map((t) => ({
      name: t.name,
      percentage: Number(t.percentage),
      amount: Number(t.amount),
    })),
    total: Number(invoice.total),

    businessName: invoice.businessLegalName ?? invoice.businessName,
    businessLegalName: invoice.businessLegalName,
    businessNpwp: invoice.businessNpwp,
    businessLogoUrl: invoice.businessLogoUrl,
    businessAddress: invoice.businessAddress ?? invoice.locationAddress ?? null,
    businessPhone: invoice.businessPhone ?? invoice.locationPhone ?? null,
    bankName: invoice.bankName,
    bankAccountNumber: invoice.bankAccountNumber,
    bankAccountName: invoice.bankAccountName,

    paymentStatus: invoice.paymentStatus ?? null,
    amountPaid: invoice.amountPaid != null ? Number(invoice.amountPaid) : null,
    dueDate: invoice.dueDate ?? null,
    paymentTerms: invoice.paymentTerms ?? null, // FIX — was hardcoded null
    notes: invoice.notes ?? null,               // FIX — was hardcoded null
  };
}