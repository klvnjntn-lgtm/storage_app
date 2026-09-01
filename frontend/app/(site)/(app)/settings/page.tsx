'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Settings as SettingsIcon, CheckCircle2, Tag, Image as ImageIcon, Percent } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useAuth } from '@/app/context/AuthContext';

type FulfillmentMode = 'PICK_PACK_SHIP' | 'PICK_SHIP';

type ModuleStatus = {
  module: string;
  purchased: boolean;
  enabled: boolean;
};

type BusinessDetails = {
  legalName: string | null;
  npwp: string | null;
  address: string | null;   // ← add
  phone: string | null;     // ← add
  logoUrl: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
};

// A row from GET /organization/tax-rates. Settings now manages a list of
// these (add / set default / remove) instead of a single Yes/No default —
// this same list is what populates the per-item tax picker on invoice/new.
type OrgTaxRate = {
  id: string;
  name: string;
  percentage: number;
  isDefault: boolean;
  archivedAt: string | null;
};

export default function SettingsPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();

  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode | null>(null);
  const [posPricingEnabled, setPosPricingEnabled] = useState<boolean | null>(null);
  const [modules, setModules] = useState<ModuleStatus[] | null>(null);

  const [business, setBusiness] = useState<BusinessDetails | null>(null);
  const [businessForm, setBusinessForm] = useState<Partial<BusinessDetails>>({});
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [businessSaved, setBusinessSaved] = useState(false);

  // Tax — backed by full CRUD on /organization/tax-rates (GET/POST list,
  // PATCH/DELETE :id). Any number of rates, each independently active or
  // archived, with at most one flagged isDefault (used to pre-fill new
  // invoice lines). This is the same list the invoice/new tax picker reads.
  const [taxRates, setTaxRates] = useState<OrgTaxRate[] | null>(null);
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxPercentage, setNewTaxPercentage] = useState('');
  const [savingTaxId, setSavingTaxId] = useState<string | 'new' | null>(null);
  const [taxError, setTaxError] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Access gate — redirect away as soon as we know the user isn't an admin.
  // Runs before the data-fetching effect below so we never even request
  // org settings for a non-admin (the backend would 403 it anyway, but no
  // reason to fire the request or render the form first).
  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      router.replace('/login');
      return;
    }
    if (profile.role !== 'ADMIN') {
      router.replace('/stock');
    }
  }, [authLoading, profile, router]);

  useEffect(() => {
    if (authLoading || profile?.role !== 'ADMIN') return;

    apiFetch('/organization/settings')
      .then((res) => res.json())
      .then((data) => {
        setFulfillmentMode(data.fulfillmentMode);
        setPosPricingEnabled(data.posPricingEnabled);
        const details: BusinessDetails = {
          legalName: data.legalName ?? null,
          npwp: data.npwp ?? null,
          logoUrl: data.logoUrl ?? null,
                address: data.address ?? null,   // ← add
      phone: data.phone ?? null,       // ← add

          bankName: data.bankName ?? null,
          bankAccountNumber: data.bankAccountNumber ?? null,
          bankAccountName: data.bankAccountName ?? null,
        };
        setBusiness(details);
        setBusinessForm(details);
      })
      .catch(() => setError('Could not load settings'));

    apiFetch('/organizations/modules/status')
      .then((res) => res.json())
      .then((data: ModuleStatus[]) => setModules(data))
      .catch(() => setError('Could not load modules'));

    apiFetch('/organization/tax-rates')
      .then((res) => res.json())
      .then((data: OrgTaxRate[]) => setTaxRates(data.filter((t) => !t.archivedAt)))
      .catch(() => setError('Could not load tax rates'));
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
        setError(data?.message || 'Failed to update settings');
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
        setError(data?.message || 'Failed to update POS pricing');
        return;
      }
      setPosPricingEnabled(data.posPricingEnabled);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function addTaxRate() {
    setTaxError('');
    const name = newTaxName.trim();
    const percentage = Number(newTaxPercentage);

    if (!name) {
      setTaxError('Enter a tax name');
      return;
    }
    if (newTaxPercentage.trim() === '' || Number.isNaN(percentage) || percentage < 0 || percentage > 100) {
      setTaxError('Percentage must be a number between 0 and 100');
      return;
    }

    setSavingTaxId('new');
    try {
      const res = await apiFetch('/organization/tax-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, percentage }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTaxError(data?.message || 'Failed to add tax rate');
        return;
      }
      setTaxRates((prev) => [...(prev ?? []), data]);
      setNewTaxName('');
      setNewTaxPercentage('');
    } finally {
      setSavingTaxId(null);
    }
  }

  // Handles both directions now: pass `true` to make a rate the default
  // (which clears the flag on every other rate, since only one default can
  // exist at a time), or `false` to unset it as default without promoting
  // anything else — leaving the list with no default at all.
  async function setDefaultTaxRate(id: string, isDefault: boolean) {
    setTaxError('');
    setSavingTaxId(id);
    try {
      const res = await apiFetch(`/organization/tax-rates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTaxError(data?.message || (isDefault ? 'Failed to set default' : 'Failed to unset default'));
        return;
      }
      setTaxRates(
        (prev) =>
          prev?.map((t) => {
            if (t.id === id) return { ...t, isDefault };
            // When promoting a new default, every other rate loses the flag.
            // When just unsetting one, leave the others untouched.
            return isDefault ? { ...t, isDefault: false } : t;
          }) ?? prev,
      );
    } finally {
      setSavingTaxId(null);
    }
  }

  async function archiveTaxRate(id: string) {
    setTaxError('');
    setSavingTaxId(id);
    try {
      const res = await apiFetch(`/organization/tax-rates/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setTaxError(data?.message || 'Failed to remove tax rate');
        return;
      }
      setTaxRates((prev) => prev?.filter((t) => t.id !== id) ?? prev);
    } finally {
      setSavingTaxId(null);
    }
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    try {
      const body = new FormData();
      body.append('logo', file);
      const res = await apiFetch('/organization/logo', { method: 'POST', body });
      if (res.ok) {
        const { logoUrl } = await res.json();
        setBusinessForm((f) => ({ ...f, logoUrl }));
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
      const res = await apiFetch('/organization/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: businessForm.legalName || undefined,
          npwp: businessForm.npwp || undefined,
          logoUrl: businessForm.logoUrl || undefined,
                  address: businessForm.address || undefined,   // ← add
        phone: businessForm.phone || undefined,        // ← add

          bankName: businessForm.bankName || undefined,
          bankAccountNumber: businessForm.bankAccountNumber || undefined,
          bankAccountName: businessForm.bankAccountName || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message || 'Failed to save business details');
        return;
      }
      setBusiness((b) => (b ? { ...b, ...businessForm } : b));
      setBusinessSaved(true);
    } finally {
      setSavingBusiness(false);
    }
  }

  // Block render until we've confirmed the user is an admin — avoids
  // flashing the settings form (and firing its data requests) for anyone
  // else while the redirect in the effect above is in flight.
  if (authLoading || profile?.role !== 'ADMIN') {
    return null;
  }

  const hasWarehouseOps = modules?.find((m) => m.module === 'WAREHOUSE_OPS')?.purchased ?? false;
  const hasInvoicePos = modules?.find((m) => m.module === 'INVOICE_POS')?.purchased ?? false;

  const loaded = fulfillmentMode !== null && posPricingEnabled !== null && modules !== null;

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Scanner Hub
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <SettingsIcon size={22} strokeWidth={2} className="text-gray-700 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate">Settings</h1>
              <p className="text-xs text-gray-500 truncate">Organization-wide warehouse settings</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 sm:space-y-6">
        {error && (
          <div className="bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            {error}
          </div>
        )}

        {(saved || businessSaved) && (
          <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} />
            Settings saved
          </div>
        )}

        {/* Business identity — for invoices. Shown whenever INVOICE_POS is purchased. */}
        {hasInvoicePos && business && (
          <section className="border-2 border-gray-300 rounded-md p-4 sm:p-5 space-y-3">
            <div>
              <h2 className="font-bold">Business Identity</h2>
              <p className="text-sm text-gray-600 mt-1">
                Shown on printed invoices — logo, legal name, NPWP, and bank details for customers paying by transfer.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-md border-2 border-gray-200 flex items-center justify-center overflow-hidden shrink-0 bg-gray-50">
                {businessForm.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
src={
  businessForm.logoUrl?.startsWith('http')
    ? businessForm.logoUrl
    : `/api${businessForm.logoUrl}`
}
                    alt="Logo"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImageIcon size={20} className="text-gray-300" />
                )}
              </div>
              <label className="text-xs px-3 py-2 rounded-md border-2 border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer font-medium">
                {uploadingLogo ? 'Uploading...' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
                />
              </label>
            </div>

<div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
  <input
    value={businessForm.legalName ?? ''}
    onChange={(e) => setBusinessForm((f) => ({ ...f, legalName: e.target.value }))}
    placeholder="Legal business name (optional)"
    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
  />
  <input
    value={businessForm.npwp ?? ''}
    onChange={(e) => setBusinessForm((f) => ({ ...f, npwp: e.target.value }))}
    placeholder="NPWP (optional)"
    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
  />
  <input
    value={businessForm.address ?? ''}
    onChange={(e) => setBusinessForm((f) => ({ ...f, address: e.target.value }))}
    placeholder="Business address (optional)"
    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black sm:col-span-2"
  />
  <input
    value={businessForm.phone ?? ''}
    onChange={(e) => setBusinessForm((f) => ({ ...f, phone: e.target.value }))}
    placeholder="Business phone (optional)"
    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
  />
  <input
    value={businessForm.bankName ?? ''}
    onChange={(e) => setBusinessForm((f) => ({ ...f, bankName: e.target.value }))}
    placeholder="Bank name (optional)"
    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
  />
  <input
    value={businessForm.bankAccountNumber ?? ''}
    onChange={(e) => setBusinessForm((f) => ({ ...f, bankAccountNumber: e.target.value }))}
    placeholder="Bank account number (optional)"
    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
  />
  <input
    value={businessForm.bankAccountName ?? ''}
    onChange={(e) => setBusinessForm((f) => ({ ...f, bankAccountName: e.target.value }))}
    placeholder="Bank account holder name (optional)"
    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black sm:col-span-2"
  />
</div>
            <button
              type="button"
              onClick={saveBusinessDetails}
              disabled={savingBusiness}
              className="text-sm px-4 py-2 rounded-md bg-black text-white font-semibold disabled:bg-gray-300"
            >
              {savingBusiness ? 'Saving...' : 'Save business details'}
            </button>
          </section>
        )}

        {/* Tax rates — full list, not a single on/off default. Whichever
            rate is marked "Default" here is what pre-fills new invoice
            lines; staff can still pick a different rate (or several) per
            line item on invoice/new. A rate can also have no default set
            at all — "Unset default" clears the flag without promoting
            anything else. */}
        {hasInvoicePos && (
          <section className="border-2 border-gray-300 rounded-md p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Percent size={16} strokeWidth={2} className="text-gray-700" />
              <h2 className="font-bold">Tax Rates</h2>
            </div>
            <p className="text-sm text-gray-600 max-w-md">
              Add as many tax rates as you need (e.g. PPN 11%, a service charge, a local levy).
              Staff choose which of these apply per item when creating an invoice.
            </p>

            {taxError && <p className="text-xs text-red-700">{taxError}</p>}

            {/* Each row used to be one `flex justify-between` line — fine on
                desktop, but on a narrow phone a longer tax name plus the
                Default badge plus two buttons has nowhere to go and either
                overflows or crushes the buttons. Below sm it now stacks:
                name/badge on their own line, buttons on the next, full width
                and easy to tap. */}
            <div className="flex flex-col divide-y divide-gray-200">
              {taxRates?.map((rate) => (
                <div key={rate.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{rate.name}</span>
                    <span className="text-sm text-gray-500 ml-2">{rate.percentage}%</span>
                    {rate.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 font-medium ml-2">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDefaultTaxRate(rate.id, !rate.isDefault)}
                      disabled={savingTaxId === rate.id}
                      className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-gray-300 text-gray-600 hover:border-black disabled:opacity-50"
                    >
                      {rate.isDefault ? 'Unset default' : 'Set default'}
                    </button>
                    <button
                      type="button"
                      onClick={() => archiveTaxRate(rate.id)}
                      disabled={savingTaxId === rate.id}
                      className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-gray-300 text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {taxRates?.length === 0 && (
                <p className="text-sm text-gray-400 py-2">No tax rates yet.</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <input
                value={newTaxName}
                onChange={(e) => setNewTaxName(e.target.value)}
                placeholder="Tax name (e.g. PPN)"
                className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 text-sm outline-none focus:border-black flex-1 min-w-0"
              />
              <div className="relative">
                <input
                  value={newTaxPercentage}
                  onChange={(e) => setNewTaxPercentage(e.target.value)}
                  placeholder="11"
                  inputMode="decimal"
                  className="border-2 border-gray-300 rounded-md p-2.5 sm:p-2 pr-7 text-sm outline-none focus:border-black w-full sm:w-24"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                  %
                </span>
              </div>
              <button
                type="button"
                onClick={addTaxRate}
                disabled={savingTaxId === 'new'}
                className="text-sm px-4 py-2.5 sm:py-2 rounded-md bg-black text-white font-semibold disabled:bg-gray-300"
              >
                {savingTaxId === 'new' ? 'Adding...' : 'Add tax rate'}
              </button>
            </div>
          </section>
        )}

        {/* POS Pricing */}
        {hasInvoicePos && (
          <section className="border-2 border-gray-300 rounded-md p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Tag size={16} strokeWidth={2} className="text-gray-700" />
              <h2 className="font-bold">Invoice Pricing</h2>
            </div>
            <p className="text-sm text-gray-600 max-w-md">
              Choose how prices are set when staff create an invoice.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                type="button"
                disabled={saving || !loaded}
                onClick={() => savePosPricingEnabled(true)}
                className={`flex-1 text-left border-2 rounded-md p-3 transition disabled:opacity-50 ${
                  posPricingEnabled === true
                    ? 'border-black bg-gray-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                      posPricingEnabled === true ? 'border-black bg-black' : 'border-gray-400'
                    }`}
                  />
                  <span className="font-semibold text-sm">Custom Price</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-5">
                  Staff type a price per item at checkout. Catalog prices aren't shown.
                </p>
              </button>

              <button
                type="button"
                disabled={saving || !loaded}
                onClick={() => savePosPricingEnabled(false)}
                className={`flex-1 text-left border-2 rounded-md p-3 transition disabled:opacity-50 ${
                  posPricingEnabled === false
                    ? 'border-black bg-gray-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                      posPricingEnabled === false ? 'border-black bg-black' : 'border-gray-400'
                    }`}
                  />
                  <span className="font-semibold text-sm">Database / Import Price</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-5">
                  Always use each item's catalog price — set manually or via Excel import.
                </p>
              </button>
            </div>
          </section>
        )}

        {/* Fulfillment Workflow */}
        {hasWarehouseOps && (
          <section className="border-2 border-gray-300 rounded-md p-4 sm:p-5 space-y-3">
            <div>
              <h2 className="font-bold">Fulfillment Workflow</h2>
              <p className="text-sm text-gray-600 mt-1">
                Choose how fulfillment sessions move through stages.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                type="button"
                disabled={saving || !loaded}
                onClick={() => saveFulfillmentMode('PICK_PACK_SHIP')}
                className={`flex-1 text-left border-2 rounded-md p-3 transition disabled:opacity-50 ${
                  fulfillmentMode === 'PICK_PACK_SHIP'
                    ? 'border-black bg-gray-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                      fulfillmentMode === 'PICK_PACK_SHIP' ? 'border-black bg-black' : 'border-gray-400'
                    }`}
                  />
                  <span className="font-semibold text-sm">Pick → Pack → Ship</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-5">
                  Full three-stage flow — best if picking and packing happen separately.
                </p>
              </button>

              <button
                type="button"
                disabled={saving || !loaded}
                onClick={() => saveFulfillmentMode('PICK_SHIP')}
                className={`flex-1 text-left border-2 rounded-md p-3 transition disabled:opacity-50 ${
                  fulfillmentMode === 'PICK_SHIP'
                    ? 'border-black bg-gray-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                      fulfillmentMode === 'PICK_SHIP' ? 'border-black bg-black' : 'border-gray-400'
                    }`}
                  />
                  <span className="font-semibold text-sm">Pick → Ship</span>
                </div>
                <p className="text-xs text-gray-500 mt-1 ml-5">
                  Skip packing — good for small stores where one person handles the whole order.
                </p>
              </button>
            </div>

            <p className="text-xs text-gray-400 pt-1">
              This applies to new fulfillment sessions going forward. Sessions already
              in progress keep the stage list they started with.
            </p>
          </section>
        )}

        {loaded && !hasWarehouseOps && !hasInvoicePos && (
          <div className="text-sm text-gray-500 border-2 border-dashed border-gray-300 rounded-md p-5 text-center">
            No optional modules are active on this organization yet.
          </div>
        )}
      </div>
    </main>
  );
}