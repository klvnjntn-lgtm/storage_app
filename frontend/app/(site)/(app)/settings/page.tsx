'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Settings as SettingsIcon, CheckCircle2, Tag, Image as ImageIcon, ClipboardList } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';
import MediaLibraryModal, { MediaAsset } from '@/app/components/shared/MediaLibraryModal';
import { ToggleRow } from '@/app/components/shared/PageFrame';
import { WORK_ORDERS_CHANGED } from '@/app/components/workshop/workOrders';
import PriceLevelsSettings from '@/app/components/settings/PriceLevelsSettings';
import InvoiceNumberingSettings from '@/app/components/settings/InvoiceNumberingSettings';
import ExportBusinessSettings from '@/app/components/settings/ExportBusinessSettings';
import TaxRatesSection from '@/app/components/settings/TaxRatesSection';
import BankAccountsSection from '@/app/components/settings/BankAccountsSection';
import { isAdminRole } from '@/lib/roles';


type FulfillmentMode = 'PICK_PACK_SHIP' | 'PICK_SHIP';
type StockPolicy = 'BLOCK' | 'WARN' | 'ALLOW';

type ModuleStatus = {
  module: string;
  purchased: boolean;
  enabled: boolean;
};

type BusinessDetails = {
  legalName: string | null;
  npwp: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
};



