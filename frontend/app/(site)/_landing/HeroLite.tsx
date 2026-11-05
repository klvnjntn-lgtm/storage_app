import { SOLUTIONS, type SolutionKey } from './solutions';

/* ─── Static hero ────────────────────────────────────────────────────
   The same four-zone diorama as the WebGL scene, as one server-rendered
   SVG: no JavaScript, no animation, no image download. Low-end devices
   keep it; everyone else sees it as the poster until the 3D scene is ready,
   so the hero is never empty. Geometry is plain isometric projection,
   computed once at module load (world units match hero3d/timeline.ts). */

type Tone = [top: string, left: string, right: string];

const S = 46;
const COS = Math.cos(Math.PI / 6);
const r = (n: number) => Math.round(n * 10) / 10;
/** World (x, y up, z) → SVG. Camera sits toward +x +z, as in the 3D hero. */
const iso = (x: number, y: number, z: number) => `${r(450 + (x - z) * COS * S)},${r(285 + (x + z) * 0.5 * S - y * S)}`;

function box(x: number, y: number, z: number, w: number, h: number, d: number, [top, left, right]: Tone) {
  const [x1, y1, z1] = [x + w, y + h, z + d];
  return [
    { c: top, p: [iso(x, y1, z), iso(x1, y1, z), iso(x1, y1, z1), iso(x, y1, z1)] },
    { c: left, p: [iso(x, y1, z1), iso(x1, y1, z1), iso(x1, y, z1), iso(x, y, z1)] },
    { c: right, p: [iso(x1, y1, z), iso(x1, y1, z1), iso(x1, y, z1), iso(x1, y, z)] },
  ].map(({ c, p }) => ({ c, p: p.join(' ') }));
}
const flat = (x: number, z: number, w: number, d: number, c: string, o = 1) => ({
  c,
  o,
  p: [iso(x, 0, z), iso(x + w, 0, z), iso(x + w, 0, z + d), iso(x, 0, z + d)].join(' '),
});

const BLUE: Tone = ['#3b82f6', '#1d4ed8', '#1e40af'];
const STEEL: Tone = ['#334155', '#1e293b', '#0f172a'];
const CARDBOARD: Tone = ['#d4a26a', '#a87b4a', '#8a6238'];
const NAVY: Tone = ['#2563eb', '#1e3a8a', '#172554'];
const LIGHT: Tone = ['#f1f5f9', '#cbd5e1', '#94a3b8'];
const GREEN: Tone = ['#10b981', '#059669', '#047857'];
const SCREEN: Tone = ['#334155', '#34d399', '#0f172a'];
const VIOLET: Tone = ['#8b5cf6', '#6d28d9', '#5b21b6'];
const AMBER: Tone = ['#f59e0b', '#b45309', '#92400e'];
const RED: Tone = ['#f43f5e', '#be123c', '#9f1239'];
const TYRE: Tone = ['#334155', '#111827', '#030712'];

function rack(x: number, z: number, bays: number, alongX: boolean) {
  const out = [];
  // bottom shelf up, so each level's boxes sit on it and the next covers neither
  for (const y of [0.12, 0.82, 1.52]) {
    out.push(...box(x, y - 0.05, z, alongX ? bays * 1.2 : 0.7, 0.05, alongX ? 0.7 : bays * 1.2, BLUE));
    for (let b = 0; b < bays; b++) {
      const [bx, bz] = alongX ? [x + b * 1.2, z] : [x, z + b * 1.2];
      const tone = (b + Math.round(y * 10)) % 3 === 0 ? NAVY : CARDBOARD;
      out.push(...box(bx + 0.12, y, bz + 0.12, 0.44, 0.36 + ((b + 1) % 3) * 0.06, 0.44, tone));
      out.push(...box(alongX ? bx + 0.64 : bx + 0.12, y, alongX ? bz + 0.12 : bz + 0.64, 0.44, 0.3, 0.44, CARDBOARD));
    }
  }
  for (let b = 0; b <= bays; b++) {
    const [bx, bz] = alongX ? [x + b * 1.2, z + 0.66] : [x + 0.66, z + b * 1.2];
    out.push(...box(bx, 0, bz, 0.05, 2.15, 0.05, STEEL));
  }
  return out;
}

