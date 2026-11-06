'use client';

import { HandCoins } from 'lucide-react';
import { CustomerPicker } from '@/app/components/invoices/CustomerPicker';
import type { Customer } from '@/app/components/invoices/types';
import { DepositsManager } from '@/app/components/shared/DepositsManager';

// Money taken from a customer before there's an invoice.
export default function CustomerDepositsPage() {
  return (
    <DepositsManager<Customer>
      apiBase="/customer-deposits"
      partyField="customer"
      i18nPrefix="sales.deposits"
      navKey="customerDeposits"
      icon={HandCoins}
      defaultMethod="CASH"
      renderPicker={(value, onChange) => <CustomerPicker value={value} onChange={onChange} />}
    />
  );
}
