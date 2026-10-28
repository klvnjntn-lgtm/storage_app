'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Award, RotateCcw } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY, toCalendarDateString } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { getInitialParam, useSyncQueryParams } from '@/lib/useQuerySync';
import DatePicker from '@/app/components/shared/DatePicker';
import { BranchFilter } from '@/app/components/shared/BranchFilter';
import { PageFrame, Card, ErrorNote, thCls, tdCls } from '@/app/components/shared/PageFrame';

type Salesperson = {
  employeeId: string | null;
  name: string | null;
  invoices: number;
  parts: number;
  services: number;
  total: number;
  average: number;
};
type Mechanic = {
  employeeId: string | null;
  name: string | null;
  jobs: number;
  invoicedJobs: number;
  parts: number;
  services: number;
  total: number;
  timedJobs: number;
  avgHours: number | null;
  medianHours: number | null;
  comebacks: number;
  comebackRate: number | null;
};
type Comeback = {
  id: string;
  number: string;
  reason: string | null;
  createdAt: string;
  plate: string;
  original: { id: string; number: string; completedAt: string | null; mechanic: string | null } | null;
};
type Report = { salespeople: Salesperson[]; mechanics: Mechanic[] | null; comebacks: Comeback[] };

function monthStart() {
  const d = new Date();
  return toCalendarDateString(new Date(d.getFullYear(), d.getMonth(), 1));
}

// Hours as "2j 30m" / "2h 30m" — jobs run from minutes to days.
function duration(hours: number | null, t: (k: string, v?: Record<string, string | number>) => string) {
  if (hours == null) return '—';
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h >= 24) return t('sales.performance.days', { days: (hours / 24).toFixed(1) });
  return t('sales.performance.hoursMinutes', { h, m });
}