export default function SettingsPage() {
  const router = useRouter();
  const { profile, loading: authLoading, error: authError } = useAuth();
  const { t } = useLanguage();

  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode | null>(null);
  const [posPricingEnabled, setPosPricingEnabled] = useState<boolean | null>(null);
  const [stockPolicy, setStockPolicy] = useState<StockPolicy | null>(null);
  const [stockOverrideRequiresAdmin, setStockOverrideRequiresAdmin] = useState<boolean | null>(null);
  const [modules, setModules] = useState<ModuleStatus[] | null>(null);
  const [workOrdersEnabled, setWorkOrdersEnabled] = useState(false);

  const [business, setBusiness] = useState<BusinessDetails | null>(null);
  const [businessForm, setBusinessForm] = useState<Partial<BusinessDetails>>({});
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [showLogoLibrary, setShowLogoLibrary] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [businessSaved, setBusinessSaved] = useState(false);

  // Drives which calendar day/fiscal period a journal entry posts into
  // (backend/src/accounting/business-date.ts) — was a single global env
  // var before, now per-org. Kept separate from BusinessDetails/
  // saveBusinessDetails since it's not "shown on invoices" like those
  // fields are, even though it's saved through the same PATCH endpoint.
  const [timezone, setTimezone] = useState<string | null>(null);
  const [timezoneForm, setTimezoneForm] = useState('');
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [timezoneSaved, setTimezoneSaved] = useState(false);
  const [timezoneError, setTimezoneError] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Access gate — redirect away as soon as we know the user isn't an admin.
  // Runs before the data-fetching effect below so we never even request
  // org settings for a non-admin (the backend would 403 it anyway, but no
  // reason to fire the request or render the form first).
  useEffect(() => {
    if (authLoading) return;
    // FIX — was redirecting to /login whenever `profile` was null, which
    // conflated "genuinely not logged in" with "the /auth/me call hit a
    // transient error" (a real 401 already redirects on its own via
    // apiFetch — this component doesn't need to react to that case at
    // all). authError distinguishes the two; on a transient failure we
    // just don't render the gated form rather than force-logging out a
    // valid admin.
    if (!profile) {
      if (!authError) router.replace('/login');
      return;
    }
    if (!isAdminRole(profile.role)) {
      // FIX — was '/stock', which doesn't exist (real route is
      // '/inventory/stock'); every non-admin who landed on /settings got
      // bounced to a 404 instead of a working page.
      router.replace('/inventory/stock');
    }
  }, [authLoading, profile, authError, router]);

  useEffect(() => {
    if (authLoading || !isAdminRole(profile?.role)) return;

    apiFetch('/organization/settings')
      .then((res) => res.json())
      .then((data) => {
        setFulfillmentMode(data.fulfillmentMode);
        setPosPricingEnabled(data.posPricingEnabled);
        setStockPolicy(data.stockPolicy ?? 'BLOCK');
        setStockOverrideRequiresAdmin(!!data.stockOverrideRequiresAdmin);
        setWorkOrdersEnabled(!!data.workOrdersEnabled);
        const details: BusinessDetails = {
          legalName: data.legalName ?? null,
          npwp: data.npwp ?? null,
          logoUrl: data.logoUrl ?? null,
          address: data.address ?? null,
          phone: data.phone ?? null,
        };
        setBusiness(details);
        setBusinessForm(details);
        setTimezone(data.timezone ?? 'Asia/Jakarta');
        setTimezoneForm(data.timezone ?? 'Asia/Jakarta');
      })
      .catch(() => setError(t('settings.couldNotLoadSettings')));

    apiFetch('/organizations/modules/status')
      .then((res) => res.json())
      .then((data: ModuleStatus[]) => setModules(data))
      .catch(() => setError(t('settings.couldNotLoadModules')));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, profile]);

  async function saveFulfillmentMode(newMode: FulfillmentMode) {
    setSaving(true);
    setError('');
    setSaved(false);
    const prev = fulfillmentMode;
    setFulfillmentMode(newMode); // optimistic
    try {
      const res = await apiFetch(`/organization/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fulfillmentMode: newMode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFulfillmentMode(prev); // roll back
        setError(data?.message || t('settings.updateSettingsFailed'));
        return;
      }
      setFulfillmentMode(data.fulfillmentMode);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function savePosPricingEnabled(next: boolean) {
    setSaving(true);
    setError('');
    setSaved(false);
    const prev = posPricingEnabled;
    setPosPricingEnabled(next); // optimistic
    try {
      const res = await apiFetch('/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posPricingEnabled: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPosPricingEnabled(prev); // roll back
        setError(data?.message || t('settings.updatePosPricingFailed'));
        return;
      }
      setPosPricingEnabled(data.posPricingEnabled);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function saveWorkOrdersEnabled(next: boolean) {
    setSaving(true);
    setError('');
    setSaved(false);
    const prev = workOrdersEnabled;
    setWorkOrdersEnabled(next); // optimistic
    try {
      const res = await apiFetch('/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workOrdersEnabled: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setWorkOrdersEnabled(prev); // roll back
        setError(data?.message || t('settings.workOrders.saveFailed'));
        return;
      }
      setWorkOrdersEnabled(!!data.workOrdersEnabled);
      window.dispatchEvent(new Event(WORK_ORDERS_CHANGED));
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function saveStockPolicy(next: StockPolicy) {
    setSaving(true);
    setError('');
    setSaved(false);
    const prev = stockPolicy;
    setStockPolicy(next); // optimistic
    try {
      const res = await apiFetch('/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockPolicy: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStockPolicy(prev); // roll back
        setError(data?.message || t('settings.stockPolicy.updateFailed'));
        return;
      }
      setStockPolicy(data.stockPolicy);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function saveStockOverrideRequiresAdmin(next: boolean) {
    setSaving(true);
    setError('');
    setSaved(false);
    const prev = stockOverrideRequiresAdmin;
    setStockOverrideRequiresAdmin(next); // optimistic
    try {
      const res = await apiFetch('/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockOverrideRequiresAdmin: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStockOverrideRequiresAdmin(prev); // roll back
        setError(data?.message || t('settings.stockPolicy.updateFailed'));
        return;
      }
      setStockOverrideRequiresAdmin(data.stockOverrideRequiresAdmin);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function selectLogoFromLibrary(asset: MediaAsset) {
    setUploadingLogo(true);
    try {
      const res = await apiFetch('/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoUrl: asset.url }),
      });
      if (res.ok) {
        setBusinessForm((f) => ({ ...f, logoUrl: asset.url }));
      }
    } finally {
      setUploadingLogo(false);
    }
  }

  async function saveBusinessDetails() {
    setSavingBusiness(true);
    setBusinessSaved(false);
    setError('');
    try {
      // FIX — was `businessForm.legalName || undefined` etc. The backend
      // (organization.service.ts) treats undefined as "leave unchanged"
      // and only clears a field when it's explicitly sent as '' (it does
      // `.trim()` on whatever's sent, so `null` would crash it — hence
      // the `?? ''` below, not a bare pass-through). Since this button
      // saves the whole form (not a per-field partial patch), every
      // field should always be sent as its actual current value —
      // clearing a field to empty and saving used to silently send
      // undefined instead, so the backend kept the old value while the
      // UI optimistically showed "saved" and the field reappeared on the
      // next reload.
      const res = await apiFetch('/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: businessForm.legalName ?? '',
          npwp: businessForm.npwp ?? '',
          logoUrl: businessForm.logoUrl ?? '',
          address: businessForm.address ?? '',
          phone: businessForm.phone ?? '',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message || t('settings.businessIdentity.saveFailed'));
        return;
      }
      setBusiness((b) => (b ? { ...b, ...businessForm } : b));
      setBusinessSaved(true);
    } finally {
      setSavingBusiness(false);
    }
  }

  async function saveTimezone() {
    setSavingTimezone(true);
    setTimezoneSaved(false);
    setTimezoneError('');
    try {
      const res = await apiFetch('/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: timezoneForm }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTimezoneError(data?.message || t('settings.timezone.saveFailed'));
        return;
      }
      setTimezone(timezoneForm);
      setTimezoneSaved(true);
    } finally {
      setSavingTimezone(false);
    }
  }

  // Block render until we've confirmed the user is an admin — avoids
  // flashing the settings form (and firing its data requests) for anyone
  // else while the redirect in the effect above is in flight.
  if (authLoading || !isAdminRole(profile?.role)) {
    return null;
  }

  const hasWarehouseOps = modules?.find((m) => m.module === 'WAREHOUSE_OPS')?.purchased ?? false;
  const hasInvoicePos = modules?.find((m) => m.module === 'INVOICE_POS')?.purchased ?? false;
  const hasWorkshopRms = modules?.find((m) => m.module === 'WORKSHOP_RMS')?.purchased ?? false;

  const loaded = fulfillmentMode !== null && posPricingEnabled !== null && stockPolicy !== null && modules !== null;

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <SettingsIcon size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('settings.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('settings.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 sm:space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
            {error}
          </div>
        )}

        {(saved || businessSaved || timezoneSaved) && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} />
            {t('settings.settingsSaved')}
          </div>
        )}

        {/* Business identity — for invoices. Shown whenever INVOICE_POS is purchased. */}
        {hasInvoicePos && business && (
          <section id="business-identity" className="scroll-mt-24 border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div>
              <h2 className="font-bold">{t('settings.businessIdentity.heading')}</h2>
              <p className="text-sm text-gray-600 mt-1">
                {t('settings.businessIdentity.description')}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-lg border border-blue-500/15 flex items-center justify-center overflow-hidden shrink-0 bg-blue-50/40">
                {businessForm.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      businessForm.logoUrl?.startsWith('http')
                        ? businessForm.logoUrl
                        : `/api${businessForm.logoUrl}`
                    }
                    alt={t('settings.businessIdentity.logoAlt')}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImageIcon size={20} className="text-blue-300" />
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowLogoLibrary(true)}
                disabled={uploadingLogo}
                className="text-xs px-3 py-2 rounded-md border border-blue-500/20 text-blue-700 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-medium transition-colors"
              >
                {uploadingLogo ? t('settings.businessIdentity.uploading') : t('settings.businessIdentity.uploadLogo')}
              </button>
            </div>

            <MediaLibraryModal
              open={showLogoLibrary}
              onClose={() => setShowLogoLibrary(false)}
              onSelect={selectLogoFromLibrary}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <input
                value={businessForm.legalName ?? ''}
                onChange={(e) => setBusinessForm((f) => ({ ...f, legalName: e.target.value }))}
                placeholder={t('settings.businessIdentity.legalNamePlaceholder')}
                className="border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
              />
              <input
                value={businessForm.npwp ?? ''}
                onChange={(e) => setBusinessForm((f) => ({ ...f, npwp: e.target.value }))}
                placeholder={t('settings.businessIdentity.npwpPlaceholder')}
                className="border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
              />
              <input
                value={businessForm.address ?? ''}
                onChange={(e) => setBusinessForm((f) => ({ ...f, address: e.target.value }))}
                placeholder={t('settings.businessIdentity.addressPlaceholder')}
                className="border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all sm:col-span-2"
              />
              <input
                value={businessForm.phone ?? ''}
                onChange={(e) => setBusinessForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder={t('settings.businessIdentity.phonePlaceholder')}
                className="border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
              />
            </div>
            <button
              type="button"
              onClick={saveBusinessDetails}
              disabled={savingBusiness}
              className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm disabled:bg-gray-300 transition-colors"
            >
              {savingBusiness ? t('common.saving') : t('settings.businessIdentity.saveButton')}
            </button>
          </section>
        )}

        {/* Timezone — drives which calendar day/fiscal period a journal
            entry posts into, not just cosmetic date display. Shown
            whenever INVOICE_POS is purchased, same gate as Business
            Identity, since accounting itself requires that module. */}
        {hasInvoicePos && timezone !== null && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div>
              <h2 className="font-bold">{t('settings.timezone.heading')}</h2>
              <p className="text-sm text-gray-600 mt-1">
                {t('settings.timezone.description')}
              </p>
            </div>

            {timezoneError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-2">{timezoneError}</p>
            )}

            <select
              value={timezoneForm}
              onChange={(e) => {
                setTimezoneForm(e.target.value);
                setTimezoneSaved(false);
              }}
              className="border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all w-full sm:w-auto"
            >
              <option value="Asia/Jakarta">{t('settings.timezone.wib')}</option>
              <option value="Asia/Makassar">{t('settings.timezone.wita')}</option>
              <option value="Asia/Jayapura">{t('settings.timezone.wit')}</option>
              {timezoneForm && !['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'].includes(timezoneForm) && (
                <option value={timezoneForm}>{timezoneForm}</option>
              )}
            </select>

            <div>
              <button
                type="button"
                onClick={saveTimezone}
                disabled={savingTimezone || timezoneForm === timezone}
                className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm disabled:bg-gray-300 transition-colors"
              >
                {savingTimezone ? t('common.saving') : t('settings.timezone.saveButton')}
              </button>
            </div>
          </section>
        )}

        {hasInvoicePos && <BankAccountsSection onLoadError={setError} />}

        {hasInvoicePos && <TaxRatesSection onLoadError={setError} />}

        {hasInvoicePos && <InvoiceNumberingSettings />}

        {hasInvoicePos && <PriceLevelsSettings />}

        {/* POS Pricing */}
        {hasInvoicePos && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Tag size={16} strokeWidth={2} className="text-blue-700" />
              <h2 className="font-bold">{t('settings.invoicePricing.heading')}</h2>
            </div>
            <p className="text-sm text-gray-600 max-w-md">
              {t('settings.invoicePricing.description')}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                type="button"
                disabled={saving || !loaded}
                onClick={() => savePosPricingEnabled(true)}
                className={`flex-1 text-left border rounded-xl p-3 transition-colors disabled:opacity-50 ${
                  posPricingEnabled === true
                    ? 'border-blue-500/50 bg-blue-50/60'
                    : 'border-blue-500/15 hover:border-blue-500/35 hover:bg-blue-50/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                      posPricingEnabled === true ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                    }`}
                  />
                  <span className="font-semibold text-sm">{t('settings.invoicePricing.customPriceTitle')}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-5">
                  {t('settings.invoicePricing.customPriceDescription')}
                </p>
              </button>

              <button
                type="button"
                disabled={saving || !loaded}
                onClick={() => savePosPricingEnabled(false)}
                className={`flex-1 text-left border rounded-xl p-3 transition-colors disabled:opacity-50 ${
                  posPricingEnabled === false
                    ? 'border-blue-500/50 bg-blue-50/60'
                    : 'border-blue-500/15 hover:border-blue-500/35 hover:bg-blue-50/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                      posPricingEnabled === false ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                    }`}
                  />
                  <span className="font-semibold text-sm">{t('settings.invoicePricing.catalogPriceTitle')}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-5">
                  {t('settings.invoicePricing.catalogPriceDescription')}
                </p>
              </button>
            </div>
          </section>
        )}

        {/* Work orders — optional job cards for the workshop */}
        {hasWorkshopRms && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList size={16} strokeWidth={2} className="text-blue-700" />
              <h2 className="font-bold">{t('settings.workOrders.heading')}</h2>
            </div>
            <ToggleRow
              title={t('settings.workOrders.toggleTitle')}
              description={t('settings.workOrders.toggleDescription')}
              checked={workOrdersEnabled}
              onChange={saveWorkOrdersEnabled}
              disabled={saving || !loaded}
            />
          </section>
        )}

        {/* Stock Policy — hidden entirely for warehouse-ops orgs: pick/pack/ship
            always deducts stock strictly there (see StockService/DeliveryOrder),
            this setting has no effect on that path, and the backend rejects
            changing it while WAREHOUSE_OPS is active. */}
        {hasInvoicePos && !hasWarehouseOps && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div>
              <h2 className="font-bold">{t('settings.stockPolicy.heading')}</h2>
              <p className="text-sm text-gray-600 mt-1">{t('settings.stockPolicy.description')}</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              {([
                ['BLOCK', 'blockTitle', 'blockDescription'],
                ['WARN', 'warnTitle', 'warnDescription'],
                ['ALLOW', 'allowTitle', 'allowDescription'],
              ] as const).map(([value, titleKey, descKey]) => (
                <button
                  key={value}
                  type="button"
                  disabled={saving || !loaded}
                  onClick={() => saveStockPolicy(value)}
                  className={`flex-1 text-left border rounded-xl p-3 transition-colors disabled:opacity-50 ${
                    stockPolicy === value
                      ? 'border-blue-500/50 bg-blue-50/60'
                      : 'border-blue-500/15 hover:border-blue-500/35 hover:bg-blue-50/30'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                        stockPolicy === value ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                      }`}
                    />
                    <span className="font-semibold text-sm">{t(`settings.stockPolicy.${titleKey}`)}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 ml-5">{t(`settings.stockPolicy.${descKey}`)}</p>
                </button>
              ))}
            </div>

            {stockPolicy === 'WARN' && (
              <div className="pt-2">
                <ToggleRow
                  title={t('settings.stockPolicy.overrideRequiresAdminLabel')}
                  description={t('settings.stockPolicy.overrideRequiresAdminDescription')}
                  checked={stockOverrideRequiresAdmin ?? false}
                  disabled={saving || !loaded}
                  onChange={saveStockOverrideRequiresAdmin}
                />
              </div>
            )}
          </section>
        )}

        {/* Fulfillment Workflow */}
        {hasWarehouseOps && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div>
              <h2 className="font-bold">{t('settings.fulfillment.heading')}</h2>
              <p className="text-sm text-gray-600 mt-1">
                {t('settings.fulfillment.description')}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                type="button"
                disabled={saving || !loaded}
                onClick={() => saveFulfillmentMode('PICK_PACK_SHIP')}
                className={`flex-1 text-left border rounded-xl p-3 transition-colors disabled:opacity-50 ${
                  fulfillmentMode === 'PICK_PACK_SHIP'
                    ? 'border-blue-500/50 bg-blue-50/60'
                    : 'border-blue-500/15 hover:border-blue-500/35 hover:bg-blue-50/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                      fulfillmentMode === 'PICK_PACK_SHIP' ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                    }`}
                  />
                  <span className="font-semibold text-sm">{t('settings.fulfillment.pickPackShipTitle')}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-5">
                  {t('settings.fulfillment.pickPackShipDescription')}
                </p>
              </button>

              <button
                type="button"
                disabled={saving || !loaded}
                onClick={() => saveFulfillmentMode('PICK_SHIP')}
                className={`flex-1 text-left border rounded-xl p-3 transition-colors disabled:opacity-50 ${
                  fulfillmentMode === 'PICK_SHIP'
                    ? 'border-blue-500/50 bg-blue-50/60'
                    : 'border-blue-500/15 hover:border-blue-500/35 hover:bg-blue-50/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                      fulfillmentMode === 'PICK_SHIP' ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                    }`}
                  />
                  <span className="font-semibold text-sm">{t('settings.fulfillment.pickShipTitle')}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-5">
                  {t('settings.fulfillment.pickShipDescription')}
                </p>
              </button>
            </div>

            <p className="text-xs text-gray-400 pt-1">
              {t('settings.fulfillment.note')}
            </p>
          </section>
        )}

        {loaded && <ExportBusinessSettings />}

        {loaded && !hasWarehouseOps && !hasInvoicePos && (
          <div className="text-sm text-gray-500 border border-dashed border-blue-500/25 rounded-xl p-5 text-center bg-white/60">
            {t('settings.noModulesActive')}
          </div>
        )}
      </div>
    </main>
  );
}