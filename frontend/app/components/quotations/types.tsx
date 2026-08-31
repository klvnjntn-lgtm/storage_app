// components/quotations/types.ts

export type {
  CartLine,
  Customer,
  DiscountType,
  LocationOption,
  ProductSearchResult,
  ServiceLine,
  TaxRate,
} from '@/app/components/invoices/types';

export type QuotationItemView = {
  productName: string;
  quantity: number;
  unitPrice: number;
  itemDiscount: number;   // NEW
  itemTaxAmount: number;  // NEW
  lineTotal: number;
    itemTotal: number;        // here
  unit: string | null;      // here

  locationName: string;
};

export type QuotationTaxView = {
  name: string;
  percentage: number;
  amount: number;
};

// Mirrors InvoiceView's shape closely (same print/business/customer fields)
// but drops what only makes sense for a money-changing-hands document:
// no paymentStatus/amountPaid/balanceDue, no dueDate (validUntil plays
// that role instead), no vehicle fields (quotations aren't WORKSHOP_RMS).
export type QuotationView = {
  quotationNumber: string;
  quotationDate: string; // RENAMED from issuedAt — issuedAt never existed
                          // on the backend (that's an Invoice-only field);
                          // quotationDate is the real "Quote Date" column.
  validUntil: string | null;
  termsAndConditions: string | null; // NEW — spec requires this ✅ for Quotation only

  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerNpwp: string | null;
  locationName: string;

  items: QuotationItemView[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  taxes: QuotationTaxView[];
  total: number;

  businessName: string | null;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;

  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
};