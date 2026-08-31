'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Settings, Database, Package, ChevronRight } from 'lucide-react';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';

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
      <main className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-400">Checking access...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-black">
      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Scanner Hub
          </button>
          <div className="flex items-center gap-2">
            <Settings size={22} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">Admin</h1>
              <p className="text-xs text-gray-500">Manage warehouse data and settings</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto">
        <div className="space-y-2">
          {ADMIN_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <div
                key={section.href}
                onClick={() => router.push(section.href)}
                className="cursor-pointer bg-white border-2 border-gray-300 rounded-md p-4 hover:bg-gray-50 transition"
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <Icon size={18} strokeWidth={2} className="text-gray-500" />
                    <div>
                      <p className="font-semibold">{section.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
                    </div>
                  </div>
                  <ChevronRight size={18} strokeWidth={2} className="text-gray-400" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}