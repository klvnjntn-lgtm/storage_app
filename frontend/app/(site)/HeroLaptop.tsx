'use client';

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Disc3, Cog, BatteryFull, Zap, Wrench, Cylinder, CheckCircle2 } from 'lucide-react';
import styles from './HeroLaptop.module.css';

/* ─── Hero centerpiece: a CSS-3D laptop whose app modules get pulled out of
   the sidebar and float in front of the screen on tether lines, then slide
   back in. Everything is decorative DOM (aria-hidden), no video assets. ── */

const SIDEBAR = ['Dashboard', 'Stock', 'Scan', 'Delivery', 'Accounting', 'Audit log'];

// Screen-local coordinates (px): origin = top-left of the lid panel, +z
// points out of the screen toward the viewer.
const itemAnchor = (i: number) => ({ x: 104, y: 73 + i * 21 });

type ModuleKey = 'accounting' | 'stock' | 'delivery' | 'scan' | 'audit';

const MODULES: { key: ModuleKey; index: string; title: string; item: number; to: [number, number, number]; delay: number }[] = [
  { key: 'accounting', index: '01', title: 'Accounting', item: 4, to: [-50, 40, 170], delay: 0 },
  { key: 'delivery', index: '02', title: 'Delivery', item: 3, to: [565, 15, 140], delay: 0.15 },
  { key: 'stock', index: '03', title: 'Stock', item: 1, to: [-70, 250, 230], delay: 0.3 },
  { key: 'scan', index: '04', title: 'Barcode scan', item: 2, to: [580, 235, 200], delay: 0.45 },
  { key: 'audit', index: '05', title: 'Audit log', item: 5, to: [270, -105, 120], delay: 0.6 },
];

/* Tether from the sidebar item to the panel centre. Both animate on the
   same eased progress, so scaleX(p) on the line always ends at the panel. */
function tether(from: { x: number; y: number }, [bx, by, bz]: [number, number, number]) {
  const dx = bx - from.x;
  const dy = by - from.y;
  const len = Math.hypot(dx, dy, bz);
  const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
  const pitch = (Math.asin(bz / len) * 180) / Math.PI;
  // Rounded: Node and the browser can disagree in the last float digit,
  // which would cause a hydration mismatch on the inline styles.
  const r = (n: number) => Math.round(n * 100) / 100;
  return { len: r(len), yaw: r(yaw), pitch: r(pitch) };
}

function Panel({ index, title, dark, children }: { index: string; title: string; dark?: boolean; children: ReactNode }) {
  return (
    <div className={`${styles.card} ${dark ? styles.cardDark : ''}`}>
      <div className={`flex items-center gap-1.5 mb-1.5 ${dark ? 'text-white' : 'text-gray-900'}`}>
        <span className={`font-mono text-[7px] px-1 rounded border ${dark ? 'border-blue-400/30 text-blue-300' : 'border-blue-500/25 text-blue-600'}`}>
          {index}
        </span>
        <span className="text-[9px] font-bold tracking-tight">{title}</span>
      </div>
      {children}
    </div>
  );
}

const CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

