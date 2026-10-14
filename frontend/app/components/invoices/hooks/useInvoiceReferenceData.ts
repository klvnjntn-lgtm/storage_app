'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';
import type { BankAccount, Employee, LocationOption, TaxRate } from '@/app/components/invoices/types';

type RawTaxRate = TaxRate & { archivedAt: string | null };
type RawBankAccount = BankAccount & { archivedAt: string | null };

// The lists the invoice form picks from — locations, active tax rates,
// active bank accounts, employees — loaded once when the page opens.
export function useInvoiceReferenceData() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    (async () => {
      const [loc, tax, bank, emp] = await Promise.all([
        apiFetch('/locations').catch(() => null),
        apiFetch('/organization/tax-rates').catch(() => null),
        apiFetch('/organization/bank-accounts').catch(() => null),
        apiFetch('/payroll/employees').catch(() => null),
      ]);
      if (loc?.ok) setLocations(await loc.json());
      if (tax?.ok) {
        const rates: RawTaxRate[] = await tax.json();
        setTaxRates(
          rates
            .filter((r) => !r.archivedAt)
            .map((r) => ({ id: r.id, name: r.name, percentage: r.percentage, isDefault: r.isDefault })),
        );
      }
      if (bank?.ok) {
        const accounts: RawBankAccount[] = await bank.json();
        setBankAccounts(
          accounts
            .filter((a) => !a.archivedAt)
            .map((a) => ({
              id: a.id,
              bankName: a.bankName,
              accountNumber: a.accountNumber,
              accountName: a.accountName,
              isDefault: a.isDefault,
            })),
        );
      }
      if (emp?.ok) setEmployees(await emp.json());
    })();
  }, []);

  return { locations, taxRates, bankAccounts, employees };
}
