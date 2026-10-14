'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageCircle, Loader2, Wallet } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMYTime } from '@/lib/dates';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ComingSoon, ErrorNote, PageFrame, thCls, tdCls } from '@/app/components/shared/PageFrame';

type Overview = {
  balance: number;
  pricePerMessage: number;
  provider: 'meta' | 'log' | null;
  emailConfigured: boolean;
  gateway: 'xendit' | 'fake' | null;
  packages: { amount: number; credit: number }[];
  settings: { reminderEmailEnabled: boolean; reminderWhatsappEnabled: boolean };
  reminderStages: number[];
  ledger: { id: string; kind: 'TOPUP' | 'MESSAGE' | 'REFUND' | 'ADJUSTMENT'; amount: string; balanceAfter: string; note: string | null; createdAt: string }[];
  messages: {
    id: string;
    channel: 'EMAIL' | 'WHATSAPP';
    kind: string;
    recipient: string;
    status: 'SENT' | 'FAILED';
    error: string | null;
    cost: string;
    createdAt: string;
  }[];
  topups: { id: string; externalId: string; status: string; amount: string; checkoutUrl: string | null; createdAt: string }[];
};

export default function WhatsAppPage() {
  return (
    <Suspense fallback={null}>
      <WhatsAppPageInner />
    </Suspense>
  );
}

