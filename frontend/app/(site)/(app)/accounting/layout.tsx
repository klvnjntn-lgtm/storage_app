'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';

// Accounting is admin-only: the books, reports, expenses, fixed assets and
// payroll all expose the organization's finances (the backend refuses
// non-admins too). Sales Insights is the exception — it reads invoice
// reports, not the ledger, and stays open to staff.
//
// A branch ADMIN only gets what's split by branch — their expenses, fixed
// assets and P&L; the books and business-wide reports are MASTER's.
const BRANCH_ADMIN_PAGES = ['/accounting/expenses', '/accounting/fixed-assets', '/accounting/profit-loss'];

export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith('/accounting/sales-insights')) return <>{children}</>;
  const branchAdminPage = BRANCH_ADMIN_PAGES.some((p) => pathname.startsWith(p));
  return <AdminOnly masterOnly={!branchAdminPage}>{children}</AdminOnly>;
}

const MASTER_ROLES = ['MASTER'] as const;

function AdminOnly({ children, masterOnly }: { children: React.ReactNode; masterOnly: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const admin = useRequireAdmin();
  const { t } = useLanguage();
  // The accounting home's cards are business-wide; a branch ADMIN lands on
  // their branch's P&L instead of /no-access.
  const toProfitLoss = masterOnly && pathname === '/accounting' && admin.user?.role === 'ADMIN';
  useEffect(() => {
    if (toProfitLoss) router.replace('/accounting/profit-loss');
  }, [toProfitLoss, router]);
  if (!admin.authorized || toProfitLoss) return <Loading label={t('common.loading')} />;
  return masterOnly ? <MasterOnly>{children}</MasterOnly> : <>{children}</>;
}

function MasterOnly({ children }: { children: React.ReactNode }) {
  const { authorized } = useRequireAdmin(MASTER_ROLES);
  const { t } = useLanguage();
  if (!authorized) return <Loading label={t('common.loading')} />;
  return <>{children}</>;
}

function Loading({ label }: { label: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-gray-500">{label}</p>
    </main>
  );
}
