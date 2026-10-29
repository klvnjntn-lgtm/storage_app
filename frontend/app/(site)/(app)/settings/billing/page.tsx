'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, CreditCard, Loader2, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useWarehouseOps } from '@/lib/hooks/useWarehouseOps';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ComingSoon, ErrorNote, PageFrame, UsageBar, btnPrimary, thCls, tdCls } from '@/app/components/shared/PageFrame';

type Limits = { seats: number | null; locations: number | null; products: number | null; invoicesPerMonth: number | null };
type Resource = keyof Limits;
type Period = 'MONTH' | 'YEAR';
type ModuleKey = 'INVOICE_POS' | 'WAREHOUSE_OPS' | 'WORKSHOP_RMS' | 'DELIVERY_DMS' | 'ACCOUNTING';

type ModuleRow = {
  module: ModuleKey;
  monthly: number;
  yearly: number;
  requires?: ModuleKey;
  active: boolean;
  // Active because it's paid for (or granted for good), not just trial.
  paid: boolean;
  paidUntil: string | null;
  expiresAt: string | null;
};

type Payment = {
  id: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  amount: string;
  modules: ModuleKey[];
  period: Period | null;
  checkoutUrl: string | null;
  createdAt: string;
};

type Overview = {
  plan: string;
  effectivePlan: string;
  trialEndsAt: string | null;
  limits: Limits;
  usage: Record<Resource, number>;
  gateway: 'xendit' | 'fake' | null;
  modules: ModuleRow[];
  payments: Payment[];
};

const RESOURCES: Resource[] = ['seats', 'locations', 'products', 'invoicesPerMonth'];

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingPageInner />
    </Suspense>
  );
}

