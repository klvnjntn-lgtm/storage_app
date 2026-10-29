// components/quotations/types.ts

export type {
  BankAccount,
  CartLine,
  Customer,
  DiscountType,
  LocationOption,
  ProductSearchResult,
  ServiceLine,
} from '@/app/components/invoices/types';

export type QuotationItemView = {
  productName: string;
  quantity: number;
  unitPrice: number;
  itemDiscount: number;
  lineTotal: number;
  itemTotal: number;
  unit: string | null;
  locationName: string;
};

export type QuotationView = {
  quotationNumber: string;
  quotationDate: string;
  validUntil: string | null;
  termsAndConditions: string | null;

  // Workshops: the car quoted for, its odometer and the complaint.
  vehiclePlateNumber?: string | null;
  vehicleModel?: string | null;
  vehicleOdometer?: number | null;
  complaint?: string | null;

  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerNpwp: string | null;
  locationName: string;

  items: QuotationItemView[];
  subtotal: number;
  discount: number;
  // Only documents issued while tax rates existed carry any.
  taxAmount: number;
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