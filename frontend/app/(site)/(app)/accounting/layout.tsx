'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Calculator } from 'lucide-react';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useModuleState } from '@/lib/hooks/useHasModule';
import { useLanguage } from '@/app/context/LanguageContext';

// Accounting is admin-only: the books, reports, expenses, fixed assets and
// payroll all expose the organization's finances (the backend refuses
// non-admins too). Sales Reports, which reads invoices rather than the
// ledger and stays open to staff, lives outside it at /reports/sales.
//
// A branch ADMIN only gets what's split by branch — their expenses, fixed
// assets and P&L; the books and business-wide reports are MASTER's.
//
// It's also its own module (ACCOUNTING, on top of INVOICE_POS); without it
// an admin who lands here is told so instead of seeing every call 403.
const BRANCH_ADMIN_PAGES = ['/accounting/expenses', '/accounting/fixed-assets', '/accounting/profit-loss'];

export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const branchAdminPage = BRANCH_ADMIN_PAGES.some((p) => pathname.startsWith(p));
  return (
    <AdminOnly masterOnly={!branchAdminPage}>
      <ModuleGate>{children}</ModuleGate>
    </AdminOnly>
  );
}

function ModuleGate({ children }: { children: React.ReactNode }) {
  const active = useModuleState('ACCOUNTING');
  const { t } = useLanguage();
  if (active === null) return <Loading label={t('common.loading')} />;
  if (active) return <>{children}</>;
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-sm text-center space-y-3">
        <span className="mx-auto flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600/10 border border-blue-600/20">
          <Calculator size={22} strokeWidth={2} className="text-blue-700" />
        </span>
        <h1 className="text-lg font-bold">{t('accounting.moduleOff.title')}</h1>
        <p className="text-sm text-gray-500">{t('accounting.moduleOff.body')}</p>
        <Link
          href="/settings/billing"
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700"
        >
          {t('accounting.moduleOff.cta')}
        </Link>
      </div>
    </main>
  );
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
