'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Landmark, Calendar, Check } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import DatePicker from '@/app/components/shared/DatePicker';
import { PageFrame, Card, btnPrimary, btnSecondary } from '@/app/components/shared/PageFrame';

// Entry point for a cash & bank statement, same shape as the customer
// statement's /sales/statement/new: pick what and when, then hand off to
// /accounting/cash-statement to render and print it.

type Account = {
  id: string;
  code: string;
  name: string;
  type: string;
  systemKey: string | null;
  bankAccountId: string | null;
  isActive: boolean;
};

// Same definition of "cash or bank" as the backend's CashStatementService.
const isCashOrBank = (a: Account) =>
  a.type === 'ASSET' && (a.systemKey === 'CASH' || a.systemKey === 'BANK' || !!a.bankAccountId);

const PRESETS = [
  { labelKey: 'accounting.cashStatement.presetThisMonth', from: () => { const d = new Date(); d.setDate(1); return d; } },
  { labelKey: 'accounting.cashStatement.presetLastMonth', from: () => { const d = new Date(); d.setMonth(d.getMonth() - 1, 1); return d; }, to: () => { const d = new Date(); d.setDate(0); return d; } },
  { labelKey: 'accounting.cashStatement.presetLast3Months', from: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d; } },
  { labelKey: 'accounting.cashStatement.presetThisYear', from: () => { const d = new Date(); d.setMonth(0, 1); return d; } },
];

function firstOfMonth() {
  const d = new Date();
  d.setDate(1);
  return toCalendarDateString(d);
}

export default function NewCashStatementPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(() => toCalendarDateString(new Date()));

  useEffect(() => {
    apiFetch('/accounting/accounts')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Account[]) => setAccounts(list.filter((a) => isCashOrBank(a) && a.isActive)))
      .catch(() => {});
  }, []);

  function generate() {
    const params = new URLSearchParams({ from, to });
    if (accountId) params.set('accountId', accountId);
    router.push(`/accounting/cash-statement?${params}`);
  }

  return (
    <PageFrame icon={Landmark} title={t('accounting.cashStatement.newTitle')} subtitle={t('accounting.cashStatement.newSubtitle')} width="max-w-2xl">
      <Card title={t('accounting.cashStatement.whichAccounts')}>
        <div className="flex flex-col gap-2">
          {[{ id: '', code: '', name: t('accounting.cashStatement.allAccounts') }, ...accounts].map((a) => (
            <button
              key={a.id || 'all'}
              type="button"
              onClick={() => setAccountId(a.id)}
              className={`flex items-center justify-between text-left border rounded-lg px-3 py-2 text-sm transition-colors ${
                accountId === a.id ? 'border-blue-500/50 bg-blue-50/60' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span>
                {a.code && <span className="text-gray-400 mr-2">{a.code}</span>}
                <span className="font-medium">{a.name}</span>
              </span>
              {accountId === a.id && <Check size={14} className="text-blue-700" />}
            </button>
          ))}
        </div>
      </Card>

      <Card title={t('accounting.cashStatement.period')}>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p.labelKey}
              type="button"
              onClick={() => {
                setFrom(toCalendarDateString(p.from()));
                setTo(toCalendarDateString(p.to ? p.to() : new Date()));
              }}
              className="text-xs px-2.5 py-1 rounded-md border border-blue-500/20 text-gray-700 hover:border-blue-500/50 hover:bg-blue-50"
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
              <Calendar size={12} />
              {t('accounting.cashStatement.from')}
            </label>
            <DatePicker value={from} onChange={setFrom} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">{t('accounting.cashStatement.to')}</label>
            <DatePicker value={to} onChange={setTo} />
          </div>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={() => router.back()}>
          {t('common.cancel')}
        </button>
        <button type="button" className={btnPrimary} disabled={!from || !to || from > to} onClick={generate}>
          {t('accounting.cashStatement.generate')}
        </button>
      </div>
    </PageFrame>
  );
}
