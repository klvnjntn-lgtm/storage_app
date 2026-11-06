'use client';

import { HandCoins } from 'lucide-react';
import { SupplierPicker } from '@/app/components/purchase-orders/SupplierPicker';
import { DepositsManager } from '@/app/components/shared/DepositsManager';
import type { Supplier } from '@/app/components/suppliers/types';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';

// Money paid to a supplier before goods arrive. Admin-only, like supplier payments.
export default function SupplierDepositsPage() {
  const { authorized } = useRequireAdmin();
  if (!authorized) return null;
  return (
    <DepositsManager<Supplier>
      apiBase="/supplier-deposits"
      partyField="supplier"
      i18nPrefix="purchasing.deposits"
      navKey="supplierDeposits"
      icon={HandCoins}
      defaultMethod="TRANSFER"
      adminOnly
      renderPicker={(value, onChange) => <SupplierPicker supplier={value} onChange={onChange} />}
    />
  );
}