function BillingPageInner() {
  const { authorized, loading: authLoading } = useRequireAdmin(['MASTER']);
  const { t } = useLanguage();
  // The locations allowance only matters to warehouse orgs; everyone else
  // has just their hidden CENTRE.
  const warehouseOps = useWarehouseOps();
  const search = useSearchParams();
  const returnedPayment = search.get('payment');

  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('YEAR');
  const [selected, setSelected] = useState<ModuleKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/billing');
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('billing.loadFailed'));
        return;
      }
      setData(body);
    } catch {
      setError(t('billing.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (authorized) load();
  }, [authorized, load]);

  // Back from the gateway: the webhook may land a few seconds after the
  // redirect, so poll the payment briefly before reloading.
  useEffect(() => {
    if (!authorized || !returnedPayment || search.get('failed')) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWaiting(true);
    (async () => {
      for (let i = 0; i < 15 && !cancelled; i++) {
        const res = await apiFetch(`/billing/payments/${encodeURIComponent(returnedPayment)}`).catch(() => null);
        const p: Payment | null = res?.ok ? await res.json() : null;
        if (p && p.status !== 'PENDING') break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) {
        setWaiting(false);
        await load();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorized, returnedPayment, search, load]);

  const priceOf = (m: ModuleRow) => (period === 'YEAR' ? m.yearly : m.monthly);
  const total = useMemo(
    () => (data?.modules ?? []).filter((m) => selected.includes(m.module)).reduce((s, m) => s + priceOf(m), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, selected, period],
  );

  // Workshop needs a paid Invoice & POS: picking it adds POS unless POS is
  // already paid for (a trial doesn't count); dropping POS drops Workshop.
  function toggle(row: ModuleRow) {
    setSelected((cur) => {
      if (cur.includes(row.module)) {
        const dependants = (data?.modules ?? []).filter((m) => m.requires === row.module && !isPaid(m.requires!)).map((m) => m.module);
        return cur.filter((m) => m !== row.module && !dependants.includes(m));
      }
      const next = [...cur, row.module];
      if (row.requires && !isPaid(row.requires) && !next.includes(row.requires)) next.push(row.requires);
      return next;
    });
  }

  function isPaid(module: ModuleKey) {
    return !!data?.modules.find((m) => m.module === module)?.paid;
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/billing/checkout', { method: 'POST', body: JSON.stringify({ modules: selected, period }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('billing.checkoutFailed'));
        return;
      }
      // The gateway's hosted page — a different origin, so not router.push.
      window.location.assign(body.checkoutUrl);
    } catch {
      setError(t('billing.checkoutFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || !authorized) return <p className="text-sm text-gray-500 p-6">{t('common.loading')}</p>;

  const fmtDate = (d: string | null) => (d ? formatDMY(new Date(d)) : '—');
  const custom = data?.plan === 'custom';
  const limited = data && (data.effectivePlan === 'trial' || data.effectivePlan === 'free');

  return (
    <PageFrame icon={CreditCard} title={t('billing.title')} subtitle={t('billing.subtitle')}>
      <ErrorNote message={error} />
      {search.get('failed') && <ErrorNote message={t('billing.paymentFailed')} />}
      {waiting && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-md px-3 py-2">
          <Loader2 size={14} className="animate-spin" /> {t('billing.confirming')}
        </div>
      )}

      {data && (
        <>
          <Card title={t('billing.currentPlan')}>
            <p className="text-2xl font-bold">{t(`billing.plan.${data.effectivePlan}`)}</p>
            {data.effectivePlan === 'trial' && data.trialEndsAt && (
              <p className="text-sm text-gray-600">{t('billing.trialEnds', { date: fmtDate(data.trialEndsAt) })}</p>
            )}
            {data.effectivePlan === 'free' && <p className="mt-1 text-sm text-red-700">{t('billing.trialOver')}</p>}
            {custom && <p className="mt-2 text-sm text-gray-600">{t('billing.customNote')}</p>}

            {limited && (
              <div className="mt-4 grid sm:grid-cols-2 gap-4">
                {RESOURCES.filter((r) => r !== 'locations' || warehouseOps).map((r) => (
                  <div key={r}>
                    <div className="flex justify-between text-sm">
                      <span>{t(`billing.resource.${r}`)}</span>
                      <span className="tabular-nums text-gray-600">
                        {data.usage[r]} / {data.limits[r] ?? t('billing.unlimited')}
                      </span>
                    </div>
                    <div className="mt-1">
                      <UsageBar used={data.usage[r]} limit={data.limits[r]} />
                    </div>
                  </div>
                ))}
                <p className="sm:col-span-2 text-xs text-gray-500">{t('billing.limitsGoAway')}</p>
              </div>
            )}
          </Card>

          {!custom && (
            <Card
              title={t('billing.modulesTitle')}
              actions={
                <div className="flex rounded-md border border-gray-300 overflow-hidden text-sm">
                  {(['MONTH', 'YEAR'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-3 py-1.5 ${period === p ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50'}`}
                    >
                      {t(`billing.period.${p}`)}
                    </button>
                  ))}
                </div>
              }
            >
              {!data.gateway && <ComingSoon text={t('billing.comingSoon')} />}
              {data.gateway === 'fake' && <p className="text-xs text-amber-700 mb-3">{t('billing.fakeGateway')}</p>}
              <div className="grid sm:grid-cols-2 gap-3">
                {data.modules.map((m) => {
                  // Without online payment the cards are a price list only.
                  const on = !!data.gateway && selected.includes(m.module);
                  return (
                    <label
                      key={m.module}
                      className={`rounded-xl border-2 p-4 flex gap-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500/40 ${data.gateway ? 'cursor-pointer' : ''} ${on ? 'border-blue-500 bg-blue-50/40' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      {data.gateway && (
                        <>
                          <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(m)} />
                          <span
                            aria-hidden
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                              on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'
                            }`}
                          >
                            {on && <Check size={12} strokeWidth={3} />}
                          </span>
                        </>
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{t(`billing.module.${m.module}`)}</span>
                          {m.active && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700">
                              <CheckCircle2 size={12} /> {m.paidUntil ? t('billing.paidUntil', { date: fmtDate(m.paidUntil) }) : t('billing.activeTrial')}
                            </span>
                          )}
                        </span>
                        <span className="block mt-1 text-lg font-bold tabular-nums">
                          {formatIDR(priceOf(m))}
                          <span className="text-xs font-normal text-gray-500"> / {t(`billing.per.${period}`)}</span>
                        </span>
                        {period === 'YEAR' && (
                          <span className="block text-xs text-green-700">{t('billing.yearSaving', { amount: formatIDR(m.monthly * 12 - m.yearly) })}</span>
                        )}
                        <span className="block text-xs text-gray-500 mt-1">{t(`billing.moduleDescription.${m.module}`)}</span>
                        {m.requires && <span className="block text-xs text-gray-500">{t('billing.requires', { module: t(`billing.module.${m.requires}`) })}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>

              {data.gateway && (
                <>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                    <p className="text-sm">
                      {t('billing.total')}: <span className="text-xl font-bold tabular-nums">{formatIDR(total)}</span>
                      <span className="text-gray-500"> / {t(`billing.per.${period}`)}</span>
                    </p>
                    <button className={btnPrimary} disabled={busy || selected.length === 0} onClick={checkout}>
                      {busy && <Loader2 size={14} className="animate-spin" />}
                      {t('billing.pay')}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{t('billing.renewHint')}</p>
                </>
              )}
            </Card>
          )}

          {data.payments.length > 0 && (
            <Card title={t('billing.history')}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thCls}>{t('common.date')}</th>
                      <th className={thCls}>{t('billing.colModules')}</th>
                      <th className={thCls}>{t('common.amount')}</th>
                      <th className={thCls}>{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id} className="border-t border-gray-100">
                        <td className={tdCls}>{fmtDate(p.createdAt)}</td>
                        <td className={tdCls}>
                          {p.modules.map((m) => t(`billing.module.${m}`)).join(', ')}
                          {p.period && ` · ${t(`billing.period.${p.period}`)}`}
                        </td>
                        <td className={`${tdCls} tabular-nums`}>{formatIDR(Number(p.amount))}</td>
                        <td className={tdCls}>
                          {p.status === 'PENDING' && p.checkoutUrl && data.gateway ? (
                            <a href={p.checkoutUrl} className="text-blue-700 underline">
                              {t('billing.status.PENDING')}
                            </a>
                          ) : (
                            t(`billing.status.${p.status}`)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </PageFrame>
  );
}
