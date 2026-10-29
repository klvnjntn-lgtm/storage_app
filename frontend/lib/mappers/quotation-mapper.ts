import { QuotationView } from '@/app/components/quotations/types';

// Matches SalesQuotationService's actual QuotationPrintView + mapQuotationForPrint()
// after the quotationDate / termsAndConditions / bank-details fixes.
export type QuotationPrintView = {
  id: string;
  quotationNumber: string | null;
  vehiclePlateNumber?: string | null;
  vehicleModel?: string | null;
  vehicleOdometer?: number | null;
  complaint?: string | null;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'CONVERTED';
  format: string;
  quotationDate: string | null;        // NEW — replaces the nonexistent issuedAt
  termsAndConditions: string | null;   // NEW
  discount: number;

  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  bankName: string | null;            // NEW — now actually populated
  bankAccountNumber: string | null;   // NEW
  bankAccountName: string | null;     // NEW

  locationName: string;
  locationAddress: string | null;
  locationPhone: string | null;

  customerName: string | null;
  customerAddress: string | null;
  customerPhone: string | null;
  customerNpwp: string | null;

  subtotal: number;
  taxAmount: number;
  total: number;

  validUntil: string | null;
  sentAt: string | null;
  createdAt: string;

  items: {
    id: string;
    productName: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    
    itemDiscount: number;   // NEW
    itemTotal: number;
    unit: string | null;
  }[];
};

// Maps the backend's QuotationPrintView to the frontend QuotationView that
// QuotationA4Template expects. Shared by both the in-app preview and the
// /print/quotations/[id] Puppeteer target, so the two can't drift apart,
// and Decimal-as-string values from Prisma get coerced to real numbers
// exactly once, here.
export function toQuotationView(quotation: QuotationPrintView): QuotationView {
  return {
    quotationNumber: quotation.quotationNumber ?? '',
    quotationDate: quotation.quotationDate ?? quotation.createdAt, // FIX — was quotation.issuedAt
    validUntil: quotation.validUntil ?? null,
    termsAndConditions: quotation.termsAndConditions ?? null, // NEW

    vehiclePlateNumber: quotation.vehiclePlateNumber ?? null,
    vehicleModel: quotation.vehicleModel ?? null,
    vehicleOdometer: quotation.vehicleOdometer ?? null,
    complaint: quotation.complaint ?? null,

    customerName: quotation.customerName,
    customerPhone: quotation.customerPhone,
    customerAddress: quotation.customerAddress,
    customerNpwp: quotation.customerNpwp,

    locationName: quotation.locationName,

    items: quotation.items.map((item) => ({
      productName: item.productName ?? '',
      quantity: item.quantity,
      unit: item.unit ?? null,          
      unitPrice: Number(item.unitPrice),
      itemDiscount: Number(item.itemDiscount ?? 0),   // NEW
  itemTotal: Number(item.itemTotal ?? item.lineTotal),
  lineTotal: Number(item.lineTotal),   // keep this — QuotationItemView still requires it
      locationName: quotation.locationName ?? '', // NOTE: per-item location isn't
                                                    // on the backend item shape;
                                                    // kept as document-level fallback,
                                                    // same as before
    })),
    subtotal: Number(quotation.subtotal),
    discount: Number(quotation.discount ?? 0),
    taxAmount: Number(quotation.taxAmount ?? 0),
    total: Number(quotation.total),

    businessName: quotation.businessLegalName ?? quotation.businessName,
    businessLegalName: quotation.businessLegalName,
    businessNpwp: quotation.businessNpwp,
    businessLogoUrl: quotation.businessLogoUrl,
    businessAddress: quotation.businessAddress ?? quotation.locationAddress ?? null,
    businessPhone: quotation.businessPhone ?? quotation.locationPhone ?? null,

    bankName: quotation.bankName,
    bankAccountNumber: quotation.bankAccountNumber,
    bankAccountName: quotation.bankAccountName,
  };
}