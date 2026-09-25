'use client';

import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Settings, Database, Package, ChevronRight } from 'lucide-react';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';


export default function AdminPage() {
  const router = useRouter();
  const { authorized, loading } = useRequireAdmin();
  const { t } = useLanguage();

  const ADMIN_SECTIONS = [
    {
      href: '/admin/database',
      title: t('admin.overview.referenceDataTitle'),
      description: t('admin.overview.referenceDataDescription'),
      icon: Database,
    },
    {
      href: '/admin/products',
      title: t('admin.overview.productsTitle'),
      description: t('admin.overview.productsDescription'),
      icon: Package,
    },
  ];

  if (loading || !authorized) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{
          backgroundColor: '#f8fafc',
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        <p className="text-sm text-gray-400">{t('admin.overview.checkingAccess')}</p>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Settings size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('admin.overview.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('admin.overview.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <div className="space-y-2">
          {ADMIN_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <div
                key={section.href}
                onClick={() => router.push(section.href)}
                className="cursor-pointer bg-white border border-blue-500/15 rounded-xl p-4 shadow-sm hover:border-blue-500/35 hover:bg-blue-50/40 transition-colors"
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
                      <Icon size={16} strokeWidth={2} className="text-blue-700" />
                    </span>
                    <div>
                      <p className="font-semibold">{section.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
                    </div>
                  </div>
                  <ChevronRight size={18} strokeWidth={2} className="text-blue-600/50" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}