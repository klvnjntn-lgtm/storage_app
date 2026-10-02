'use client';

import { usePathname } from 'next/navigation';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';

// Accounting is admin-only: the books, reports, expenses, fixed assets and
// payroll all expose the organization's full finances (the backend refuses
// non-admins too). Sales Insights is the exception — it reads invoice
// reports, not the ledger, and stays open to staff.
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith('/accounting/sales-insights')) return <>{children}</>;
  return <AdminOnly>{children}</AdminOnly>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { authorized } = useRequireAdmin();
  const { t } = useLanguage();
  if (!authorized) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </main>
    );
  }
  return <>{children}</>;
}
