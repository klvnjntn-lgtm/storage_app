'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  PackageSearch,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR, formatIDRCompact } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';
import { useHasModule } from '@/lib/hooks/useHasModule';

type Point = { date: string; total: number };

type Summary = {
  activity?: {
    invoicesIssued: Point[] | null;
    sessionsCompleted: Point[] | null;
    workOrdersDone: Point[] | null;
    deliveriesShipped: Point[] | null;
  };
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
    salesSeries: Point[];
    overdueReceivables: { total: number; count: number };
    payables: { total: number; overdue: number };
    waBalance: number;
  } | null;
};

// The home page's numbers (backend DashboardService). Money only reaches
// admins; everyone sees the operational counts that need someone's action.
export function DashboardKpis() {
  const { t } = useLanguage();
  // The aging reports behind the receivables/payables tiles are Accounting pages.
  const hasAccounting = useHasModule('ACCOUNTING');
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

  // One chart per enabled module; admins get sales in money, everyone
  // else the invoice count.
  const act = data.activity;
  const count = (n: number) => String(n);
  const slides: Slide[] = [];
  if (f) slides.push({ key: 'sales', title: t('dashboard.salesChartTitle'), series: f.salesSeries, format: formatIDR, compact: formatIDRCompact, color: 'blue', href: '/sales' });
  else if (act?.invoicesIssued)
    slides.push({ key: 'sales', title: t('dashboard.invoicesChartTitle'), series: act.invoicesIssued, format: count, compact: count, color: 'blue', href: '/sales' });
  if (act?.sessionsCompleted)
    slides.push({ key: 'warehouse', title: t('dashboard.sessionsChartTitle'), series: act.sessionsCompleted, format: count, compact: count, color: 'green', href: '/inventory' });
  if (act?.workOrdersDone)
    slides.push({ key: 'workshop', title: t('dashboard.workOrdersChartTitle'), series: act.workOrdersDone, format: count, compact: count, color: 'cyan', href: '/workshop' });
  if (act?.deliveriesShipped)
    slides.push({ key: 'delivery', title: t('dashboard.deliveriesChartTitle'), series: act.deliveriesShipped, format: count, compact: count, color: 'violet', href: '/delivery' });

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
            href={hasAccounting ? '/accounting/ar-aging' : undefined}
            alert={f.overdueReceivables.total > 0}
          />
          <Tile
            label={t('dashboard.payables')}
            value={formatIDR(f.payables.total)}
            sub={f.payables.overdue > 0 ? t('dashboard.payablesOverdue', { amount: formatIDRCompact(f.payables.overdue) }) : t('dashboard.nothingOverdue')}
            href={hasAccounting ? '/accounting/ap-aging' : undefined}
            alert={f.payables.overdue > 0}
          />
        </div>
      )}

      {slides.length > 0 && <ChartCarousel slides={slides} />}

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

type Slide = {
  key: string;
  title: string;
  series: Point[];
  format: (n: number) => string;
  compact: (n: number) => string;
  color: keyof typeof BAR;
  href: string;
};

// Literal class names so Tailwind keeps them; colours follow the module
// cards on the home page.
const BAR = {
  blue: { bar: 'fill-blue-500', hover: 'fill-blue-700', dot: 'bg-blue-500' },
  green: { bar: 'fill-green-500', hover: 'fill-green-700', dot: 'bg-green-500' },
  cyan: { bar: 'fill-cyan-500', hover: 'fill-cyan-700', dot: 'bg-cyan-500' },
  violet: { bar: 'fill-violet-500', hover: 'fill-violet-700', dot: 'bg-violet-500' },
};

const AUTO_ADVANCE_MS = 7000;

// The module charts, one at a time. Advances by itself unless the pointer
// or focus is on it (or the user prefers reduced motion); arrows, dots and
// swipes move it by hand.
function ChartCarousel({ slides }: { slides: Slide[] }) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const n = slides.length;
  const current = Math.min(index, n - 1);
  const go = (i: number) => setIndex((i + n) % n);

  useEffect(() => {
    if (n < 2 || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % n), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [n, paused]);

  if (n === 1) return <BarChart slide={slides[0]} />;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('dashboard.activity')}
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 40) go(current + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
    >
      <div className="overflow-hidden rounded-xl">
        <div
          className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {slides.map((s, i) => (
            <div
              key={s.key}
              className="w-full shrink-0"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${n}`}
              aria-hidden={i !== current}
              inert={i !== current}
            >
              <BarChart slide={s} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => go(current - 1)}
          aria-label={t('dashboard.prevChart')}
          className="p-1 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        >
          <ChevronLeft size={16} />
        </button>
        {slides.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => go(i)}
            aria-label={s.title}
            aria-current={i === current}
            className={`h-1.5 rounded-full transition-all ${i === current ? `w-5 ${BAR[s.color].dot}` : 'w-1.5 bg-gray-300 hover:bg-gray-400'}`}
          />
        ))}
        <button
          type="button"
          onClick={() => go(current + 1)}
          aria-label={t('dashboard.nextChart')}
          className="p-1 rounded-full text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

// One series over the last 14 days, so no legend — the title names it.
// Bars are rounded at the data end only, with a hover readout.
function BarChart({ slide }: { slide: Slide }) {
  const { t, language } = useLanguage();
  const { title, series, format, compact, color, href } = slide;
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((s) => s.total));
  const sum = series.reduce((a, s) => a + s.total, 0);
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
        <h3 className="text-sm font-semibold">
          <Link href={href} className="hover:underline">
            {title}
          </Link>
        </h3>
        <p className="text-xs text-gray-500 tabular-nums" aria-live="polite">
          {h
            ? `${label(h.date)} · ${format(h.total)}`
            : `${t('dashboard.total', { amount: compact(sum) })} · ${t('dashboard.max', { amount: compact(max) })}`}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="mt-2 w-full h-36" role="img" aria-label={title}>
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
                  className={hover === i ? BAR[color].hover : BAR[color].bar}
                >
                  <title>{`${label(s.date)}: ${format(s.total)}`}</title>
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
        <caption>{title}</caption>
        <tbody>
          {series.map((s) => (
            <tr key={s.date}>
              <td>{s.date}</td>
              <td>{format(s.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
