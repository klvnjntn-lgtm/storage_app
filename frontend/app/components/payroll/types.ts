// components/payroll/types.ts

// Mirrors PayrollService.getPayslip's return shape (backend) — the print
// view for a single employee's payslip within a run.
export type PayslipPrintView = {
  id: string;

  businessName: string;
  businessLegalName: string | null;
  businessNpwp: string | null;
  businessLogoUrl: string | null;
  businessAddress: string | null;
  businessPhone: string | null;

  periodMonth: number;
  periodYear: number;
  payType: 'MONTHLY' | 'WEEKLY';
  documentDate: string;
  status: 'DRAFT' | 'POSTED' | 'PAID' | 'VOID';
  paidAt: string | null;
  paymentMethod: 'TRANSFER' | 'CASH' | 'OTHER' | null;

  employeeName: string;
  employeePosition: string | null;
  employeeNik: string | null;
  employeeBankName: string | null;
  employeeBankAccountNumber: string | null;

  baseSalary: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  components: { name: string; type: 'ALLOWANCE' | 'DEDUCTION'; amount: number }[];
};