// Who sold and who fixed what in a period — the numbers a boss pays commission on (through payroll).
export default function PerformancePage() {
  const { t } = useLanguage();
  const { authorized } = useRequireAdmin();
  const [from, setFrom] = useState<string>(() => getInitialParam('from', monthStart()));
  const [to, setTo] = useState<string>(() => getInitialParam('to', toCalendarDateString(new Date())));
  const [branchId, setBranchId] = useState<string>(() => getInitialParam('branchId', ''));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useSyncQueryParams({ from, to, branchId: branchId || null });

  useEffect(() => {
    if (!authorized || !from || !to) return;
    let cancelled = false;
    const params = new URLSearchParams({ from, to });
    if (branchId) params.set('branchId', branchId);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/reports/performance?${params}`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.message ?? t('sales.performance.loadFailed'));
          return;
        }
        setReport(body);
      } catch {
        if (!cancelled) setError(t('sales.performance.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorized, from, to, branchId, t]);

  if (!authorized) return <p className="text-sm text-gray-500 p-6">{t('common.loading')}</p>;
  const unassigned = t('sales.performance.unassigned');

  return (
    <PageFrame icon={Award} title={t('sales.performance.title')} subtitle={t('sales.performance.subtitle')}>
      <div className="flex flex-col sm:flex-row sm:items-end gap-2">
        <div className="sm:w-44">
          <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">{t('sales.performance.from')}</p>
          <DatePicker value={from} onChange={setFrom} max={to} />
        </div>
        <div className="sm:w-44">
          <p className="text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1.5">{t('sales.performance.to')}</p>
          <DatePicker value={to} onChange={setTo} min={from} />
        </div>
        <BranchFilter value={branchId} onChange={setBranchId} />
      </div>
      <ErrorNote message={error} />
      {loading && !report && <p className="text-sm text-gray-500">{t('common.loading')}</p>}

      {report && (
        <>
          <Card title={t('sales.performance.salespeople')}>
            <p className="text-xs text-gray-500 mb-2">{t('sales.performance.salespeopleHint')}</p>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className={thCls}>{t('sales.performance.name')}</th>
                    <th className={`${thCls} text-right`}>{t('sales.performance.invoices')}</th>
                    <th className={`${thCls} text-right`}>{t('sales.performance.parts')}</th>
                    <th className={`${thCls} text-right`}>{t('sales.performance.services')}</th>
                    <th className={`${thCls} text-right`}>{t('sales.performance.total')}</th>
                    <th className={`${thCls} text-right`}>{t('sales.performance.average')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.salespeople.map((s) => (
                    <tr key={s.employeeId ?? 'none'} className="border-b border-gray-100">
                      <td className={`${tdCls} font-medium ${s.employeeId ? '' : 'text-gray-400 italic'}`}>
                        {s.employeeId ? (
                          <Link
                            href={`/sales/invoices?${new URLSearchParams({ employeeId: s.employeeId, from, to, status: 'ISSUED' })}`}
                            className="hover:underline"
                          >
                            {s.name}
                          </Link>
                        ) : (
                          unassigned
                        )}
                      </td>
                      <td className={`${tdCls} text-right tabular-nums`}>{s.invoices}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(s.parts)}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(s.services)}</td>
                      <td className={`${tdCls} text-right tabular-nums font-semibold`}>{formatIDR(s.total)}</td>
                      <td className={`${tdCls} text-right tabular-nums text-gray-500`}>{formatIDR(s.average)}</td>
                    </tr>
                  ))}
                  {report.salespeople.length === 0 && (
                    <tr>
                      <td colSpan={6} className={`${tdCls} text-center text-gray-400`}>{t('sales.performance.empty')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {report.mechanics && (
            <Card title={t('sales.performance.mechanics')}>
              <p className="text-xs text-gray-500 mb-2">{t('sales.performance.mechanicsHint')}</p>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className={thCls}>{t('sales.performance.name')}</th>
                      <th className={`${thCls} text-right`}>{t('sales.performance.jobs')}</th>
                      <th className={`${thCls} text-right`}>{t('sales.performance.services')}</th>
                      <th className={`${thCls} text-right`}>{t('sales.performance.parts')}</th>
                      <th className={`${thCls} text-right`}>{t('sales.performance.avgTime')}</th>
                      <th className={`${thCls} text-right`}>{t('sales.performance.medianTime')}</th>
                      <th className={`${thCls} text-right`}>{t('sales.performance.comebacks')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.mechanics.map((m) => (
                      <tr key={m.employeeId ?? 'none'} className="border-b border-gray-100">
                        <td className={`${tdCls} font-medium ${m.employeeId ? '' : 'text-gray-400 italic'}`}>{m.name ?? unassigned}</td>
                        <td className={`${tdCls} text-right tabular-nums`}>
                          {m.jobs}
                          {m.invoicedJobs < m.jobs && (
                            <span className="block text-[11px] text-amber-700">
                              {t('sales.performance.notInvoiced', { count: m.jobs - m.invoicedJobs })}
                            </span>
                          )}
                        </td>
                        <td className={`${tdCls} text-right tabular-nums font-semibold`}>{formatIDR(m.services)}</td>
                        <td className={`${tdCls} text-right tabular-nums`}>{formatIDR(m.parts)}</td>
                        <td className={`${tdCls} text-right tabular-nums`} title={t('sales.performance.timedHint', { count: m.timedJobs })}>
                          {duration(m.avgHours, t)}
                        </td>
                        <td className={`${tdCls} text-right tabular-nums text-gray-500`}>{duration(m.medianHours, t)}</td>
                        <td className={`${tdCls} text-right tabular-nums ${m.comebacks ? 'text-red-700 font-semibold' : 'text-gray-400'}`}>
                          {m.comebacks}
                          {m.comebackRate != null && m.comebacks > 0 && <span className="font-normal"> ({m.comebackRate}%)</span>}
                        </td>
                      </tr>
                    ))}
                    {report.mechanics.length === 0 && (
                      <tr>
                        <td colSpan={7} className={`${tdCls} text-center text-gray-400`}>{t('sales.performance.noJobs')}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {report.mechanics && report.comebacks.length > 0 && (
            <Card title={t('sales.performance.comebackList')}>
              <ul className="divide-y divide-gray-100">
                {report.comebacks.map((c) => (
                  <li key={c.id} className="py-2 flex items-start gap-2 text-sm">
                    <RotateCcw size={14} className="text-red-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <Link href={`/workshop/work-orders/${c.id}`} className="font-semibold hover:underline">
                        {c.number}
                      </Link>{' '}
                      <span className="text-gray-500">
                        · {c.plate} · {formatDMY(new Date(c.createdAt))}
                      </span>
                      {c.original && (
                        <p className="text-xs text-gray-600">
                          {t('sales.performance.comebackOf')}{' '}
                          <Link href={`/workshop/work-orders/${c.original.id}`} className="hover:underline">
                            {c.original.number}
                          </Link>
                          {c.original.mechanic ? ` · ${c.original.mechanic}` : ''}
                        </p>
                      )}
                      {c.reason && <p className="text-xs text-gray-500 italic">{c.reason}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </PageFrame>
  );
}
