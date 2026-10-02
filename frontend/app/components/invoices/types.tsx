export type StockAtLocation = { locationId: string; locationName: string; quantity: number };

export type ProductSearchResult = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  image: string | null;
  sellingPrice: number | null;
  // Prices for the non-default price levels (default = sellingPrice).
  // Absent on lines restored from a saved document.
  prices?: { priceLevelId: string; price: number }[];
  unit: string | null;
  stockByLocation: StockAtLocation[];
};

export type DiscountType = 'PERCENTAGE' | 'FIXED';

export type CartLine = {
  product: ProductSearchResult;
  quantity: number;
  unitPrice: number;
  unit: string | null;
  locationId: string;
    fulfilledQuantity?: number; // floor for quantity edits on an issued invoice

  locationName: string;
  taxRateIds: string[];
  discountType: DiscountType | null;
  discountValue: number | null;
  // Price level picked for this line (null = default). The server
  // resolves the actual price from it — see lib/price-levels.ts.
  priceLevelId?: string | null;
  // Set once the salesperson picks a level by hand; a customer change
  // then leaves the line alone instead of re-levelling it.
  priceLevelOverridden?: boolean;
  // POS pricing: the price was typed by hand and comes from no level.
  priceCustom?: boolean;
};

export type LocationOption = { id: string; name: string };

export type Customer = {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  address: string | null;
  npwp?: string | null;
  // DELIVERY_DMS — default delivery pin + directions for drivers.
  // Prisma Decimal fields serialize as strings over JSON.
  latitude?: string | null;
  longitude?: string | null;
  deliveryNotes?: string | null;
  // Price level this customer buys at; null = the org's default.
  priceLevelId?: string | null;
};

export type Vehicle = {
  id: string;
  customerId: string;
  plateNumber: string;
  vehicleModel: string;
  vin: string | null;
  odometer: number | null;
};

export type ServiceLine = {
  key: string;
  description: string;
  unitPrice: number | null;
  taxRateIds: string[];
  unit: string | null;
  discountType: DiscountType | null;
  discountValue: number | null;
};

export type InvoiceFormat = 'THERMAL_58' | 'RECEIPT' | 'A5' | 'A4';

export type PaymentStatus = 'PAID' | 'UNPAID' | 'PARTIAL';

export type TaxRate = {
  id: string;
  name: string;
  percentage: number;
  isDefault?: boolean;
};

// A selectable OrganizationBankAccount, as returned by
// GET /organization/bank-accounts. isDefault marks the org's Settings-page
// default account; archivedAt is present on the raw API shape but the
// invoice/new and quotations/new pages filter archived accounts out
// before they ever reach this type.
export type BankAccount = {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  isDefault?: boolean;
};

// A selectable Employee, as returned by GET /payroll/employees.
export type Employee = {
  id: string;
  name: string;
  position: string | null;
};

export type AppliedTax = {
  name: string;
  percentage: number;
  amount: number;
};

export type InvoiceView = {
  invoiceNumber: string | null;
  invoiceDate: string | Date | null;
  issuedAt: string | Date;

  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  billingAddress: string | null;
  customerNpwp: string | null;
  customerPoNumber: string | null;

  locationName: string;
  format: InvoiceFormat;
  sessionId: string | null;

  items: {
    id: string;
    productName: string;
    quantity: number;
    unit: string | null;
    unitPrice: number;
    itemDiscount: number;
    itemTaxAmount: number;
    itemTotal: number;
    lineTotal: number;
    locationName: string;
  }[];

  subtotal: number;
  discount: number;
  taxAmount: number;
  taxes: {
    name: string;
    percentage: number;
    amount: number;
  }[];
  total: number;

  vehicleId: string | null;
  vehiclePlateNumber: string | null;
  vehicleModel: string | null;
  vehicleVin: string | null;
  vehicleOdometer: number | null;

  employeeId: string | null;
  employeeName: string | null;

  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;

  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;

  paymentStatus: PaymentStatus | null;
  amountPaid: number | null;
  dueDate: string | Date | null;
  paymentTerms: string | null;
  notes: string | null;
};

export type ReminderStatus = 'PENDING' | 'COMPLETED' | 'DELETED';

export type Reminder = {
  id: string;
  vehicleId: string;
  note: string;
  dueDate: string;
  status: ReminderStatus;
  completedAt: string | null;
  createdAt: string;
  vehicle: {
    id: string;
    plateNumber: string;
    vehicleModel: string;
    customer: { id: string; name: string };
  };
};

export type StatementLine = {
  id: string;
  invoiceNumber: string | null;
  issuedAt: string | null;
  invoiced: number;
  paidToDate: number;
  balance: number;
  vehicleId: string | null;
  vehiclePlateNumber: string | null;
  vehicleModel: string | null;
};

export type CustomerStatement = {
  customer: {
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    npwp: string | null;
  };
  organization: {
    name: string;
    legalName: string | null;
    npwp: string | null;
    logoUrl: string | null;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankAccountName: string | null;
    address: string | null;
    phone: string | null;
  };
  from: string;
  to: string;
  generatedAt?: string;
  vehicleIds?: string[];
  openingBalance: number;
  closingBalance: number;
  paymentTimingUnavailable: boolean;
  lines: StatementLine[];
};