// Shapes of a few API rows read in more than one form, before mapping.

export type TaxRateRow = {
  id: string;
  name: string;
  percentage: number;
  isDefault?: boolean;
  archivedAt?: string | null;
};

export type BankAccountRow = {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  isDefault?: boolean;
  archivedAt?: string | null;
};
