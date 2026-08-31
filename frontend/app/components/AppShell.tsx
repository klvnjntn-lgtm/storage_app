'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Space_Grotesk } from 'next/font/google';
import {
  Boxes,
  LayoutDashboard,
  Settings,
  Tag,
  Package,
  Upload as UploadIcon,
  PlugZap,
  Inbox,
  User,
  ShieldCheck,
  ShieldAlert,
  X,
  LogOut,
  TrendingUp,
  Users,
  Car,
  Bell,
  ShoppingCart,
  ClipboardList,
  Receipt,
  Truck,
  FileText,
  FileSpreadsheet,
  Building2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import NotificationDrawer from '@/app/components/NotificationDrawer';
import { useAuth } from '@/app/context/AuthContext';
const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type LicenseStatus = {
  valid: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
  expiresAt: string | null;
  message?: string;
};

type ModuleStatus = {
  module: string;
  purchased: boolean;
  enabled: boolean;
};

type NavItem = {
  href: string;
  label: string;
  icon: typeof Inbox;
  children?: NavItem[];
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { profile } = useAuth();

  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [pendingOrders, setPendingOrders] = useState<number | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [hasInvoicePos, setHasInvoicePos] = useState(false);
  const [hasWorkshopRms, setHasWorkshopRms] = useState(false);
  const [hasWarehouseOps, setHasWarehouseOps] = useState(false);

  // Which dropdown parent(s) are expanded, keyed by the parent's href.
  // Generalized from a single "salesOpen" boolean so a second dropdown
  // (Purchasing) doesn't need its own parallel state + NavLink branch.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [mobileOpenGroups, setMobileOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/license/status');
        setLicense(await res.json());
      } catch (err) {
        console.error('License status fetch failed:', err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/integrations/orders/pending');
        if (!res.ok) return;
        const json = await res.json();
        setPendingOrders(Array.isArray(json) ? json.length : 0);
      } catch (err) {
        console.error('Pending orders fetch failed:', err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/organizations/modules/status');
        if (!res.ok) return;
        const statuses: ModuleStatus[] = await res.json();
        setHasInvoicePos(
          statuses.some((s) => s.module === 'INVOICE_POS' && s.enabled),
        );
        setHasWorkshopRms(
          statuses.some((s) => s.module === 'WORKSHOP_RMS' && s.enabled),
        );
        setHasWarehouseOps(
          statuses.some((s) => s.module === 'WAREHOUSE_OPS' && s.enabled),
        );
      } catch (err) {
        console.error('Module status fetch failed:', err);
      }
    })();
  }, []);

  // Lock body scroll while the account modal is open (mobile especially)
  useEffect(() => {
    if (showProfile) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [showProfile]);

  // Auto-expand a dropdown (desktop) / sub-row (mobile) when the user is
  // already on one of its routes. Keyed by parent href so this scales to
  // any number of dropdown groups without new state per group.
  useEffect(() => {
    const next: Record<string, boolean> = {};
    if (pathname.startsWith('/sales')) next['/sales'] = true;
    if (pathname.startsWith('/purchasing')) next['/purchasing'] = true;
    setOpenGroups(next);
    setMobileOpenGroups(next);
  }, [pathname]);

  const salesChildren: NavItem[] = [
    { href: '/sales/orders', label: 'Sales Order', icon: ClipboardList },
    { href: '/sales/invoices', label: 'Invoice', icon: Receipt },
    { href: '/sales/delivery-order', label: 'Delivery Order', icon: Truck },
    { href: '/sales/quotations', label: 'Sales Quotation', icon: FileSpreadsheet },
  ];

  const salesItem: NavItem = {
    href: '/sales',
    label: 'Sales',
    icon: ShoppingCart,
    children: salesChildren,
  };

  // NEW — Purchasing dropdown, mirroring Sales. Gated the same way as
  // Sales (hasInvoicePos) since SupplierController and
  // PurchaseOrderController are both @RequireModule(INVOICE_POS).
  const purchasingChildren: NavItem[] = [
    { href: '/purchasing/purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
    { href: '/purchasing/suppliers', label: 'Suppliers', icon: Building2 },
  ];

  const purchasingItem: NavItem = {
    href: '/purchasing',
    label: 'Purchasing',
    icon: Package,
    children: purchasingChildren,
  };

  const navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Overview',
      items: [
        { href: '/inventory/stock', label: 'Stock', icon: LayoutDashboard },
      ],
    },
    {
      label: 'Operations',
      items: [
        ...(hasWarehouseOps
          ? [{ href: '/inventory/labels', label: 'Labels', icon: Tag }]
          : []),
        { href: '/upload', label: 'Upload', icon: UploadIcon },
        { href: '/upload-order', label: 'Upload Order', icon: PlugZap },
      ],
    },
    {
      label: 'Sales',
      items: hasInvoicePos
        ? [
            salesItem,
            { href: '/sales/reports', label: 'Reports', icon: TrendingUp },
            { href: '/customers', label: 'Customers', icon: Users },
          ]
        : [],
    },
    {
      label: 'Purchasing',
      items: hasInvoicePos ? [purchasingItem] : [],
    },
    {
      label: 'Workshop',
      items: hasWorkshopRms
        ? [
            { href: '/workshop/vehicles', label: 'Vehicles', icon: Car },
            { href: '/workshop/reminders', label: 'Reminders', icon: Bell },
          ]
        : [],
    },
    {
      label: 'System',
      items:
        profile?.role === 'ADMIN'
          ? [
              { href: '/admin', label: 'Admin', icon: Settings },
              { href: '/settings', label: 'Settings', icon: Settings },
            ]
          : [],
    },
  ];
  // Flattened list for the mobile pill row. Items with children render as a
  // toggle button (handled inside NavLink) instead of navigating directly.
  const flatNav = navGroups.flatMap((g) => g.items);

  const NavLink = ({
    item,
    variant = 'sidebar',
  }: {
    item: NavItem;
    variant?: 'sidebar' | 'mobile';
  }) => {
    const { href, label, icon: Icon, children } = item;
    const active = children
      ? pathname.startsWith(href)
      : pathname === href;

    if (variant === 'mobile') {
      if (children) {
        const isOpen = !!mobileOpenGroups[href];
        return (
          <button
            onClick={() => setMobileOpenGroups((prev) => ({ ...prev, [href]: !prev[href] }))}
            className={`relative shrink-0 snap-start flex items-center gap-1.5 text-sm px-3.5 py-2.5 rounded-md border font-medium transition-colors active:scale-[0.97] ${
              active
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 text-gray-700 hover:bg-gray-100 hover:border-gray-400'
            }`}
          >
            <Icon size={16} strokeWidth={2} />
            {label}
            {isOpen ? (
              <ChevronDown size={14} strokeWidth={2} />
            ) : (
              <ChevronRight size={14} strokeWidth={2} />
            )}
          </button>
        );
      }

      return (
        <button
          onClick={() => router.push(href)}
          className={`relative shrink-0 snap-start flex items-center gap-1.5 text-sm px-3.5 py-2.5 rounded-md border font-medium transition-colors active:scale-[0.97] ${
            active
              ? 'border-gray-900 bg-gray-900 text-white'
              : 'border-gray-300 text-gray-700 hover:bg-gray-100 hover:border-gray-400'
          }`}
        >
          <Icon size={16} strokeWidth={2} />
          {label}
          {href === '/upload-order' && !!pendingOrders && (
            <span
              className={`ml-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                active ? 'bg-white text-gray-900' : 'bg-violet-600 text-white'
              }`}
            >
              {pendingOrders}
            </span>
          )}
        </button>
      );
    }

    // Sidebar (desktop) — parent item with children renders as an
    // expand/collapse row followed by indented child links.
    if (children) {
      const isOpen = !!openGroups[href];
      return (
        <div>
          <button
            onClick={() => setOpenGroups((prev) => ({ ...prev, [href]: !prev[href] }))}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg font-medium text-[14.5px] transition-colors text-left ${
              active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Icon size={18} strokeWidth={2} className={active ? 'text-white' : 'text-gray-500'} />
            <span>{label}</span>
            {isOpen ? (
              <ChevronDown size={16} strokeWidth={2} className="ml-auto" />
            ) : (
              <ChevronRight size={16} strokeWidth={2} className="ml-auto" />
            )}
          </button>
          {isOpen && (
            <div className="mt-1 ml-4 pl-3 border-l-2 border-gray-100 space-y-1">
              {children.map((child) => (
                <NavLink key={child.href} item={child} variant="sidebar" />
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        onClick={() => router.push(href)}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg font-medium text-[14.5px] transition-colors text-left ${
          active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Icon size={18} strokeWidth={2} className={active ? 'text-white' : 'text-gray-500'} />
        <span>{label}</span>
        {href === '/upload-order' && !!pendingOrders && (
          <span className="ml-auto flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-violet-600 text-white text-[11px] font-bold">
            {pendingOrders}
          </span>
        )}
      </button>
    );
  };

  return (
    <main className="min-h-screen bg-white text-black flex flex-col md:flex-row">
      <NotificationDrawer enabled={hasWorkshopRms} />

      <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r-2 border-gray-200 h-screen sticky top-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b-2 border-gray-200">
          <div className="w-9 h-9 rounded-lg bg-gray-900 flex items-center justify-center shrink-0">
            <Boxes size={18} strokeWidth={2} className="text-white" />
          </div>
          <div>
            <h1 className={`${display.className} text-lg font-bold tracking-tight leading-none`}>
              Warehouse OS
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">Operations hub</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.label}>
              {group.items.length > 0 && (
                <>
                  <p className="text-[11px] font-semibold text-gray-400 px-3.5 mb-1.5">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <NavLink key={item.href} item={item} variant="sidebar" />
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </nav>

        <div className="px-3 py-4 border-t-2 border-gray-200">
          <button
            onClick={() => setShowProfile(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors text-left"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-xs font-semibold text-white shrink-0">
              {profile?.email ? profile.email.slice(0, 2).toUpperCase() : <User size={14} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">
                {profile?.email ?? 'Account'}
              </p>
              {license && (
                <p className={`text-xs flex items-center gap-1.5 ${license.valid ? 'text-emerald-600' : 'text-red-600'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${license.valid ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {license.valid ? 'License active' : license.status}
                </p>
              )}
            </div>
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* TOP BAR — mobile only, sticky so nav stays reachable while scrolling */}
        <div className="md:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b-2 border-gray-300 pt-[env(safe-area-inset-top)]">
          <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center shrink-0">
                <Boxes size={16} strokeWidth={2} className="text-white" />
              </div>
              <div className="min-w-0">
                <h1 className={`${display.className} text-base font-bold tracking-tight leading-none truncate`}>
                  Warehouse OS
                </h1>
                <p className="text-[11px] text-gray-500 mt-0.5">Operations hub</p>
              </div>
            </div>

            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-gray-300 hover:bg-gray-100 font-medium transition-colors shrink-0 active:scale-95"
              aria-label="Account"
            >
              <User size={16} strokeWidth={2} />
              <span className="hidden xs:inline">Account</span>
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto snap-x px-4 sm:px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {flatNav.map((item) => (
              <NavLink key={item.href} item={item} variant="mobile" />
            ))}
          </div>

          {flatNav
            .filter((item) => item.children && mobileOpenGroups[item.href])
            .map((item) => (
              <div
                key={item.href}
                className="flex gap-2 overflow-x-auto snap-x px-4 sm:px-5 pb-3 border-t border-gray-100 pt-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {item.children!.map((child) => (
                  <NavLink key={child.href} item={child} variant="mobile" />
                ))}
              </div>
            ))}
        </div>

        {/* Account Modal */}
        {showProfile && profile && (
          <div
            className="fixed inset-0 bg-black/25 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
            onClick={() => setShowProfile(false)}
          >
            <div
              className="bg-white rounded-t-xl sm:rounded-xl border border-gray-100 p-6 w-full sm:w-[320px] max-w-full sm:max-w-[320px] max-h-[85vh] overflow-y-auto shadow-xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <span className="text-[15px] font-medium">Account</span>
                <button
                  onClick={() => setShowProfile(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1 -m-1"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-sm font-medium text-white shrink-0 shadow-sm">
                  {profile.email.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{profile.email}</p>
                  <p className="text-xs text-gray-500 truncate">{profile.role} · {profile.organization.name}</p>
                </div>
              </div>

              {license && (
                <div
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 mb-5 text-xs font-medium ${
                    license.valid
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  {license.valid ? <ShieldCheck size={15} strokeWidth={2} className="shrink-0" /> : <ShieldAlert size={15} strokeWidth={2} className="shrink-0" />}
                  <span>{license.valid ? 'License active' : license.message || 'License invalid or expired'}</span>
                </div>
              )}

              <div className="border-t border-gray-100 pt-4 space-y-2.5 mb-5">
                {[
                  { label: 'Email', value: profile.email },
                  { label: 'Role', value: profile.role },
                  { label: 'Organization', value: profile.organization.name },
                  ...(license ? [{ label: 'License', value: license.status }] : []),
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center gap-3">
                    <span className="text-[13px] text-gray-400 shrink-0">{label}</span>
                    <span className="text-[13px] text-gray-700 text-right truncate">{value}</span>
                  </div>
                ))}
              </div>

              {profile.role === 'ADMIN' && (
                <button
                  onClick={() => {
                    setShowProfile(false);
                    router.push('/settings');
                  }}
                  className="w-full text-[13px] text-gray-500 hover:text-black mb-5 text-center underline py-1"
                >
                  Manage business & organization settings
                </button>
              )}

              <button
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-600 text-[13px] font-medium hover:bg-red-100 transition-colors active:scale-[0.98]"
                onClick={() => {
                  localStorage.removeItem('accessToken');
                  window.location.href = '/login';
                }}
              >
                <LogOut size={14} />
                Log out
              </button>
            </div>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 min-w-0 pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </main>
  );
}