function WhatsAppPageInner() {
  const { authorized } = useRequireAdmin();
  const { t } = useLanguage();
  const search = useSearchParams();
  const returned = search.get('payment');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch('/messaging/whatsapp');
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.message ?? t('whatsapp.loadFailed'));
    else setData(body);
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (authorized) load();
  }, [authorized, load]);

  // Back from the payment page: wait briefly for the webhook to credit it.
  useEffect(() => {
    if (!authorized || !returned || search.get('failed')) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirming(true);
    (async () => {
      for (let i = 0; i < 15 && !cancelled; i++) {
        const res = await apiFetch(`/billing/payments/${encodeURIComponent(returned)}`).catch(() => null);
        const p = res?.ok ? await res.json() : null;
        if (p && p.status !== 'PENDING') break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) {
        setConfirming(false);
        load();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorized, returned, search, load]);

  async function topup(amount: number) {
    setBusy(amount);
    setError(null);
    const res = await apiFetch('/messaging/whatsapp/topup', { method: 'POST', body: JSON.stringify({ amount }) });
    const body = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok) {
      setError(body?.message ?? t('whatsapp.topupFailed'));
      return;
    }
    // The gateway's hosted page — a different origin, so not router.push.
    window.location.assign(body.checkoutUrl);
  }

  async function toggle(key: 'reminderEmailEnabled' | 'reminderWhatsappEnabled', value: boolean) {
    const res = await apiFetch('/messaging/settings', { method: 'PATCH', body: JSON.stringify({ [key]: value }) });
    if (res.ok) load();
  }

  if (!authorized) return null;

  // Top-ups and sending need both WhatsApp and online payment switched on.
  const live = !!data?.provider && !!data?.gateway;
  const messagesLeft = data ? Math.floor(data.balance / data.pricePerMessage) : 0;

  return (
    <PageFrame icon={MessageCircle} title={t('whatsapp.title')} subtitle={t('whatsapp.subtitle')}>
      <ErrorNote message={error} />
      {search.get('failed') && <ErrorNote message={t('billing.paymentFailed')} />}
      {confirming && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-md px-3 py-2">
          <Loader2 size={14} className="animate-spin" /> {t('billing.confirming')}
        </div>
      )}

      {data && (
        <>
          {!live && <ComingSoon text={t('whatsapp.comingSoon')} />}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-600 text-white">
                  <Wallet size={22} />
                </span>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">{t('whatsapp.balance')}</p>
                  <p className="text-3xl font-bold tabular-nums">{formatIDR(data.balance)}</p>
                  <p className="text-xs text-gray-500">
                    {t('whatsapp.messagesLeft', { n: messagesLeft, price: formatIDR(data.pricePerMessage) })}
                  </p>
                </div>
              </div>
              <div className="text-xs text-gray-500 space-y-0.5">
                {data.provider === 'log' && <p className="text-amber-700">{t('whatsapp.devProvider')}</p>}
                {!data.emailConfigured && <p className="text-amber-700">{t('whatsapp.emailNotConfigured')}</p>}
              </div>
            </div>
          </Card>

          <Card title={t('whatsapp.topupTitle')}>
            {live && data.gateway === 'fake' && <p className="text-xs text-amber-700 mb-3">{t('billing.fakeGateway')}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {data.packages.map((p) => (
                <button
                  key={p.amount}
                  onClick={() => topup(p.amount)}
                  disabled={!live || busy !== null}
                  className={`rounded-xl border-2 border-gray-200 p-3 text-left ${live ? 'hover:border-green-500 disabled:opacity-50' : 'cursor-default'}`}
                >
                  <p className="font-bold tabular-nums">{formatIDR(p.amount)}</p>
                  {p.credit > p.amount ? (
                    <p className="text-xs text-green-700 font-semibold">{t('whatsapp.bonus', { amount: formatIDR(p.credit - p.amount) })}</p>
                  ) : (
                    <p className="text-xs text-gray-500">&nbsp;</p>
                  )}
                  <p className="text-[11px] text-gray-500">≈ {Math.floor(p.credit / data.pricePerMessage)} {t('whatsapp.messages')}</p>
                  {busy === p.amount && <Loader2 size={14} className="animate-spin mt-1" />}
                </button>
              ))}
            </div>
          </Card>

          <Card title={t('whatsapp.remindersTitle')}>
            <p className="text-xs text-gray-500 mb-3">
              {t('whatsapp.remindersHint', {
                stages: data.reminderStages.map((s) => (s < 0 ? t('whatsapp.daysBefore', { n: -s }) : t('whatsapp.daysAfter', { n: s }))).join(', '),
              })}
            </p>
            <label className="flex items-center gap-2 text-sm mb-2">
              <input type="checkbox" checked={data.settings.reminderEmailEnabled} onChange={(e) => toggle('reminderEmailEnabled', e.target.checked)} />
              {t('whatsapp.remindByEmail')}
            </label>
            <label className={`flex items-center gap-2 text-sm ${live ? '' : 'text-gray-400'}`}>
              <input
                type="checkbox"
                disabled={!live}
                checked={live && data.settings.reminderWhatsappEnabled}
                onChange={(e) => toggle('reminderWhatsappEnabled', e.target.checked)}
              />
              {t('whatsapp.remindByWhatsapp')}
              {!live && <span className="text-xs">({t('messaging.comingSoon')})</span>}
            </label>
          </Card>

          <Card title={t('whatsapp.historyTitle')}>
            {data.ledger.length === 0 ? (
              <p className="text-sm text-gray-500">{t('whatsapp.noHistory')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thCls}>{t('common.date')}</th>
                      <th className={thCls}>{t('whatsapp.colType')}</th>
                      <th className={`${thCls} text-right`}>{t('common.amount')}</th>
                      <th className={`${thCls} text-right`}>{t('whatsapp.balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.map((e) => (
                      <tr key={e.id} className="border-t border-gray-100">
                        <td className={tdCls}>{formatDMYTime(new Date(e.createdAt))}</td>
                        <td className={tdCls}>
                          {t(`whatsapp.kind.${e.kind}`)}
                          {e.note && <span className="block text-xs text-gray-500">{e.note}</span>}
                        </td>
                        <td className={`${tdCls} text-right tabular-nums ${Number(e.amount) < 0 ? 'text-red-700' : 'text-green-700'}`}>
                          {Number(e.amount) > 0 ? '+' : ''}
                          {formatIDR(Number(e.amount))}
                        </td>
                        <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(Number(e.balanceAfter))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t('whatsapp.messagesTitle')}>
            {data.messages.length === 0 ? (
              <p className="text-sm text-gray-500">{t('whatsapp.noMessages')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thCls}>{t('common.date')}</th>
                      <th className={thCls}>{t('whatsapp.colChannel')}</th>
                      <th className={thCls}>{t('whatsapp.colWhat')}</th>
                      <th className={thCls}>{t('whatsapp.colTo')}</th>
                      <th className={thCls}>{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.messages.map((m) => (
                      <tr key={m.id} className="border-t border-gray-100">
                        <td className={tdCls}>{formatDMYTime(new Date(m.createdAt))}</td>
                        <td className={tdCls}>{m.channel === 'EMAIL' ? t('messaging.email') : t('messaging.whatsapp')}</td>
                        <td className={tdCls}>{t(`whatsapp.messageKind.${m.kind}`)}</td>
                        <td className={`${tdCls} break-all`}>{m.recipient}</td>
                        <td className={tdCls}>
                          <span className={m.status === 'SENT' ? 'text-green-700' : 'text-red-700'}>{t(`whatsapp.status.${m.status}`)}</span>
                          {m.error && <span className="block text-xs text-gray-500">{m.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="text-xs text-gray-500">{t('whatsapp.templatesNote')}</p>
        </>
      )}
    </PageFrame>
  );
}
