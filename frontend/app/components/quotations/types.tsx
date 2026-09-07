// components/quotations/types.ts

export type {
  BankAccount,
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
  itemDiscount: number;
  itemTaxAmount: number;
  lineTotal: number;
  itemTotal: number;
  unit: string | null;
  locationName: string;
};

export type QuotationTaxView = {
  name: string;
  percentage: number;
  amount: number;
};

export type QuotationView = {
  quotationNumber: string;
  quotationDate: string;
  validUntil: string | null;
  termsAndConditions: string | null;

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