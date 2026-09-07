'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, Settings as SettingsIcon, CheckCircle2, Tag, Image as ImageIcon, Percent, Landmark } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useAuth } from '@/app/context/AuthContext';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type FulfillmentMode = 'PICK_PACK_SHIP' | 'PICK_SHIP';

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

// A row from GET /organization/tax-rates. Settings manages a list of
// these (add / set default / remove) instead of a single Yes/No default —
// this same list populates the per-item tax picker on invoice/new.
type OrgTaxRate = {
  id: string;
  name: string;
  percentage: number;
  isDefault: boolean;
  archivedAt: string | null;
};

// A row from GET /organization/bank-accounts. Same list/default/archive
// shape as OrgTaxRate — whichever account is flagged isDefault is what
// prints on invoices; any number of accounts, any one (or none) default.
type OrgBankAccount = {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
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

  // Bank accounts — same list/default/archive CRUD, on
  // /organization/bank-accounts. Whichever account is isDefault prints
  // on invoices; the rest exist for staff/customers who need to know
  // where else they can transfer.
  const [bankAccounts, setBankAccounts] = useState<OrgBankAccount[] | null>(null);
  const [newBankName, setNewBankName] = useState('');
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [savingBankId, setSavingBankId] = useState<string | 'new' | null>(null);
  const [bankError, setBankError] = useState('');

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
          address: data.address ?? null,
          phone: data.phone ?? null,
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

    apiFetch('/organization/bank-accounts')
      .then((res) => res.json())
      .then((data: OrgBankAccount[]) => setBankAccounts(data.filter((b) => !b.archivedAt)))
      .catch(() => setError('Could not load bank accounts'));
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

  async function addBankAccount() {
    setBankError('');
    const bankName = newBankName.trim();
    const accountNumber = newAccountNumber.trim();
    const accountName = newAccountName.trim();

    if (!bankName || !accountNumber || !accountName) {
      setBankError('Fill in bank name, account number, and account holder name');
      return;
    }

    setSavingBankId('new');
    try {
      const res = await apiFetch('/organization/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankName, accountNumber, accountName }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setBankError(data?.message || 'Failed to add bank account');
        return;
      }
      setBankAccounts((prev) => [...(prev ?? []), data]);
      setNewBankName('');
      setNewAccountNumber('');
      setNewAccountName('');
    } finally {
      setSavingBankId(null);
    }
  }

  // Same both-directions behavior as setDefaultTaxRate: true promotes this
  // account (clearing the flag on every other account); false just unsets
  // this one, leaving the list with no default at all.
  async function setDefaultBankAccount(id: string, isDefault: boolean) {
    setBankError('');
    setSavingBankId(id);
    try {
      const res = await apiFetch(`/organization/bank-accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setBankError(data?.message || (isDefault ? 'Failed to set default' : 'Failed to unset default'));
        return;
      }
      setBankAccounts(
        (prev) =>
          prev?.map((b) => {
            if (b.id === id) return { ...b, isDefault };
            return isDefault ? { ...b, isDefault: false } : b;
          }) ?? prev,
      );
    } finally {
      setSavingBankId(null);
    }
  }

  async function archiveBankAccount(id: string) {
    setBankError('');
    setSavingBankId(id);
    try {
      const res = await apiFetch(`/organization/bank-accounts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setBankError(data?.message || 'Failed to remove bank account');
        return;
      }
      setBankAccounts((prev) => prev?.filter((b) => b.id !== id) ?? prev);
    } finally {
      setSavingBankId(null);
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
          address: businessForm.address || undefined,
          phone: businessForm.phone || undefined,
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
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
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
              <SettingsIcon size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Settings
              </h1>
              <p className="text-xs text-gray-500 truncate">Organization-wide warehouse settings</p>
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

        {(saved || businessSaved) && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} />
            Settings saved
          </div>
        )}

        {/* Business identity — for invoices. Shown whenever INVOICE_POS is purchased. */}
        {hasInvoicePos && business && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div>
              <h2 className="font-bold">Business Identity</h2>
              <p className="text-sm text-gray-600 mt-1">
                Shown on printed invoices — logo, legal name, NPWP, and address. Bank details for
                customers paying by transfer live in the Bank Accounts section below.
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
                    alt="Logo"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImageIcon size={20} className="text-blue-300" />
                )}
              </div>
              <label className="text-xs px-3 py-2 rounded-md border border-blue-500/20 text-blue-700 hover:bg-blue-50 cursor-pointer font-medium transition-colors">
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
                className="border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
              />
              <input
                value={businessForm.npwp ?? ''}
                onChange={(e) => setBusinessForm((f) => ({ ...f, npwp: e.target.value }))}
                placeholder="NPWP (optional)"
                className="border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
              />
              <input
                value={businessForm.address ?? ''}
                onChange={(e) => setBusinessForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Business address (optional)"
                className="border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all sm:col-span-2"
              />
              <input
                value={businessForm.phone ?? ''}
                onChange={(e) => setBusinessForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Business phone (optional)"
                className="border border-blue-500/20 rounded-lg p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
              />
            </div>
            <button
              type="button"
              onClick={saveBusinessDetails}
              disabled={savingBusiness}
              className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm disabled:bg-gray-300 transition-colors"
            >
              {savingBusiness ? 'Saving...' : 'Save business details'}
            </button>
          </section>
        )}

        {/* Bank Accounts — full list, not a single set of fields. Whichever
            account is marked "Default" here is what prints on invoices for
            customers paying by transfer; a rate can also have no default
            set at all — "Unset default" clears the flag without promoting
            anything else. Same shape as Tax Rates below. */}
        {hasInvoicePos && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Landmark size={16} strokeWidth={2} className="text-blue-700" />
              <h2 className="font-bold">Bank Accounts</h2>
            </div>
            <p className="text-sm text-gray-600 max-w-md">
              Add every account you accept transfers into. The one marked Default is what shows on
              printed invoices.
            </p>

            {bankError && <p className="text-xs text-red-700">{bankError}</p>}

            <div className="flex flex-col divide-y divide-blue-500/10">
              {bankAccounts?.map((account) => (
                <div key={account.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{account.bankName}</span>
                    <span className="text-sm text-gray-500 ml-2">{account.accountNumber}</span>
                    <span className="text-sm text-gray-500 ml-2">({account.accountName})</span>
                    {account.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 font-medium ml-2">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDefaultBankAccount(account.id, !account.isDefault)}
                      disabled={savingBankId === account.id}
                      className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-gray-600 hover:border-blue-500/50 hover:text-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {account.isDefault ? 'Unset default' : 'Set default'}
                    </button>
                    <button
                      type="button"
                      onClick={() => archiveBankAccount(account.id)}
                      disabled={savingBankId === account.id}
                      className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {bankAccounts?.length === 0 && (
                <p className="text-sm text-gray-400 py-2">No bank accounts yet.</p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <input
                value={newBankName}
                onChange={(e) => setNewBankName(e.target.value)}
                placeholder="Bank name"
                className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all flex-1 min-w-0"
              />
              <input
                value={newAccountNumber}
                onChange={(e) => setNewAccountNumber(e.target.value)}
                placeholder="Account number"
                className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all flex-1 min-w-0"
              />
              <input
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="Account holder name"
                className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all flex-1 min-w-0"
              />
              <button
                type="button"
                onClick={addBankAccount}
                disabled={savingBankId === 'new'}
                className="text-sm px-4 py-2.5 sm:py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm disabled:bg-gray-300 whitespace-nowrap transition-colors"
              >
                {savingBankId === 'new' ? 'Adding...' : 'Add account'}
              </button>
            </div>
          </section>
        )}

        {/* Tax rates — full list, not a single on/off default. Whichever
            rate is marked "Default" here is what pre-fills new invoice
            lines; staff can still pick a different rate (or several) per
            line item on invoice/new. A rate can also have no default set
            at all — "Unset default" clears the flag without promoting
            anything else. */}
        {hasInvoicePos && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Percent size={16} strokeWidth={2} className="text-blue-700" />
              <h2 className="font-bold">Tax Rates</h2>
            </div>
            <p className="text-sm text-gray-600 max-w-md">
              Add as many tax rates as you need (e.g. PPN 11%, a service charge, a local levy).
              Staff choose which of these apply per item when creating an invoice.
            </p>

            {taxError && <p className="text-xs text-red-700">{taxError}</p>}

            <div className="flex flex-col divide-y divide-blue-500/10">
              {taxRates?.map((rate) => (
                <div key={rate.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{rate.name}</span>
                    <span className="text-sm text-gray-500 ml-2">{rate.percentage}%</span>
                    {rate.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 font-medium ml-2">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDefaultTaxRate(rate.id, !rate.isDefault)}
                      disabled={savingTaxId === rate.id}
                      className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-gray-600 hover:border-blue-500/50 hover:text-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {rate.isDefault ? 'Unset default' : 'Set default'}
                    </button>
                    <button
                      type="button"
                      onClick={() => archiveTaxRate(rate.id)}
                      disabled={savingTaxId === rate.id}
                      className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-50 transition-colors"
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
                className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all flex-1 min-w-0"
              />
              <div className="relative">
                <input
                  value={newTaxPercentage}
                  onChange={(e) => setNewTaxPercentage(e.target.value)}
                  placeholder="11"
                  inputMode="decimal"
                  className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 pr-7 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all w-full sm:w-24"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                  %
                </span>
              </div>
              <button
                type="button"
                onClick={addTaxRate}
                disabled={savingTaxId === 'new'}
                className="text-sm px-4 py-2.5 sm:py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm disabled:bg-gray-300 transition-colors"
              >
                {savingTaxId === 'new' ? 'Adding...' : 'Add tax rate'}
              </button>
            </div>
          </section>
        )}

        {/* POS Pricing */}
        {hasInvoicePos && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Tag size={16} strokeWidth={2} className="text-blue-700" />
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
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
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
          <div className="text-sm text-gray-500 border border-dashed border-blue-500/25 rounded-xl p-5 text-center bg-white/60">
            No optional modules are active on this organization yet.
          </div>
        )}
      </div>
    </main>
  );
}