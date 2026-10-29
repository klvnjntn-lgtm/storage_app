'use client';

import { useEffect, useState } from 'react';
import { Landmark, Pencil } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useBranches } from '@/lib/hooks/useBranches';

// A row from GET /organization/bank-accounts. Same list/default/archive
// shape: whichever account is flagged isDefault is what
// prints on invoices; any number of accounts, any one (or none) default.
type OrgBankAccount = {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  isDefault: boolean;
  archivedAt: string | null;
  // Null = shared by every branch.
  branchId: string | null;
};

type Draft = { bankName: string; accountNumber: string; accountName: string };
const EMPTY: Draft = { bankName: '', accountNumber: '', accountName: '' };

// The business's bank accounts, in the Chart of Accounts (MASTER only):
// each one is also its ledger account under 1010 Bank, which the backend
// renames, archives and restores along with it. The one marked "Default"
// is what prints on invoices for customers paying by transfer; "Unset
// default" clears the flag without promoting anything else. onChanged
// lets the chart reload, since its bank rows follow these. Without the
// Accounting module it's shown in Settings instead (inChart false), where
// there's no chart to point at.
export default function BankAccountsSection({
  onLoadError,
  onChanged,
  inChart = true,
}: {
  onLoadError: (message: string) => void;
  onChanged?: () => void;
  inChart?: boolean;
}) {
  const { t } = useLanguage();
  const { branches, multiBranch } = useBranches();
  const [newBranchId, setNewBranchId] = useState('');

  const [bankAccounts, setBankAccounts] = useState<OrgBankAccount[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [savingBankId, setSavingBankId] = useState<string | 'new' | null>(null);
  const [bankError, setBankError] = useState('');

  const fetchList = () =>
    apiFetch('/organization/bank-accounts?includeArchived=true').then((res) =>
      res.ok ? (res.json() as Promise<OrgBankAccount[]>) : Promise.reject(new Error(String(res.status))),
    );
  const load = () => fetchList().then(setBankAccounts);

  useEffect(() => {
    fetchList()
      .then(setBankAccounts)
      .catch(() => onLoadError(t('settings.couldNotLoadBankAccounts')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every write goes through here: on success the list (and the chart) reload,
  // since a change can also move the default or the ledger account.
  async function call(id: string | 'new', path: string, method: string, failed: string, body?: object) {
    setBankError('');
    setSavingBankId(id);
    try {
      const res = await apiFetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body && { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setBankError(data?.message || failed);
        return false;
      }
      await load().catch(() => {});
      onChanged?.();
      return true;
    } finally {
      setSavingBankId(null);
    }
  }

  const trimmed = (d: Draft): Draft => ({
    bankName: d.bankName.trim(),
    accountNumber: d.accountNumber.trim(),
    accountName: d.accountName.trim(),
  });
  const complete = (d: Draft) => !!(d.bankName && d.accountNumber && d.accountName);

  async function addBankAccount() {
    const fields = trimmed(draft);
    if (!complete(fields)) {
      setBankError(t('settings.bankAccounts.fillRequiredFields'));
      return;
    }
    const ok = await call('new', '/organization/bank-accounts', 'POST', t('settings.bankAccounts.addFailed'), {
      ...fields,
      ...(newBranchId && { branchId: newBranchId }),
    });
    if (ok) setDraft(EMPTY);
  }

  async function saveEdit(id: string) {
    const fields = trimmed(editDraft);
    if (!complete(fields)) {
      setBankError(t('settings.bankAccounts.fillRequiredFields'));
      return;
    }
    if (await call(id, `/organization/bank-accounts/${id}`, 'PATCH', t('settings.bankAccounts.saveFailed'), fields))
      setEditingId(null);
  }

  const active = bankAccounts?.filter((b) => !b.archivedAt) ?? null;
  const archived = bankAccounts?.filter((b) => b.archivedAt) ?? [];
  const inputCls =
    'border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all flex-1 min-w-0';
  const smallBtn =
    'text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-gray-600 hover:border-blue-500/50 hover:text-blue-700 disabled:opacity-50 transition-colors';
  const fields = (d: Draft, set: (d: Draft) => void) => (
    <>
      <input
        value={d.bankName}
        onChange={(e) => set({ ...d, bankName: e.target.value })}
        placeholder={t('settings.bankAccounts.bankNamePlaceholder')}
        className={inputCls}
      />
      <input
        value={d.accountNumber}
        onChange={(e) => set({ ...d, accountNumber: e.target.value })}
        placeholder={t('settings.bankAccounts.accountNumberPlaceholder')}
        className={inputCls}
      />
      <input
        value={d.accountName}
        onChange={(e) => set({ ...d, accountName: e.target.value })}
        placeholder={t('settings.bankAccounts.accountHolderPlaceholder')}
        className={inputCls}
      />
    </>
  );

  return (
    <section id="bank-accounts" className="scroll-mt-24 border-2 border-gray-300 rounded-md bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Landmark size={16} strokeWidth={2} className="text-blue-700" />
        <h2 className="font-bold">{t('settings.bankAccounts.heading')}</h2>
      </div>
      <p className="text-sm text-gray-600 max-w-xl">{t(inChart ? 'settings.bankAccounts.description' : 'settings.bankAccounts.descriptionNoChart')}</p>

      {bankError && <p className="text-xs text-red-700">{bankError}</p>}

      <div className="flex flex-col divide-y divide-blue-500/10">
        {active?.map((account) =>
          editingId === account.id ? (
            <div key={account.id} className="flex flex-col sm:flex-row gap-2.5 py-2.5">
              {fields(editDraft, setEditDraft)}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => saveEdit(account.id)}
                  disabled={savingBankId === account.id}
                  className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {t('common.save')}
                </button>
                <button type="button" onClick={() => setEditingId(null)} className={smallBtn}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
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
              <div className="flex flex-wrap items-center gap-2">
                {multiBranch && (
                  <select
                    aria-label={t('settings.bankAccounts.branchLabel')}
                    value={account.branchId ?? ''}
                    disabled={savingBankId === account.id}
                    onChange={(e) =>
                      call(account.id, `/organization/bank-accounts/${account.id}`, 'PATCH', t('settings.bankAccounts.branchChangeFailed'), {
                        branchId: e.target.value || null,
                      })
                    }
                    className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-gray-600 bg-white disabled:opacity-50"
                  >
                    <option value="">{t('settings.bankAccounts.sharedBranches')}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() =>
                    call(
                      account.id,
                      `/organization/bank-accounts/${account.id}`,
                      'PATCH',
                      account.isDefault ? t('settings.bankAccounts.unsetDefaultFailed') : t('settings.bankAccounts.setDefaultFailed'),
                      { isDefault: !account.isDefault },
                    )
                  }
                  disabled={savingBankId === account.id}
                  className={smallBtn}
                >
                  {account.isDefault ? t('settings.unsetDefault') : t('settings.setDefault')}
                </button>
                <button
                  type="button"
                  aria-label={t('common.edit')}
                  title={t('common.edit')}
                  onClick={() => {
                    setEditingId(account.id);
                    setEditDraft({ bankName: account.bankName, accountNumber: account.accountNumber, accountName: account.accountName });
                  }}
                  className={smallBtn}
                >
                  <Pencil size={12} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    call(account.id, `/organization/bank-accounts/${account.id}`, 'DELETE', t('settings.bankAccounts.removeFailed'))
                  }
                  disabled={savingBankId === account.id}
                  className="text-xs px-2 py-1.5 sm:py-1 rounded-md border border-blue-500/20 text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {t('accounting.setup.archive')}
                </button>
              </div>
            </div>
          ),
        )}
        {active?.length === 0 && <p className="text-sm text-gray-400 py-2">{t('settings.bankAccounts.noneYet')}</p>}
      </div>

      <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
        {fields(draft, setDraft)}
        {multiBranch && (
          <select
            aria-label={t('settings.bankAccounts.branchLabel')}
            value={newBranchId}
            onChange={(e) => setNewBranchId(e.target.value)}
            className="border border-blue-500/20 rounded-lg p-2.5 sm:p-2 text-sm bg-white outline-none focus:border-blue-500/50"
          >
            <option value="">{t('settings.bankAccounts.sharedBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={addBankAccount}
          disabled={savingBankId === 'new'}
          className="text-sm px-4 py-2.5 sm:py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm disabled:bg-gray-300 whitespace-nowrap transition-colors"
        >
          {savingBankId === 'new' ? t('settings.bankAccounts.adding') : t('settings.bankAccounts.addButton')}
        </button>
      </div>

      {/* Archived: off documents and its ledger account inactive; restoring brings both back. */}
      {archived.length > 0 && (
        <div className="pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
            {t('settings.bankAccounts.archivedTitle')}
          </p>
          {archived.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-sm text-gray-400 truncate">
                {account.bankName} {account.accountNumber} ({account.accountName})
              </span>
              <button
                type="button"
                onClick={() =>
                  call(account.id, `/organization/bank-accounts/${account.id}/restore`, 'POST', t('settings.bankAccounts.restoreFailed'))
                }
                disabled={savingBankId === account.id}
                className={smallBtn}
              >
                {t('accounting.setup.reactivate')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
