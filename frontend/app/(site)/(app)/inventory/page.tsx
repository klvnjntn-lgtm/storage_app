'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Space_Grotesk } from 'next/font/google';
import {
  LayoutDashboard,
  Tag,
  ClipboardList,
  Warehouse,
  Package,
  ArrowUpRight,
  ArrowLeft,
  Inbox,
  Lock,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

// Brighter, more saturated stops (400 -> 600) than the old 500 -> 700 —
// same hues, punchier and less muddy against the white cards.
const INVENTORY_ITEMS = [
  {
    title: 'Stock',
    description: 'View and manage current stock levels',
    href: '/inventory/stock',
    icon: LayoutDashboard,
    gradient: 'from-emerald-400 to-teal-600',
  },
  {
    title: 'Products',
    description: 'Manage your product catalog',
    href: '/inventory/products',
    icon: Package,
    gradient: 'from-rose-400 to-red-600',
  },
  {
    title: 'Sessions',
    description: 'Scan, receive, and move stock',
    href: '/inventory/sessions',
    icon: ClipboardList,
    gradient: 'from-sky-400 to-blue-600',
  },
  {
    title: 'Warehouse',
    description: 'Manage warehouse locations and layout',
    href: '/inventory/warehouse',
    icon: Warehouse,
    gradient: 'from-violet-400 to-purple-600',
  },
  {
    title: 'Labels',
    description: 'Print and manage product labels',
    href: '/inventory/labels',
    icon: Tag,
    gradient: 'from-amber-400 to-orange-600',
  },
];

export default function InventoryHome() {
  const router = useRouter();
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [modulesLoaded, setModulesLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/organizations/modules');
        if (!res.ok) return;
        const json = await res.json();
        setEnabledModules(Array.isArray(json) ? json : []);
      } catch (err) {
        console.error('Modules fetch failed:', err);
      } finally {
        setModulesLoaded(true);
      }
    })();
  }, []);

  const warehouseEnabled = enabledModules.includes('WAREHOUSE_OPS');

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
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-6 py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-3 transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to dashboard
          </button>

          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Inbox size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div>
              <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>Inventory</h1>
              <p className="text-xs text-gray-500">
                Stock, products, sessions, warehouse, and labels
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full px-6 pt-8 pb-16">
        {/* Wait for the modules fetch before deciding what to show, so we
            don't briefly flash the locked state before enabledModules
            resolves. */}
        {!modulesLoaded ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : !warehouseEnabled ? (
          <div className="flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-blue-500/25 bg-blue-600/5 py-16 px-6">
            <span className="rounded-lg bg-blue-600/10 border border-blue-600/20 p-3 mb-4">
              <Lock size={22} strokeWidth={2} className="text-blue-700/60" />
            </span>
            <p className={`${display.className} text-lg font-bold text-gray-600`}>
              Inventory isn't enabled
            </p>
            <p className="text-sm text-gray-400 mt-1 max-w-sm">
              Ask your admin to turn on the Warehouse Operations module to access
              stock, products, sessions, warehouse, and labels.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {INVENTORY_ITEMS.map(({ title, description, href, icon: Icon, gradient }) => (
              <button
                key={href}
                onClick={() => router.push(href)}
                className={`group relative text-left rounded-lg p-6 bg-gradient-to-br ${gradient} text-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between`}
              >
                <div className="flex items-start justify-between">
                  <span className="shrink-0 rounded-lg bg-white/15 p-2.5">
                    <Icon size={22} strokeWidth={2} />
                  </span>
                  <ArrowUpRight
                    size={18}
                    strokeWidth={2}
                    className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                  />
                </div>
                <div>
                  <p className={`${display.className} text-xl font-bold leading-tight`}>{title}</p>
                  <p className="text-sm text-white/85 mt-0.5">{description}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}