'use client';

import { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

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

// Bank Accounts — full list, not a single set of fields. Whichever
// account is marked "Default" here is what prints on invoices for
// customers paying by transfer; a rate can also have no default set at
// all — "Unset default" clears the flag without promoting anything else.
// Same shape as TaxRatesSection.
// Loads its own list on mount; a failed load is reported to the settings
// page through onLoadError.
export default function BankAccountsSection({ onLoadError }: { onLoadError: (message: string) => void }) {
  const { t } = useLanguage();

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

  useEffect(() => {
    apiFetch('/organization/bank-accounts')
      .then((res) => res.json())
      .then((data: OrgBankAccount[]) => setBankAccounts(data.filter((b) => !b.archivedAt)))
      .catch(() => onLoadError(t('settings.couldNotLoadBankAccounts')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addBankAccount() {
    setBankError('');
    const bankName = newBankName.trim();
    const accountNumber = newAccountNumber.trim();
    const accountName = newAccountName.trim();

    if (!bankName || !accountNumber || !accountName) {
      setBankError(t('settings.bankAccounts.fillRequiredFields'));
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
        setBankError(data?.message || t('settings.bankAccounts.addFailed'));
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
        setBankError(data?.message || (isDefault ? t('settings.bankAccounts.setDefaultFailed') : t('settings.bankAccounts.unsetDefaultFailed')));
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
        setBankError(data?.message || t('settings.bankAccounts.removeFailed'));
        return;
      }
      setBankAccounts((prev) => prev?.filter((b) => b.id !== id) ?? prev);
    } finally {
      setSavingBankId(null);
    }
  }

  return (
    <section id="bank-accounts" className="scroll-mt-24 border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Landmark size={16} strokeWidth={2} className="text-blue-700" />
        <h2 className="font-bold">{t('settings.bankAccounts.heading')}</h2>
      </div>
      <p className="text-sm text-gray-600 max-w-md">
        {t('settings.bankAccounts.description')}
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
                  {t('settings.default')}
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
                {account.isDefault ? t('settings.unsetDefault') : t('settings.setDefault')}
              </button>
              <button
                type="button"
                onClick={() => archiveBankAccount(account.id)}
                disabled={savingBankId === account.id}
                className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {t('common.remove')}
              </button>
            </div>
          </div>
        ))}
        {bankAccounts?.length === 0 && (
          <p className="text-sm text-gray-400 py-2">{t('settings.bankAccounts.noneYet')}</p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
        <input
          value={newBankName}
          onChange={(e) => setNewBankName(e.target.value)}
          placeholder={t('settings.bankAccounts.bankNamePlaceholder')}
          className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all flex-1 min-w-0"
        />
        <input
          value={newAccountNumber}
          onChange={(e) => setNewAccountNumber(e.target.value)}
          placeholder={t('settings.bankAccounts.accountNumberPlaceholder')}
          className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all flex-1 min-w-0"
        />
        <input
          value={newAccountName}
          onChange={(e) => setNewAccountName(e.target.value)}
          placeholder={t('settings.bankAccounts.accountHolderPlaceholder')}
          className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all flex-1 min-w-0"
        />
        <button
          type="button"
          onClick={addBankAccount}
          disabled={savingBankId === 'new'}
          className="text-sm px-4 py-2.5 sm:py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm disabled:bg-gray-300 whitespace-nowrap transition-colors"
        >
          {savingBankId === 'new' ? t('settings.bankAccounts.adding') : t('settings.bankAccounts.addButton')}
        </button>
      </div>
    </section>
  );
}
