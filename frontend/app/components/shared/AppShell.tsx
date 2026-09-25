'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { display } from '@/lib/fonts';
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
  BarChart3,
  Home,
  Navigation,
  Menu,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { ensurePushSubscription } from '@/lib/push';
import NotificationDrawer from '@/app/components/shared/NotificationDrawer';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';
import MediaLibraryModal, { MediaAsset } from '@/app/components/shared/MediaLibraryModal';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';

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

/* Shared modal plumbing for the account dialog and the mobile "More"
   sheet: lock body scroll, move focus in, keep Tab inside, close on
   Escape (by clicking the close button, so close logic lives in one
   place), and hand focus back to the trigger on close. suspendRef lets a
   stacked modal (the avatar picker) take over keyboard handling. */
function useModalBehavior(
  open: boolean,
  dialogRef: React.RefObject<HTMLElement | null>,
  closeRef: React.RefObject<HTMLButtonElement | null>,
  suspendRef?: React.RefObject<boolean>,
) {
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const trigger = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (suspendRef?.current) return;
      if (e.key === 'Escape') {
        closeRef.current?.click();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href]',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [open, dialogRef, closeRef, suspendRef]);
}

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
  const [hasDelivery, setHasDelivery] = useState(false);
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
  // Step 2: the backend emails a one-time code instead of applying the
  // password change immediately (see auth.controller.ts change-password /
  // change-password/confirm). otpSent gates which step of the form shows.
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [confirmingOtp, setConfirmingOtp] = useState(false);

  function resetChangePasswordForm() {
    setShowChangePassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setChangePasswordError('');
    setOtpSent(false);
    setOtpCode('');
  }

  // Drop any in-progress change-password form state when the account
  // modal closes, so reopening it doesn't show a stale error or filled
  // fields from a previous visit.
  function closeProfile() {
    setShowProfile(false);
    resetChangePasswordForm();
  }

  async function requestChangePasswordOtp() {
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
      return false;
    }
    return true;
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
      const sent = await requestChangePasswordOtp();
      if (sent) {
        setOtpSent(true);
      }
    } catch {
      setChangePasswordError(t('appShell.changePasswordFailed'));
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleResendOtp() {
    setChangePasswordError('');
    setChangingPassword(true);
    try {
      await requestChangePasswordOtp();
    } catch {
      setChangePasswordError(t('appShell.changePasswordFailed'));
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleConfirmOtp(e: React.FormEvent) {
    e.preventDefault();
    setChangePasswordError('');
    setConfirmingOtp(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/auth/change-password/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ code: otpCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChangePasswordError(
          typeof data.message === 'string' ? data.message : t('appShell.changePasswordVerifyFailed'),
        );
        return;
      }
      // Backend invalidates the session on a successful change, so finish
      // the same way the log out button does.
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      window.location.href = '/login';
    } catch {
      setChangePasswordError(t('appShell.changePasswordVerifyFailed'));
    } finally {
      setConfirmingOtp(false);
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
        setHasDelivery(
          statuses.some((s) => s.module === 'DELIVERY_DMS' && s.enabled),
        );
      } catch (err) {
        console.error('Module status fetch failed:', err);
      }
    })();
  }, []);

  // Only prompt office/admin users for push permission when the org
  // actually has a notification-producing module enabled — no point
  // asking for a permission that would never fire a notification.
  useEffect(() => {
    if (hasDelivery || hasWorkshopRms) {
      ensurePushSubscription();
    }
  }, [hasDelivery, hasWorkshopRms]);

  // The modal only renders once the profile has loaded, so gate every
  // modal side effect on the same condition — otherwise opening it before
  // the profile arrives locks scroll with nothing on screen.
  const profileOpen = showProfile && !!profile;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const avatarLibraryOpenRef = useRef(false);
  useEffect(() => {
    avatarLibraryOpenRef.current = showAvatarLibrary;
  }, [showAvatarLibrary]);

  useModalBehavior(profileOpen, dialogRef, closeButtonRef, avatarLibraryOpenRef);

  const [showMore, setShowMore] = useState(false);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const moreCloseRef = useRef<HTMLButtonElement>(null);
  useModalBehavior(showMore, moreSheetRef, moreCloseRef);

  // A group the user hasn't toggled is open when they're on one of its
  // routes; once toggled, their choice sticks across navigation.
  const isGroupOpen = (groups: Record<string, boolean>, href: string) =>
    groups[href] ?? pathname.startsWith(href);

  const salesChildren: NavItem[] = [
    { href: '/sales', label: t('nav.items.salesHome'), icon: Home },
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
    { href: '/purchasing', label: t('nav.items.purchasingHome'), icon: Home },
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
    { href: '/accounting', label: t('nav.items.accountingHome'), icon: Home },
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
    { href: '/accounting/sales-insights', label: t('nav.items.salesInsights'), icon: BarChart3 },
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
        { href: '/home', label: t('nav.items.home'), icon: Home },
        { href: '/inventory', label: t('nav.items.inventoryHome'), icon: Inbox },
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
            { href: '/workshop', label: t('nav.items.workshopHome'), icon: Home },
            { href: '/workshop/vehicles', label: t('nav.items.vehicles'), icon: Car },
            { href: '/workshop/vehicles/search', label: t('nav.items.vehicleLookup'), icon: Search },
            { href: '/workshop/reminders', label: t('nav.items.reminders'), icon: Bell },
          ]
        : [],
    },
    {
      label: t('nav.groups.delivery'),
      items: hasDelivery
        ? [
            { href: '/delivery', label: t('nav.items.deliveryHome'), icon: Truck },
            { href: '/delivery/routes', label: t('nav.items.deliveryRoutes'), icon: Navigation },
            { href: '/delivery/monitoring', label: t('nav.items.deliveryMonitoring'), icon: BarChart3 },
            ...(profile?.role === 'ADMIN'
              ? [{ href: '/delivery/drivers', label: t('nav.items.deliveryDrivers'), icon: Users }]
              : []),
          ]
        : [],
    },
    {
      label: t('nav.groups.system'),
      items:
        profile?.role === 'ADMIN'
          ? [
              { href: '/admin', label: t('nav.items.admin'), icon: ShieldCheck },
              { href: '/settings', label: t('nav.items.settings'), icon: Settings },
              { href: '/media-library', label: t('nav.items.mediaLibrary'), icon: Images },
            ]
          : [],
    },
  ];
  // Mobile bottom bar: the first four destinations this org actually has,
  // in priority order, plus "More" for the full grouped nav. Five slots
  // is the most a bottom bar holds before labels stop fitting at 375px.
  const tabCandidates: (NavItem | false)[] = [
    { href: '/home', label: t('nav.items.home'), icon: Home },
    { href: '/inventory/stock', label: t('nav.items.stock'), icon: LayoutDashboard },
    hasInvoicePos && { href: '/sales', label: t('nav.items.sales'), icon: ShoppingCart },
    hasDelivery && { href: '/delivery', label: t('nav.items.deliveryHome'), icon: Truck },
    hasWorkshopRms && { href: '/workshop', label: t('nav.items.workshopHome'), icon: Car },
    { href: '/inventory', label: t('nav.items.inventoryHome'), icon: Inbox },
    { href: '/upload', label: t('nav.items.upload'), icon: UploadIcon },
  ];
  const bottomTabs = tabCandidates.filter((x): x is NavItem => !!x).slice(0, 4);
  // Longest matching prefix wins, so /inventory/stock beats /inventory.
  const activeTab = bottomTabs
    .filter((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
    .sort((x, y) => y.href.length - x.href.length)[0]?.href;
  const pendingBadgeInMore = !!pendingOrders && !bottomTabs.some((tab) => tab.href === '/upload-order');

  // A render function, not a component: declaring a component inside
  // AppShell gives it a new identity every render, which remounts every
  // nav item and drops keyboard focus when a group is toggled.
  const renderNavLink = (item: NavItem) => {
    const { href, label, icon: Icon, children } = item;
    const active = children
      ? pathname.startsWith(href)
      : pathname === href;
    const focusRing =
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

    const rowClass = `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg font-medium text-[14.5px] transition-colors text-left ${focusRing} ${
      active
        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-600/20 ring-1 ring-blue-500/30'
        : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
    }`;

    // Parent item with children renders as an expand/collapse row
    // followed by indented child links.
    if (children) {
      const isOpen = isGroupOpen(openGroups, href);
      const groupId = `nav-group-${href.slice(1)}`;
      return (
        <div key={href}>
          <button
            type="button"
            onClick={() => setOpenGroups((prev) => ({ ...prev, [href]: !isOpen }))}
            aria-expanded={isOpen}
            aria-controls={groupId}
            className={rowClass}
          >
            <Icon size={18} strokeWidth={2} aria-hidden="true" className={active ? 'text-white' : 'text-gray-500'} />
            <span>{label}</span>
            {isOpen ? (
              <ChevronDown size={16} strokeWidth={2} aria-hidden="true" className="ml-auto" />
            ) : (
              <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className="ml-auto" />
            )}
          </button>
          {isOpen && (
            <div id={groupId} className="mt-1 ml-4 pl-3 border-l-2 border-blue-500/15 space-y-1">
              {children.map((child) => renderNavLink(child))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        className={rowClass}
      >
        <Icon size={18} strokeWidth={2} aria-hidden="true" className={active ? 'text-white' : 'text-gray-500'} />
        <span>{label}</span>
        {href === '/upload-order' && !!pendingOrders && (
          <span className="ml-auto flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-blue-600 text-white text-[11px] font-bold">
            {pendingOrders}
          </span>
        )}
      </Link>
    );
  };

  const renderNavGroups = () =>
    navGroups.map((group) =>
      group.items.length > 0 ? (
        <div key={group.label}>
          <p className="text-[11px] font-semibold text-blue-700/75 tracking-wide uppercase px-3.5 mb-1.5">
            {group.label}
          </p>
          <div className="space-y-1">{group.items.map((item) => renderNavLink(item))}</div>
        </div>
      ) : null,
    );

  const licenseStatusLabel = (status: string) => {
    const key = `appShell.licenseStatus.${status}`;
    const label = t(key);
    return label === key ? status : label;
  };
  const roleLabel = (role: string) => {
    const key = `appShell.roles.${role}`;
    const label = t(key);
    return label === key ? role : label;
  };

  return (
    <div
      className="min-h-dvh text-black flex flex-col md:flex-row [--app-bottom-nav-h:calc(3.5rem+env(safe-area-inset-bottom))] md:[--app-bottom-nav-h:0px]"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.07) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <NotificationDrawer enabled={hasWorkshopRms || hasDelivery} remindersEnabled={hasWorkshopRms} />

      <aside className="hidden md:flex md:flex-col w-64 shrink-0 border-r border-blue-500/15 bg-white/80 backdrop-blur-md h-dvh sticky top-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-blue-500/15">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shrink-0 ring-1 ring-white/10 shadow-sm shadow-blue-600/30">
            <Boxes size={18} strokeWidth={2} aria-hidden="true" className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={`${display.className} text-lg font-bold tracking-tight leading-none`}>
              {t('appShell.brand')}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">{t('appShell.tagline')}</p>
          </div>
          <LanguageSwitcher />
        </div>

        <nav aria-label={t('appShell.mainNavigation')} className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {renderNavGroups()}
        </nav>

        <div className="px-3 py-4 border-t border-blue-500/15">
          <button
            type="button"
            onClick={() => setShowProfile(true)}
            aria-haspopup="dialog"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-blue-500/15 bg-white hover:bg-blue-50/60 hover:border-blue-500/30 transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
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
                  {license.valid ? t('appShell.licenseActive') : licenseStatusLabel(license.status)}
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
                <Boxes size={16} strokeWidth={2} aria-hidden="true" className="text-white" />
              </div>
              <div className="min-w-0">
                <h1 className={`${display.className} text-base font-bold tracking-tight leading-none truncate`}>
                  {t('appShell.brand')}
                </h1>
                <p className="text-[11px] text-gray-500 mt-0.5">{t('appShell.tagline')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <LanguageSwitcher />
              <button
                type="button"
                onClick={() => setShowProfile(true)}
                aria-haspopup="dialog"
                className="flex items-center gap-1.5 text-sm px-3 py-2 min-h-11 rounded-md border border-blue-500/20 hover:bg-blue-50 hover:border-blue-500/40 font-medium transition-colors active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                aria-label={t('appShell.account')}
              >
                <User size={16} strokeWidth={2} aria-hidden="true" className="text-blue-700" />
                <span className="hidden sm:inline">{t('appShell.account')}</span>
              </button>
            </div>
          </div>

        </div>

        {/* BOTTOM TAB BAR — mobile only. Its height is published as
            --app-bottom-nav-h so page-level fixed bars can sit above it. */}
        <nav
          aria-label={t('appShell.mainNavigation')}
          className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-blue-500/15 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="grid grid-cols-5 h-14">
            {bottomTabs.map(({ href, label, icon: Icon }) => {
              const active = activeTab === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 ${
                    active ? 'text-blue-700' : 'text-gray-600 hover:text-blue-700'
                  }`}
                >
                  {active && <span aria-hidden="true" className="absolute top-0 inset-x-4 h-0.5 rounded-b bg-blue-600" />}
                  <Icon size={20} strokeWidth={active ? 2.25 : 2} aria-hidden="true" />
                  <span className="max-w-full truncate">{label}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setShowMore(true)}
              aria-haspopup="dialog"
              aria-expanded={showMore}
              className={`relative flex flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 ${
                !activeTab ? 'text-blue-700' : 'text-gray-600 hover:text-blue-700'
              }`}
            >
              {!activeTab && <span aria-hidden="true" className="absolute top-0 inset-x-4 h-0.5 rounded-b bg-blue-600" />}
              <span className="relative">
                <Menu size={20} strokeWidth={!activeTab ? 2.25 : 2} aria-hidden="true" />
                {pendingBadgeInMore && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
                    {pendingOrders}
                  </span>
                )}
              </span>
              <span>{t('appShell.more')}</span>
            </button>
          </div>
        </nav>

        {/* "More" sheet — the full grouped nav, same rows as the sidebar */}
        {showMore && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/25" onClick={() => setShowMore(false)}>
            <div
              ref={moreSheetRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="more-sheet-title"
              onClick={(e) => {
                e.stopPropagation();
                // Close once a destination is chosen; group toggles keep it open.
                if ((e.target as HTMLElement).closest('a')) setShowMore(false);
              }}
              className="absolute inset-x-0 bottom-0 max-h-[85dvh] flex flex-col rounded-t-2xl bg-white border-t border-blue-500/15 shadow-xl animate-sheet-in motion-reduce:animate-none"
            >
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-blue-500/10">
                <h2 id="more-sheet-title" className={`${display.className} text-base font-bold tracking-tight`}>
                  {t('appShell.brand')}
                </h2>
                <button
                  ref={moreCloseRef}
                  type="button"
                  onClick={() => setShowMore(false)}
                  aria-label={t('appShell.closeMenu')}
                  className="p-2.5 -m-2.5 rounded-md text-gray-500 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <nav
                aria-label={t('appShell.mainNavigation')}
                className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
              >
                {renderNavGroups()}
              </nav>
            </div>
          </div>
        )}

        {/* Account Modal */}
        {profileOpen && profile && (
          <div
            className="fixed inset-0 bg-black/25 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
            onClick={closeProfile}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="account-dialog-title"
              className="bg-white rounded-t-xl sm:rounded-xl border border-blue-500/15 p-6 w-full sm:w-[320px] max-w-full sm:max-w-[320px] max-h-[85dvh] overflow-y-auto shadow-xl shadow-blue-900/5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 id="account-dialog-title" className="text-[15px] font-medium">{t('appShell.account')}</h2>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeProfile}
                  className="text-gray-500 hover:text-blue-700 transition-colors p-2.5 -m-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-blue-600"
                  aria-label={t('appShell.close')}
                >
                  <X size={18} aria-hidden="true" />
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
                    className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-white border border-blue-500/20 flex items-center justify-center text-blue-700 hover:bg-blue-50 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label={t('appShell.changeAvatar')}
                    title={t('appShell.changeAvatar')}
                  >
                    <Camera size={12} strokeWidth={2.5} aria-hidden="true" />
                  </button>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{profile.email}</p>
                  <p className="text-xs text-gray-500 truncate">{roleLabel(profile.role)} · {profile.organization.name}</p>
                </div>
              </div>

              {avatarError && <p role="alert" className="text-xs text-red-600 mb-4">{avatarError}</p>}

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
                  { label: t('appShell.role'), value: roleLabel(profile.role) },
                  { label: t('appShell.organization'), value: profile.organization.name },
                  ...(license ? [{ label: t('appShell.license'), value: licenseStatusLabel(license.status) }] : []),
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center gap-3">
                    <span className="text-[13px] text-gray-500 shrink-0">{label}</span>
                    <span className="text-[13px] text-gray-700 text-right truncate">{value}</span>
                  </div>
                ))}
              </div>

              {profile.role === 'ADMIN' && (
                <button
                  onClick={() => {
                    closeProfile();
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
                    <Lock size={14} aria-hidden="true" />
                    {t('appShell.changePassword')}
                  </button>
                ) : !otpSent ? (
                  <form onSubmit={handleChangePassword} className="space-y-2.5">
                    <div>
                      <label htmlFor="current-password" className="block text-xs font-medium text-gray-700 mb-1">
                        {t('appShell.currentPassword')}
                      </label>
                      <input
                        type="password"
                        required
                        autoComplete="current-password"
                        id="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        aria-invalid={!!changePasswordError || undefined}
                        aria-describedby={changePasswordError ? 'change-password-error' : undefined}
                        className="w-full text-base sm:text-[13px] px-3 py-2 rounded-md border border-blue-500/25 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30"
                      />
                    </div>
                    <div>
                      <label htmlFor="new-password-input" className="block text-xs font-medium text-gray-700 mb-1">
                        {t('appShell.newPassword')}
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        id="new-password-input"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        aria-invalid={!!changePasswordError || undefined}
                        aria-describedby={changePasswordError ? 'change-password-error' : undefined}
                        className="w-full text-base sm:text-[13px] px-3 py-2 rounded-md border border-blue-500/25 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30"
                      />
                    </div>
                    <div>
                      <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-700 mb-1">
                        {t('appShell.confirmNewPassword')}
                      </label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        id="confirm-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        aria-invalid={!!changePasswordError || undefined}
                        aria-describedby={changePasswordError ? 'change-password-error' : undefined}
                        className="w-full text-base sm:text-[13px] px-3 py-2 rounded-md border border-blue-500/25 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30"
                      />
                    </div>
                    {changePasswordError && (
                      <p id="change-password-error" role="alert" className="text-xs text-red-600">{changePasswordError}</p>
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
                ) : (
                  <form onSubmit={handleConfirmOtp} className="space-y-2.5">
                    <p className="text-xs text-gray-500">{t('appShell.changePasswordOtpSent')}</p>
                    <div>
                      <label htmlFor="otp-code" className="block text-xs font-medium text-gray-700 mb-1">
                        {t('appShell.changePasswordOtpCode')}
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                        maxLength={6}
                        id="otp-code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        aria-invalid={!!changePasswordError || undefined}
                        aria-describedby={changePasswordError ? 'change-password-error' : undefined}
                        className="w-full text-base sm:text-[13px] px-3 py-2 rounded-md border border-blue-500/25 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30 tracking-widest"
                      />
                    </div>
                    {changePasswordError && (
                      <p id="change-password-error" role="alert" className="text-xs text-red-600">{changePasswordError}</p>
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
                        disabled={confirmingOtp || otpCode.length !== 6}
                        className="flex-1 py-2 rounded-md bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {confirmingOtp ? t('common.saving') : t('appShell.changePasswordConfirm')}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={changingPassword}
                      className="w-full text-[12px] text-blue-600 hover:text-blue-800 underline disabled:opacity-50"
                    >
                      {t('appShell.changePasswordResend')}
                    </button>
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
                <LogOut size={14} aria-hidden="true" />
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
        <main className="flex-1 min-w-0 pb-[var(--app-bottom-nav-h)] md:pb-[env(safe-area-inset-bottom)]">
          {children}
        </main>
      </div>
    </div>
  );
}