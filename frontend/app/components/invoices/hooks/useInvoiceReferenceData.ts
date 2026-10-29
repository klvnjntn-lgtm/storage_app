'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';
import type { BankAccount, Employee, LocationOption } from '@/app/components/invoices/types';

type RawBankAccount = BankAccount & { archivedAt: string | null };

// The lists the invoice form picks from — locations, active bank accounts, the mechanics (workshops' mechanic picker: only the names on the Mechanic
// account) — loaded once when the page opens.
export function useInvoiceReferenceData() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    (async () => {
      const [loc, bank, emp] = await Promise.all([
        apiFetch('/locations').catch(() => null),
        apiFetch('/organization/bank-accounts').catch(() => null),
        apiFetch('/mechanics').catch(() => null),
      ]);
      if (loc?.ok) setLocations(await loc.json());
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

  return { locations, bankAccounts, employees };
}
