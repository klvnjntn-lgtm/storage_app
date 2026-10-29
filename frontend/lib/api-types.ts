// Shapes of a few API rows read in more than one form, before mapping.

export type BankAccountRow = {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  isDefault?: boolean;
  archivedAt?: string | null;
};