function AccountingBody() {
  const points = [30, 24, 28, 18, 21, 12, 15, 6];
  const line = points.map((y, i) => `${i * 17},${y}`).join(' ');
  const donut = [38, 24, 18, 12, 8];
  let acc = 0;
  return (
    <div className="text-gray-900">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[6.5px] uppercase tracking-wide text-gray-400">Net profit</span>
        <span className="text-[6.5px] font-semibold text-emerald-600">+12.4%</span>
      </div>
      <p className="text-[13px] font-bold leading-tight mb-1">Rp 184.2M</p>
      <div className="flex items-end gap-2">
        <svg width="122" height="44" viewBox="0 -2 119 40" className="shrink-0">
          <defs>
            <linearGradient id="hl-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#2a78d6" stopOpacity="0.35" />
              <stop offset="1" stopColor="#2a78d6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,38 ${line} 119,38`} fill="url(#hl-area)" />
          <polyline points={line} fill="none" stroke="#2a78d6" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="119" cy="6" r="2.2" fill="#2a78d6" />
        </svg>
        <svg width="44" height="44" viewBox="0 0 42 42" className="-rotate-90">
          {donut.map((v, i) => {
            const el = (
              <circle key={i} cx="21" cy="21" r="15.9" fill="none" stroke={CHART_COLORS[i]} strokeWidth="6"
                pathLength="100" strokeDasharray={`${v - 1} ${101 - v}`} strokeDashoffset={-acc} />
            );
            acc += v;
            return el;
          })}
        </svg>
      </div>
    </div>
  );
}

function DeliveryBody() {
  const stops = [
    { x: 18, y: 50, c: '#16a34a' },
    { x: 52, y: 30, c: '#16a34a' },
    { x: 96, y: 44, c: '#16a34a' },
    { x: 132, y: 18, c: '#f59e0b' },
    { x: 166, y: 40, c: '#dc2626' },
  ];
  return (
    <div>
      <svg width="182" height="64" viewBox="0 0 182 64" className="rounded-md bg-[#eef2f6] block">
        <g stroke="#fff" strokeWidth="5" fill="none">
          <path d="M0 22 H182 M0 50 H182 M40 0 V64 M112 0 V64 M150 0 L182 30" />
        </g>
        <g stroke="#dfe5ec" strokeWidth="2" fill="none">
          <path d="M0 8 H182 M76 0 V64 M0 36 L60 64" />
        </g>
        <polyline points={stops.map((s) => `${s.x},${s.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="2" strokeDasharray="4 3" />
        {stops.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r="4" fill={s.c} stroke="#fff" strokeWidth="1.5" />
        ))}
      </svg>
      <div className="flex items-center justify-between mt-1.5 text-[7px] text-gray-500">
        <span className="font-semibold text-gray-900">Route R-12 · 5 stops</span>
        <span className="flex gap-1">
          <span className="px-1 rounded bg-green-100 text-green-700">3 done</span>
          <span className="px-1 rounded bg-red-100 text-red-700">1 failed</span>
        </span>
      </div>
    </div>
  );
}

const PARTS = [
  { icon: Disc3, name: 'Brake disc', qty: 48, from: '#dbeafe', to: '#93c5fd', ink: 'text-blue-700' },
  { icon: Cog, name: 'Gear set', qty: 21, from: '#ede9fe', to: '#c4b5fd', ink: 'text-violet-700' },
  { icon: BatteryFull, name: 'Battery', qty: 9, from: '#fef3c7', to: '#fcd34d', ink: 'text-amber-700' },
  { icon: Zap, name: 'Spark plug', qty: 132, from: '#fee2e2', to: '#fca5a5', ink: 'text-red-700' },
  { icon: Wrench, name: 'Tie rod', qty: 15, from: '#dcfce7', to: '#86efac', ink: 'text-green-700' },
  { icon: Cylinder, name: 'Oil filter', qty: 4, from: '#e5e7eb', to: '#9ca3af', ink: 'text-gray-700' },
];

function StockBody() {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {PARTS.map(({ icon: Icon, name, qty, from, to, ink }) => (
        <div key={name}>
          <div className="h-[30px] rounded flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
            <Icon size={15} strokeWidth={1.8} className={ink} />
          </div>
          <p className="text-[6.5px] font-semibold text-gray-900 mt-0.5 truncate">{name}</p>
          <p className={`text-[6px] ${qty < 10 ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>{qty} pcs</p>
        </div>
      ))}
    </div>
  );
}

function ScanBody() {
  const bars = [2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1];
  let x = 0;
  return (
    <div>
      <div className={styles.viewfinder}>
        <svg width="108" height="34" viewBox="0 0 108 34">
          {bars.map((w, i) => {
            const bar = i % 2 === 0 ? <rect key={i} x={x} y="0" width={w * 1.5} height="34" fill="#e2e8f0" /> : null;
            x += w * 1.5 + 1.5;
            return bar;
          })}
        </svg>
        <span className={styles.scanLine} />
      </div>
      <div className="flex items-center gap-1 mt-1.5 text-[7px] text-white/80">
        <CheckCircle2 size={9} className="text-emerald-400 shrink-0" />
        <span className="font-mono text-blue-300">BRK-2041</span>
        <span className="truncate">Brake pad set</span>
        <span className="ml-auto text-emerald-400 font-semibold">+12 → A-03</span>
      </div>
    </div>
  );
}

const AUDIT = [
  { who: 'RN', tone: 'bg-blue-600', action: 'MOVE', badge: 'bg-blue-100 text-blue-700', text: '12× BRK-2041 A-03 → B-11', time: '09:14' },
  { who: 'AD', tone: 'bg-amber-500', action: 'ADJUST', badge: 'bg-amber-100 text-amber-700', text: 'FLT-0187 qty 13 → 9', time: '09:02' },
  { who: 'BD', tone: 'bg-emerald-600', action: 'RECEIVE', badge: 'bg-green-100 text-green-700', text: 'PO-1093 · 40 items', time: '08:47' },
  { who: 'SL', tone: 'bg-violet-600', action: 'SHIP', badge: 'bg-violet-100 text-violet-700', text: 'DO-2210 → Route R-12', time: '08:31' },
];

function AuditBody() {
  return (
    <div>
      {AUDIT.map((row) => (
        <div key={row.time} className="flex items-center gap-1.5 py-[3px] border-b border-blue-500/10 last:border-0 text-[6.5px]">
          <span className={`w-3.5 h-3.5 shrink-0 rounded-full ${row.tone} text-white text-[5px] font-bold flex items-center justify-center`}>
            {row.who}
          </span>
          <span className={`px-1 rounded text-[5.5px] font-bold ${row.badge}`}>{row.action}</span>
          <span className="truncate text-gray-600">{row.text}</span>
          <span className="ml-auto font-mono text-gray-400">{row.time}</span>
        </div>
      ))}
    </div>
  );
}

const BODIES: Record<ModuleKey, () => ReactNode> = {
  accounting: AccountingBody,
  delivery: DeliveryBody,
  stock: StockBody,
  scan: ScanBody,
  audit: AuditBody,
};

const STOCK_ROWS = [
  { sku: 'BRK-2041', item: 'Brake pad set', loc: 'A-03', qty: 48, low: false },
  { sku: 'FLT-0187', item: 'Oil filter', loc: 'B-11', qty: 9, low: true },
  { sku: 'BLT-3302', item: 'Timing belt', loc: 'A-07', qty: 21, low: false },
  { sku: 'SPK-1120', item: 'Spark plug', loc: 'C-02', qty: 132, low: false },
  { sku: 'BRG-0876', item: 'Wheel bearing', loc: 'B-04', qty: 4, low: true },
  { sku: 'CLT-5510', item: 'Clutch kit', loc: 'D-01', qty: 15, low: false },
];

function AppScreenMock() {
  return (
    <div className={`${styles.screen} text-gray-900`}>
      <div className="w-[108px] shrink-0 border-r border-blue-500/15 bg-white">
        <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-blue-500/15">
          <span className="w-4 h-4 rounded bg-gradient-to-br from-blue-600 to-indigo-700" />
          <span className="text-[9px] font-bold">WareSys</span>
        </div>
        <p className="px-2.5 pt-2 pb-1 text-[6.5px] font-semibold uppercase tracking-wide text-blue-700/50">Modules</p>
        {SIDEBAR.map((item, i) => (
          <div
            key={item}
            className={`mx-1.5 mb-[3px] px-2 h-[18px] rounded text-[8px] flex items-center ${
              i === 0 ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-500'
            }`}
          >
            {item}
          </div>
        ))}
      </div>

      <div className="flex-1 min-w-0 p-2.5 bg-slate-50">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-bold">Dashboard</p>
          <span className="w-24 text-[7px] px-1.5 py-0.5 rounded border border-blue-500/20 bg-white text-gray-400">
            Search SKU…
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {[
            { k: 'SKUs', v: '1,284', c: '' },
            { k: 'Deliveries today', v: '18', c: '' },
            { k: 'Low stock', v: '12', c: 'text-amber-600' },
          ].map(({ k, v, c }) => (
            <div key={k} className="bg-white border border-blue-500/15 rounded p-1.5">
              <p className="text-[6px] uppercase tracking-wide text-gray-400">{k}</p>
              <p className={`text-[12px] font-bold leading-tight ${c}`}>{v}</p>
            </div>
          ))}
        </div>

        <div className="bg-white border border-blue-500/15 rounded overflow-hidden">
          <div className="grid grid-cols-[1fr_1.6fr_0.6fr_0.5fr] px-1.5 py-1 text-[6px] uppercase tracking-wide text-gray-400 border-b border-blue-500/10">
            <span>SKU</span><span>Item</span><span>Loc</span><span className="text-right">Qty</span>
          </div>
          {STOCK_ROWS.map((r) => (
            <div
              key={r.sku}
              className="grid grid-cols-[1fr_1.6fr_0.6fr_0.5fr] items-center px-1.5 py-[3px] text-[7px] border-b border-blue-500/5 last:border-0"
            >
              <span className="font-mono text-blue-700">{r.sku}</span>
              <span className="truncate">{r.item}</span>
              <span className="text-gray-500">{r.loc}</span>
              <span className={`text-right font-semibold ${r.low ? 'text-amber-600' : ''}`}>{r.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HeroLaptop() {
  return (
    <div className={styles.stage} aria-hidden="true">
      <div className={styles.rig}>
        <div className={styles.floor} />

        <div className={`${styles.slab} ${styles.shell}`} />
        <div className={`${styles.slab} ${styles.deck}`}>
          <div className={styles.keys}>
            {Array.from({ length: 65 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          <div className={styles.trackpad} />
        </div>

        <div className={styles.lid}>
          <div className={`${styles.slab} ${styles.lidBack}`} />
          <div className={`${styles.slab} ${styles.panel}`}>
            <AppScreenMock />

            {MODULES.map(({ key, index, title, item, to, delay }) => {
              const from = itemAnchor(item);
              const { len, yaw, pitch } = tether(from, to);
              const Body = BODIES[key];
              const vars = {
                '--ax': `${from.x}px`,
                '--ay': `${from.y}px`,
                '--bx': `${to[0]}px`,
                '--by': `${to[1]}px`,
                '--bz': `${to[2]}px`,
                '--yaw': `${yaw}deg`,
                '--pitch': `${-pitch}deg`,
                animationDelay: `${delay}s`,
              } as CSSProperties;
              return (
                <Fragment key={key}>
                  <span className={styles.origin} style={{ left: from.x, top: from.y, ...vars }} />
                  <span className={styles.tether} style={{ left: from.x, top: from.y, width: len, ...vars }} />
                  <div className={styles.module} style={vars}>
                    <Panel index={index} title={title} dark={key === 'scan'}>
                      <Body />
                    </Panel>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
