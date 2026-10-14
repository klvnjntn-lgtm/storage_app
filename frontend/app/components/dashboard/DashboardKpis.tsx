'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRightLeft, CalendarClock, ClipboardList, PackageSearch, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR, formatIDRCompact } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';

type Summary = {
  operations: {
    lowStock: number | null;
    expiringBatches: number | null;
    pendingApprovals: number;
    transfersInTransit: number;
    draftPurchaseOrders: number | null;
  };
  finance: {
    salesToday: { total: number; count: number };
    salesMonth: { total: number; count: number };
    salesSeries: { date: string; total: number }[];
    overdueReceivables: { total: number; count: number };
    payables: { total: number; overdue: number };
    waBalance: number;
  } | null;
};

// The home page's numbers (backend DashboardService). Money only reaches
// admins; everyone sees the operational counts that need someone's action.
export function DashboardKpis() {
  const { t } = useLanguage();
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/dashboard/summary');
        if (res.ok) setData(await res.json());
      } catch {
        // optional on the home page
      }
    })();
  }, []);

  if (!data) return null;
  const f = data.finance;
  const o = data.operations;

  const actions = [
    { n: o.lowStock, label: t('dashboard.lowStock'), href: '/purchasing/reorder', icon: PackageSearch },
    { n: o.expiringBatches, label: t('dashboard.expiringBatches'), href: '/inventory/batches', icon: CalendarClock },
    { n: o.pendingApprovals, label: t('dashboard.pendingApprovals'), href: '/approvals', icon: ShieldCheck },
    { n: o.transfersInTransit, label: t('dashboard.transfersInTransit'), href: '/inventory/transfers', icon: ArrowRightLeft },
    { n: o.draftPurchaseOrders, label: t('dashboard.draftPos'), href: '/purchasing/purchase-orders', icon: ClipboardList },
  ].filter((a): a is typeof a & { n: number } => a.n !== null);

  return (
    <div className="space-y-3">
      {f && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label={t('dashboard.salesToday')} value={formatIDR(f.salesToday.total)} sub={t('dashboard.invoices', { n: f.salesToday.count })} />
          <Tile label={t('dashboard.salesMonth')} value={formatIDR(f.salesMonth.total)} sub={t('dashboard.invoices', { n: f.salesMonth.count })} />
          <Tile
            label={t('dashboard.overdueReceivables')}
            value={formatIDR(f.overdueReceivables.total)}
            sub={t('dashboard.invoices', { n: f.overdueReceivables.count })}
            href="/accounting/ar-aging"
            alert={f.overdueReceivables.total > 0}
          />
          <Tile
            label={t('dashboard.payables')}
            value={formatIDR(f.payables.total)}
            sub={f.payables.overdue > 0 ? t('dashboard.payablesOverdue', { amount: formatIDRCompact(f.payables.overdue) }) : t('dashboard.nothingOverdue')}
            href="/accounting/ap-aging"
            alert={f.payables.overdue > 0}
          />
        </div>
      )}

      {f && <SalesChart series={f.salesSeries} />}

      {actions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 bg-white hover:border-blue-400 ${
                a.n > 0 ? 'border-amber-300' : 'border-blue-500/15'
              }`}
            >
              <a.icon size={16} className={a.n > 0 ? 'text-amber-700' : 'text-gray-400'} />
              <span className="min-w-0">
                <span className="block text-lg font-bold tabular-nums leading-tight">{a.n}</span>
                <span className="block text-xs text-gray-500 truncate">{a.label}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, href, alert }: { label: string; value: string; sub: string; href?: string; alert?: boolean }) {
  const body = (
    <>
      <p className="text-xs text-gray-500 flex items-center gap-1">
        {alert && <AlertTriangle size={12} className="text-amber-600" aria-hidden />}
        {label}
      </p>
      <p className="mt-1 text-lg sm:text-xl font-bold tabular-nums truncate">{value}</p>
      <p className="text-xs text-gray-500">{sub}</p>
    </>
  );
  const cls = 'block bg-white border border-blue-500/15 rounded-xl p-3 shadow-sm';
  return href ? (
    <Link href={href} className={`${cls} hover:border-blue-400`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// Daily sales for the last 14 days: one series, so no legend — the title
// names it. Bars are rounded at the data end only, with a hover readout.
function SalesChart({ series }: { series: { date: string; total: number }[] }) {
  const { t, language } = useLanguage();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((s) => s.total));
  const W = 560;
  const H = 120;
  const gap = 2;
  const bw = W / series.length;
  const label = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const h = hover !== null ? series[hover] : null;

  return (
    <section className="bg-white border border-blue-500/15 rounded-xl p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('dashboard.salesChartTitle')}</h3>
        <p className="text-xs text-gray-500 tabular-nums" aria-live="polite">
          {h ? `${label(h.date)} · ${formatIDR(h.total)}` : t('dashboard.max', { amount: formatIDRCompact(max) })}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="mt-2 w-full h-36" role="img" aria-label={t('dashboard.salesChartTitle')}>
        <line x1={0} x2={W} y1={H} y2={H} stroke="currentColor" className="text-gray-200" />
        {series.map((s, i) => {
          const barH = s.total > 0 ? Math.max(3, (s.total / max) * (H - 4)) : 0;
          const x = i * bw + gap / 2 + bw * 0.15;
          const w = bw * 0.7 - gap;
          const r = Math.min(4, w / 2, barH);
          const y = H - barH;
          return (
            <g key={s.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* hit target: the whole column, bigger than the bar */}
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {barH > 0 && (
                <path
                  d={`M${x},${H} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${H} Z`}
                  className={hover === i ? 'fill-blue-700' : 'fill-blue-500'}
                >
                  <title>{`${label(s.date)}: ${formatIDR(s.total)}`}</title>
                </path>
              )}
              {(i === 0 || i === series.length - 1 || i === Math.floor(series.length / 2)) && (
                <text x={i * bw + bw / 2} y={H + 14} textAnchor="middle" className="fill-gray-500" fontSize={10}>
                  {label(s.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{t('dashboard.salesChartTitle')}</caption>
        <tbody>
          {series.map((s) => (
            <tr key={s.date}>
              <td>{s.date}</td>
              <td>{formatIDR(s.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
