// app/components/suppliers/types.ts

export type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  npwp: string | null;
  notes: string | null;
  isActive: boolean;
};

export type SupplierFormValues = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  npwp: string;
  notes: string;
};

export const emptySupplierFormValues: SupplierFormValues = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  npwp: '',
  notes: '',
};