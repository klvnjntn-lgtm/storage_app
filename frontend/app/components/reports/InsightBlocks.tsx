'use client';

import type { ReactNode } from 'react';
import { BarChart3, Crown, type LucideIcon } from 'lucide-react';
import { display } from '@/lib/fonts';

// Building blocks shared by the insight pages (Sales Insights, Delivery
// Reports). Colours come from the .console tokens in theme.css (light +
// dark), shared with the platform console; .insights swaps in the app's
// blue and backdrop — so wrap the page in `console insights`.
export const CARD = 'rounded-2xl border border-(--c-line) bg-(--c-surface) backdrop-blur shadow-[0_20px_50px_-30px_var(--c-shadow)]';

export const TONES = {
  sky: { icon: 'text-(--c-sky)', tile: 'from-(--c-sky)/20 border-(--c-sky)/30', glow: 'from-(--c-sky)/10' },
  emerald: { icon: 'text-(--c-emerald)', tile: 'from-(--c-emerald)/20 border-(--c-emerald)/30', glow: 'from-(--c-emerald)/10' },
  amber: { icon: 'text-(--c-amber)', tile: 'from-(--c-amber)/20 border-(--c-amber)/30', glow: 'from-(--c-amber)/10' },
  red: { icon: 'text-(--c-red)', tile: 'from-(--c-red)/20 border-(--c-red)/30', glow: 'from-(--c-red)/10' },
} as const;

export type Tone = keyof typeof TONES;

// The #1 entry of one list, spelled out: what it is, how much, and why.
export function Highlight({
  icon: Icon,
  tone,
  label,
  name,
  value,
  detail,
  empty,
  crown = true,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  name: ReactNode | undefined;
  value: string | null;
  detail: string | null;
  empty: string;
  // Off for a "worst of" card — a crown would read as praise.
  crown?: boolean;
}) {
  const c = TONES[tone];
  return (
    <div className={`${CARD} relative overflow-hidden p-4 min-w-0`}>
      <span className={`absolute inset-0 bg-gradient-to-br ${c.glow} to-transparent pointer-events-none`} aria-hidden />
      <div className="relative flex items-center gap-2">
        <span className={`flex items-center justify-center w-8 h-8 rounded-lg border bg-gradient-to-br to-transparent ${c.tile}`}>
          <Icon size={15} className={c.icon} aria-hidden />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-(--c-muted)">{label}</span>
        {name && crown && <Crown size={14} className="ml-auto text-(--c-amber)" aria-hidden />}
      </div>
      {name ? (
        <>
          <p className="relative mt-3 text-base font-semibold text-(--c-ink) truncate" title={typeof name === 'string' ? name : undefined}>
            {name}
          </p>
          <p className="relative mt-0.5 flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xl font-semibold tabular-nums text-(--c-ink)">{value}</span>
            <span className="text-sm text-(--c-muted)">{detail}</span>
          </p>
        </>
      ) : (
        <p className="relative mt-3 text-sm text-(--c-muted)">{empty}</p>
      )}
    </div>
  );
}

export function Panel({
  icon: Icon,
  title,
  subtitle,
  wide,
  actions,
  className = '',
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  wide?: boolean;
  // Right side of the header (a toggle, a count…).
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${CARD} p-4 sm:p-5 min-w-0 ${wide ? 'lg:col-span-2' : ''} ${className}`}>
      <div className="flex flex-wrap items-start gap-3 mb-4">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-(--c-sky)/20 to-transparent border border-(--c-sky)/30 shrink-0">
          <Icon size={16} className="text-(--c-sky)" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={`${display.className} text-base font-bold text-(--c-ink)`}>{title}</h2>
          {subtitle && <p className="text-sm text-(--c-muted)">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ text, icon: Icon = BarChart3 }: { text: string; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-(--c-line-strong) py-10 text-center">
      <Icon size={22} className="text-(--c-faint)" aria-hidden />
      <p className="text-sm text-(--c-muted)">{text}</p>
    </div>
  );
}