const FLOOR = [
  flat(-5.6, -3.6, 12.2, 8.9, '#0f1a30'),
  flat(-5.1, -3.3, 8.35, 2.25, '#60a5fa', 0.14),
  flat(-2.3, -0.02, 2.6, 1.64, '#34d399', 0.16),
  flat(-3.6, 2.1, 3.8, 2.95, '#fbbf24', 0.13),
  flat(4.3, -3.45, 1.8, 8.6, '#a78bfa', 0.18),
];

// Painter's order: far to near.
const SOLIDS = [
  ...box(-5.6, -0.3, 5.3, 12.2, 0.3, 0.001, STEEL),
  ...box(6.6, -0.3, -3.6, 0.001, 0.3, 8.9, STEEL),
  ...rack(-3.4, -2.95, 5, true),
  ...rack(-4.75, -1.6, 4, false),
  // counter, POS, printer
  ...box(-2, 0, 0.44, 2, 0.8, 0.72, GREEN),
  ...box(-1.75, 0.8, 0.7, 0.66, 0.46, 0.05, SCREEN),
  ...box(-0.72, 0.8, 0.62, 0.34, 0.16, 0.36, STEEL),
  // truck
  ...box(4.7, 0, -1.2, 1, 0.34, 2.5, STEEL),
  ...box(4.62, 0.3, -1.4, 1.16, 0.92, 0.78, VIOLET),
  ...box(4.62, 0.4, -0.54, 1.16, 1.3, 1.94, LIGHT),
  // lift and car
  ...box(-1.67, 0, 2.57, 0.14, 1.8, 0.14, AMBER),
  ...box(-2.45, 0.78, 3.02, 0.3, 0.3, 0.96, TYRE),
  ...box(-1.05, 0.78, 3.02, 0.3, 0.3, 0.96, TYRE),
  ...box(-2.7, 0.98, 3.02, 2.2, 0.34, 0.96, RED),
  ...box(-2.14, 1.32, 3.08, 1.1, 0.3, 0.84, STEEL),
  ...box(-1.67, 0, 4.29, 0.14, 1.8, 0.14, AMBER),
  // toolbox and tyres
  ...box(-3.45, 0, 4.2, 0.8, 0.66, 0.42, RED),
  ...box(-0.55, 0, 4.35, 0.5, 0.56, 0.5, TYRE),
];

// label anchors, in % of the 900×640 box
const TAGS: Record<SolutionKey, { left: string; top: string }> = {
  warehouse: { left: '47%', top: '7%' },
  sales: { left: '53%', top: '38%' },
  workshop: { left: '24%', top: '52%' },
  delivery: { left: '80%', top: '37%' },
};

export default function HeroLite({ labels }: { labels: Record<SolutionKey, string> }) {
  return (
    <div className="relative mx-auto aspect-[900/640] w-full max-w-[860px]" aria-hidden="true">
      <svg viewBox="0 0 900 640" className="absolute inset-0 h-full w-full" fill="none">
        {FLOOR.map((f, i) => (
          <polygon key={i} points={f.p} fill={f.c} fillOpacity={f.o} />
        ))}
        {SOLIDS.map((f, i) => (
          <polygon key={i} points={f.p} fill={f.c} />
        ))}
      </svg>
      {SOLUTIONS.map(({ key, icon: Icon, hex, rgb }) => (
        <span
          key={key}
          className="absolute inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border bg-[#0b1224] px-2.5 py-1 text-[11px] font-semibold"
          style={{ ...TAGS[key], color: hex, borderColor: `rgb(${rgb} / 0.45)` }}
        >
          <Icon size={12} strokeWidth={2.4} />
          {labels[key]}
        </span>
      ))}
    </div>
  );
}
