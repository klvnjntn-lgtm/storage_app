'use client';

import { Sparkles, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { display } from '@/lib/fonts';

// The dotted page background + sticky title bar that admin/members and the
// other single-purpose pages use, so new pages don't copy the markup again.
export function PageFrame({
  icon: Icon,
  title,
  subtitle,
  actions,
  width = 'max-w-5xl',
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  width?: string;
  children: ReactNode;
}) {
  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className={`${width} mx-auto flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Icon size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>{title}</h1>
              {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
        </div>
      </div>
      <div className={`${width} mx-auto p-3 sm:p-6 space-y-4`}>{children}</div>
    </main>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="bg-white border border-blue-500/15 rounded-xl p-4 shadow-sm">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{message}</div>;
}

// For features that are built but not switched on yet.
export function ComingSoon({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-md px-3 py-2 mb-3">
      <Sparkles size={16} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (used / Math.max(1, limit)) * 100) : 0;
  const full = limit !== null && used >= limit;
  return (
    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
      <div
        className={`h-full rounded-full ${full ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-600'}`}
        style={{ width: `${limit === null ? 4 : pct}%` }}
      />
    </div>
  );
}

// On/off control for settings — replaces bare checkboxes. Rendered as a
// button with role="switch" so screen readers announce the state.
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${
          checked ? 'translate-x-5.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// A setting line: title + hint on the left, Switch on the right.
export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  badge,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  badge?: ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-3.5 py-3 ${disabled ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 flex flex-wrap items-center gap-2">
          {title}
          {badge}
        </p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
    </div>
  );
}

export const btnPrimary =
  'inline-flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-md px-3 py-2 hover:bg-blue-700 disabled:opacity-50';
export const btnSecondary =
  'inline-flex items-center gap-1.5 text-sm font-medium bg-white border border-gray-300 text-gray-800 rounded-md px-3 py-2 hover:bg-gray-50 disabled:opacity-50';
export const btnDanger =
  'inline-flex items-center gap-1.5 text-sm font-medium bg-white border border-red-300 text-red-700 rounded-md px-3 py-2 hover:bg-red-50 disabled:opacity-50';
export const inputCls =
  'w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30';
export const thCls = 'text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2';
export const tdCls = 'px-3 py-2 text-sm';
