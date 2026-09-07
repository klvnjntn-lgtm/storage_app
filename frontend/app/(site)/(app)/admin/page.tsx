'use client';

import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, Settings, Database, Package, ChevronRight } from 'lucide-react';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

const ADMIN_SECTIONS = [
  {
    href: '/admin/database',
    title: 'Reference Data',
    description: 'Rename or merge locations, categories, and brands',
    icon: Database,
  },
  {
    href: '/admin/products',
    title: 'Products',
    description: 'Manage product catalog, SKUs, and details',
    icon: Package,
  },
];

export default function AdminPage() {
  const router = useRouter();
  const { authorized, loading } = useRequireAdmin();

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
        <p className="text-sm text-gray-400">Checking access...</p>
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
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Scanner Hub
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Settings size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Admin
              </h1>
              <p className="text-xs text-gray-500 truncate">Manage warehouse data and settings</p>
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