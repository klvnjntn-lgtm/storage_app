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
  Search,
  ShoppingCart,
  ClipboardList,
  Receipt,
  Truck,
  FileText,
  FileSpreadsheet,
  Building2,
  ChevronDown,
  ChevronRight,
  Warehouse,
  Calculator,
  BookText,
  Landmark,
  CalendarClock,
  Rows3,
  Scale,
  Banknote,
  Wallet,
  BookOpen,
  Camera,
  Lock,
  Images,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import NotificationDrawer from '@/app/components/shared/NotificationDrawer';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';
import MediaLibraryModal, { MediaAsset } from '@/app/components/shared/MediaLibraryModal';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';
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
  const { profile, refreshProfile } = useAuth();
  const { t } = useLanguage();

  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [pendingOrders, setPendingOrders] = useState<number | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [hasInvoicePos, setHasInvoicePos] = useState(false);
  const [hasWorkshopRms, setHasWorkshopRms] = useState(false);
  const [hasWarehouseOps, setHasWarehouseOps] = useState(false);
  const [showAvatarLibrary, setShowAvatarLibrary] = useState(false);
  const [avatarUpdating, setAvatarUpdating] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  function resetChangePasswordForm() {
    setShowChangePassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setChangePasswordError('');
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setChangePasswordError('');
    if (newPassword !== confirmPassword) {
      setChangePasswordError(t('appShell.passwordsDoNotMatch'));
      return;
    }
    setChangingPassword(true);
    try {
      // Not apiFetch: a wrong current password legitimately returns 401
      // from the backend, and apiFetch treats every 401 as "session
      // expired" — it would wipe the token and bounce to /login before
      // this form ever got to show the error.
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChangePasswordError(
          typeof data.message === 'string' ? data.message : t('appShell.changePasswordFailed'),
        );
        return;
      }
      // Backend invalidates the session on a successful change, so finish
      // the same way the log out button does.
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      window.location.href = '/login';
    } catch {
      setChangePasswordError(t('appShell.changePasswordFailed'));
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleAvatarSelected(asset: MediaAsset) {
    setAvatarError('');
    setAvatarUpdating(true);
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ avatarUrl: asset.url }),
      });
      if (!res.ok) throw new Error();
      setAvatarLoadFailed(false);
      await refreshProfile();
    } catch {
      setAvatarError(t('appShell.avatarUpdateFailed'));
    } finally {
      setAvatarUpdating(false);
    }
  }

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

  // Drop any in-progress change-password form state once the account
  // modal closes, so reopening it doesn't show a stale error or filled
  // fields from a previous visit.
  useEffect(() => {
    if (!showProfile) resetChangePasswordForm();
  }, [showProfile]);

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
    if (pathname.startsWith('/accounting')) next['/accounting'] = true;
    setOpenGroups(next);
    setMobileOpenGroups(next);
  }, [pathname]);

  const salesChildren: NavItem[] = [
    { href: '/sales/orders', label: t('nav.items.salesOrder'), icon: ClipboardList },
    { href: '/sales/invoices', label: t('nav.items.invoice'), icon: Receipt },
    { href: '/sales/delivery-orders', label: t('nav.items.deliveryOrder'), icon: Truck },
    { href: '/sales/quotations', label: t('nav.items.salesQuotation'), icon: FileSpreadsheet },
  ];

  const salesItem: NavItem = {
    href: '/sales',
    label: t('nav.items.sales'),
    icon: ShoppingCart,
    children: salesChildren,
  };

  // NEW — Purchasing dropdown, mirroring Sales. Gated the same way as
  // Sales (hasInvoicePos) since SupplierController and
  // PurchaseOrderController are both @RequireModule(INVOICE_POS).
  const purchasingChildren: NavItem[] = [
    { href: '/purchasing/purchase-orders', label: t('nav.items.purchaseOrders'), icon: ClipboardList },
    { href: '/purchasing/suppliers', label: t('nav.items.suppliers'), icon: Building2 },
  ];

  const purchasingItem: NavItem = {
    href: '/purchasing',
    label: t('nav.items.purchasing'),
    icon: Package,
    children: purchasingChildren,
  };

  const accountingChildren: NavItem[] = [
    { href: '/accounting/journal', label: t('nav.items.journal'), icon: BookText },
    { href: '/accounting/expenses', label: t('nav.items.expenses'), icon: Receipt },
    { href: '/accounting/payroll', label: t('nav.items.payroll'), icon: Users },
    { href: '/accounting/fixed-assets', label: t('nav.items.fixedAssets'), icon: Building2 },
    { href: '/accounting/setup', label: t('nav.items.chartOfAccounts'), icon: Landmark },
    { href: '/accounting/fiscal-periods', label: t('nav.items.fiscalPeriods'), icon: CalendarClock },
    { href: '/accounting/profit-loss', label: t('nav.items.profitLoss'), icon: TrendingUp },
    { href: '/accounting/balance-sheet', label: t('nav.items.balanceSheet'), icon: Scale },
    { href: '/accounting/trial-balance', label: t('nav.items.trialBalance'), icon: Rows3 },
    { href: '/accounting/cash-flow', label: t('nav.items.cashFlow'), icon: Banknote },
    { href: '/accounting/ar-aging', label: t('nav.items.arAging'), icon: Wallet },
    { href: '/accounting/ap-aging', label: t('nav.items.apAging'), icon: ShoppingCart },
    { href: '/accounting/ledger', label: t('nav.items.accountLedger'), icon: BookOpen },
  ];

  const accountingItem: NavItem = {
    href: '/accounting',
    label: t('nav.items.accounting'),
    icon: Calculator,
    children: accountingChildren,
  };

  const navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: t('nav.groups.overview'),
      items: [
        { href: '/inventory/stock', label: t('nav.items.stock'), icon: LayoutDashboard },
      ],
    },
{
  label: t('nav.groups.operations'),
  items: [
    ...(hasWarehouseOps
      ? [
          { href: '/inventory/warehouse', label: t('nav.items.warehouse'), icon: Warehouse },
          { href: '/inventory/sessions', label: t('nav.items.sessions'), icon: ClipboardList },
          { href: '/inventory/labels', label: t('nav.items.labels'), icon: Tag },
        ]
      : []),
    { href: '/upload', label: t('nav.items.upload'), icon: UploadIcon },
    { href: '/upload-order', label: t('nav.items.uploadOrder'), icon: PlugZap },
  ],
},
    {
      label: t('nav.groups.sales'),
      items: hasInvoicePos
        ? [
            salesItem,
            { href: '/sales/reports', label: t('nav.items.salesMargin'), icon: TrendingUp },
            { href: '/customers', label: t('nav.items.customers'), icon: Users },
          ]
        : [],
    },
    {
      label: t('nav.groups.purchasing'),
      items: hasInvoicePos ? [purchasingItem] : [],
    },
    {
      label: t('nav.groups.accounting'),
      items: hasInvoicePos ? [accountingItem] : [],
    },
    {
      label: t('nav.groups.workshop'),
      items: hasWorkshopRms
        ? [
            { href: '/workshop/vehicles', label: t('nav.items.vehicles'), icon: Car },
            { href: '/workshop/vehicles/search', label: t('nav.items.vehicleLookup'), icon: Search },
            { href: '/workshop/reminders', label: t('nav.items.reminders'), icon: Bell },
          ]
        : [],
    },
    {
      label: t('nav.groups.system'),
      items:
        profile?.role === 'ADMIN'
          ? [
              { href: '/admin', label: t('nav.items.admin'), icon: Settings },
              { href: '/settings', label: t('nav.items.settings'), icon: Settings },
              { href: '/media-library', label: t('nav.items.mediaLibrary'), icon: Images },
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
                ? 'border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-600/20'
                : 'border-blue-500/15 text-gray-700 hover:bg-blue-50 hover:border-blue-500/30'
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
              ? 'border-blue-600 bg-blue-600 text-white shadow-sm shadow-blue-600/20'
              : 'border-blue-500/15 text-gray-700 hover:bg-blue-50 hover:border-blue-500/30'
          }`}
        >
          <Icon size={16} strokeWidth={2} />
          {label}
          {href === '/upload-order' && !!pendingOrders && (
            <span
              className={`ml-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                active ? 'bg-white text-blue-700' : 'bg-blue-600 text-white'
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
              active
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-600/20 ring-1 ring-blue-500/30'
                : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
            }`}
          >
            <Icon size={18} strokeWidth={2} className={active ? 'text-white' : 'text-gray-400'} />
            <span>{label}</span>
            {isOpen ? (
              <ChevronDown size={16} strokeWidth={2} className="ml-auto" />
            ) : (
              <ChevronRight size={16} strokeWidth={2} className="ml-auto" />
            )}
          </button>
          {isOpen && (
            <div className="mt-1 ml-4 pl-3 border-l-2 border-blue-500/15 space-y-1">
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
          active
            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-600/20 ring-1 ring-blue-500/30'
            : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
        }`}
      >
        <Icon size={18} strokeWidth={2} className={active ? 'text-white' : 'text-gray-400'} />
        <span>{label}</span>
        {href === '/upload-order' && !!pendingOrders && (
          <span className="ml-auto flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-blue-600 text-white text-[11px] font-bold">
            {pendingOrders}
          </span>
        )}
      </button>
    );
  };

  return (
    <main
      className="min-h-screen text-black flex flex-col md:flex-row"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.07) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <NotificationDrawer enabled={hasWorkshopRms} />

      <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-blue-500/15 bg-white/80 backdrop-blur-md h-screen sticky top-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-blue-500/15">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shrink-0 ring-1 ring-white/10 shadow-sm shadow-blue-600/30">
            <Boxes size={18} strokeWidth={2} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={`${display.className} text-lg font-bold tracking-tight leading-none`}>
              Warehouse OS
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">{t('appShell.tagline')}</p>
          </div>
          <LanguageSwitcher />
        </div>

        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.label}>
              {group.items.length > 0 && (
                <>
                  <p className="text-[11px] font-semibold text-blue-700/50 tracking-wide uppercase px-3.5 mb-1.5">
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

        <div className="px-3 py-4 border-t border-blue-500/15">
          <button
            onClick={() => setShowProfile(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-blue-500/15 bg-white hover:bg-blue-50/60 hover:border-blue-500/30 transition-colors text-left"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-xs font-semibold text-white shrink-0 overflow-hidden">
              {profile?.avatarUrl && !avatarLoadFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setAvatarLoadFailed(true)}
                />
              ) : profile?.email ? (
                profile.email.slice(0, 2).toUpperCase()
              ) : (
                <User size={14} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">
                {profile?.email ?? t('appShell.account')}
              </p>
              {license && (
                <p className={`text-xs flex items-center gap-1.5 ${license.valid ? 'text-emerald-600' : 'text-red-600'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${license.valid ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {license.valid ? t('appShell.licenseActive') : license.status}
                </p>
              )}
            </div>
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* TOP BAR — mobile only, sticky so nav stays reachable while scrolling */}
        <div className="md:hidden sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)] pt-[env(safe-area-inset-top)]">
          <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shrink-0 ring-1 ring-white/10">
                <Boxes size={16} strokeWidth={2} className="text-white" />
              </div>
              <div className="min-w-0">
                <h1 className={`${display.className} text-base font-bold tracking-tight leading-none truncate`}>
                  Warehouse OS
                </h1>
                <p className="text-[11px] text-gray-500 mt-0.5">{t('appShell.tagline')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <LanguageSwitcher />
              <button
                onClick={() => setShowProfile(true)}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-blue-500/20 hover:bg-blue-50 hover:border-blue-500/40 font-medium transition-colors active:scale-95"
                aria-label={t('appShell.account')}
              >
                <User size={16} strokeWidth={2} className="text-blue-700" />
                <span className="hidden xs:inline">{t('appShell.account')}</span>
              </button>
            </div>
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
                className="flex gap-2 overflow-x-auto snap-x px-4 sm:px-5 pb-3 border-t border-blue-500/10 pt-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              className="bg-white rounded-t-xl sm:rounded-xl border border-blue-500/15 p-6 w-full sm:w-[320px] max-w-full sm:max-w-[320px] max-h-[85vh] overflow-y-auto shadow-xl shadow-blue-900/5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <span className="text-[15px] font-medium">{t('appShell.account')}</span>
                <button
                  onClick={() => setShowProfile(false)}
                  className="text-gray-400 hover:text-blue-700 transition-colors p-1 -m-1"
                  aria-label={t('appShell.close')}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex items-center gap-3 mb-5">
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-sm font-medium text-white shadow-sm overflow-hidden">
                    {profile.avatarUrl && !avatarLoadFailed ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profile.avatarUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={() => setAvatarLoadFailed(true)}
                      />
                    ) : (
                      profile.email.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAvatarLibrary(true)}
                    disabled={avatarUpdating}
                    className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white border border-blue-500/20 flex items-center justify-center text-blue-700 hover:bg-blue-50 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label={t('appShell.changeAvatar')}
                    title={t('appShell.changeAvatar')}
                  >
                    <Camera size={11} strokeWidth={2.5} />
                  </button>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{profile.email}</p>
                  <p className="text-xs text-gray-500 truncate">{profile.role} · {profile.organization.name}</p>
                </div>
              </div>

              {avatarError && <p className="text-xs text-red-600 mb-4">{avatarError}</p>}

              {license && (
                <div
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 mb-5 text-xs font-medium ${
                    license.valid
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  {license.valid ? <ShieldCheck size={15} strokeWidth={2} className="shrink-0" /> : <ShieldAlert size={15} strokeWidth={2} className="shrink-0" />}
                  <span>{license.valid ? t('appShell.licenseActive') : license.message || t('appShell.licenseInvalid')}</span>
                </div>
              )}

              <div className="border-t border-blue-500/10 pt-4 space-y-2.5 mb-5">
                {[
                  { label: t('appShell.email'), value: profile.email },
                  { label: t('appShell.role'), value: profile.role },
                  { label: t('appShell.organization'), value: profile.organization.name },
                  ...(license ? [{ label: t('appShell.license'), value: license.status }] : []),
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
                  className="w-full text-[13px] text-blue-600 hover:text-blue-800 mb-5 text-center underline py-1"
                >
                  {t('appShell.manageOrgSettings')}
                </button>
              )}

              <div className="mb-5">
                {!showChangePassword ? (
                  <button
                    type="button"
                    onClick={() => setShowChangePassword(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-md border border-blue-500/15 text-[13px] font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-500/30 transition-colors"
                  >
                    <Lock size={14} />
                    {t('appShell.changePassword')}
                  </button>
                ) : (
                  <form onSubmit={handleChangePassword} className="space-y-2.5">
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      placeholder={t('appShell.currentPassword')}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full text-[13px] px-3 py-2 rounded-md border border-blue-500/15 focus:outline-none focus:border-blue-500/40"
                    />
                    <input
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder={t('appShell.newPassword')}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full text-[13px] px-3 py-2 rounded-md border border-blue-500/15 focus:outline-none focus:border-blue-500/40"
                    />
                    <input
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder={t('appShell.confirmNewPassword')}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full text-[13px] px-3 py-2 rounded-md border border-blue-500/15 focus:outline-none focus:border-blue-500/40"
                    />
                    {changePasswordError && (
                      <p className="text-xs text-red-600">{changePasswordError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={resetChangePasswordForm}
                        className="flex-1 py-2 rounded-md border border-blue-500/15 text-[13px] font-medium text-gray-600 hover:bg-blue-50 transition-colors"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="submit"
                        disabled={changingPassword}
                        className="flex-1 py-2 rounded-md bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {changingPassword ? t('common.saving') : t('appShell.updatePassword')}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <button
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-600 text-[13px] font-medium hover:bg-red-100 transition-colors active:scale-[0.98]"
                onClick={async () => {
                  // FIX — was only clearing localStorage client-side and
                  // never calling the backend, so the server-side session
                  // (currentSessionId) stayed valid after "logging out" —
                  // a captured token from before the click would still
                  // work. Best-effort: still clear local state and
                  // redirect even if the network call fails, so a
                  // connectivity hiccup can't trap the user unable to log
                  // out. Also clears 'user', matching apiFetch's own
                  // 401 handler so both storage keys stay in sync.
                  try {
                    await apiFetch('/auth/logout', { method: 'POST' });
                  } catch {
                    // ignore — still proceed to clear local state below
                  }
                  localStorage.removeItem('accessToken');
                  localStorage.removeItem('user');
                  window.location.href = '/login';
                }}
              >
                <LogOut size={14} />
                {t('appShell.logOut')}
              </button>
            </div>
          </div>
        )}

        <MediaLibraryModal
          open={showAvatarLibrary}
          onClose={() => setShowAvatarLibrary(false)}
          onSelect={handleAvatarSelected}
        />

        {/* Page content */}
        <div className="flex-1 min-w-0 pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </main>
  );
}