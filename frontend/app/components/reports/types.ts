// Shared shape of GET /invoices/reports/top — mirrors InvoiceService.getTopReport() on the backend.

export type TopCustomerRow = {
  customerId: string;
  name: string;
  revenue: number;
  invoiceCount: number;
};

export type TopProductRow = {
  productId: string;
  name: string;
  sku: string | null;
  unitsSold: number;
  revenue: number;
};

export type TopVehicleRow = {
  vehicleId: string;
  plateNumber: string;
  vehicleModel: string;
  customerId: string | null;
  customerName: string | null;
  revenue: number;
  visitCount: number;
};

export type TopReport = {
  topCustomers: TopCustomerRow[];
  topProducts: TopProductRow[];
  topVehicles: TopVehicleRow[];
};

// Categorical palette slots 1-5 from the dataviz skill's validated default
// order (blue, orange, aqua, yellow, magenta) — adjacent pairs clear the
// CVD gate in this exact order, so slice this list from the front only,
// never reorder or pick from the middle. "Other" always uses the muted
// gray, never a 6th hue.
export const CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
export const CHART_OTHER_COLOR = '#898781';
