'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { JetBrains_Mono } from 'next/font/google';
import { ArrowUpRight, Lock, type LucideIcon } from 'lucide-react';
import { display } from '@/lib/fonts';
import { GridBackdrop } from '@/app/(site)/_landing/primitives';
import { useLanguage } from '@/app/context/LanguageContext';

// Shared chrome for the hub pages — /home and each section's landing page
// (inventory, sales, purchasing, accounting, workshop, delivery). One
// definition so they all read as the same family: blueprint grid + glow,
// a mono "~/path" line with the date and clock, a big display title,
// numbered section tags, and the gradient module cards.

export const hubMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'] });

// Live clock. Starts null so the server render and first paint match.
export function useNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the clock once after mount
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function getDateLine(now: Date, language: string) {
  return now.toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function HubPage({
  path,
  title,
  subtitle,
  children,
}: {
  path: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const { language } = useLanguage();
  const now = useNow();

  return (
    <main className="relative min-h-screen text-black" style={{ backgroundColor: 'var(--page-bg)' }}>
      {/* Blueprint grid + glow, borrowed from the landing hero. Clipped in
          their own layer so the page itself can still let dropdowns (the
          sales/workshop search) hang past its bottom edge. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <GridBackdrop size={44} opacity={0.07} mask="radial-gradient(ellipse at 70% 0%, black 10%, transparent 70%)" />
        <div className="absolute -top-32 right-[-10%] h-[20rem] w-[20rem] sm:h-[26rem] sm:w-[26rem] rounded-full bg-blue-500/15 blur-[120px]" />
      </div>

      <div className="relative max-w-5xl mx-auto w-full px-4 sm:px-6 pt-6 sm:pt-10 pb-12 sm:pb-16">
        <header className="animate-hero-in motion-reduce:animate-none">
          <div className={`${hubMono.className} flex items-center justify-between flex-wrap gap-x-3 gap-y-1 text-xs`}>
            <span className="uppercase tracking-[0.2em] text-gray-500 truncate">{path}</span>
            <span className="flex items-center gap-2 text-gray-500 tabular-nums">
              {now && (
                <>
                  {getDateLine(now, language)}
                  <span aria-hidden="true" className="text-gray-300">
                    /
                  </span>
                  <time dateTime={now.toISOString()} className="text-gray-900">
                    {now.toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-GB', { hour12: false })}
                  </time>
                </>
              )}
            </span>
          </div>
          <h1
            className={`${display.className} mt-3 sm:mt-4 text-[2rem] sm:text-5xl font-bold tracking-[-0.035em] leading-[1.05] sm:leading-[1.02] break-words`}
          >
            {title}
          </h1>
          {subtitle && <p className="mt-2 sm:mt-3 text-sm text-gray-500">{subtitle}</p>}
        </header>

        {children}
      </div>
    </main>
  );
}

// Gradient accent for part of a hub title (e.g. the user's name on /home).
export function HubAccent({ children }: { children: ReactNode }) {
  return <span className="bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">{children}</span>;
}

export function HubSection({
  index,
  label,
  className = 'mt-8 sm:mt-10',
  children,
}: {
  index: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <SectionTag index={index} label={label} />
      {children}
    </section>
  );
}

// Numbered mono section tag, the app-palette twin of the landing page's
// Kicker (that one is tuned for the landing's dark backdrop).
export function SectionTag({ index, label }: { index: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span
        className={`${hubMono.className} text-[10px] tracking-[0.2em] text-blue-700 px-2 py-1 rounded-full border border-blue-200 bg-blue-50`}
      >
        {index}
      </span>
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">{label}</h2>
    </div>
  );
}

export function HubGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">{children}</div>;
}

// Enabled: gradient tile that navigates. Disabled: dashed, locked tile.
export function HubCard({
  title,
  description,
  icon: Icon,
  gradient,
  onClick,
  enabled = true,
  lockedLabel,
  dataTour,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  gradient: string;
  onClick: () => void;
  enabled?: boolean;
  lockedLabel?: string;
  dataTour?: string;
}) {
  if (!enabled) {
    return (
      <div className="relative text-left rounded-xl p-4 sm:p-6 bg-slate-50 border-2 border-dashed border-blue-300/50 text-gray-400 flex items-center gap-4 sm:flex-col sm:items-stretch sm:justify-between sm:min-h-[150px] cursor-not-allowed">
        <span className="shrink-0 self-center sm:self-start rounded-lg bg-blue-100 p-2.5">
          <Lock size={20} strokeWidth={2} className="text-blue-400" />
        </span>
        <div className="min-w-0">
          <p className={`${display.className} text-lg sm:text-xl font-bold leading-tight text-gray-500`}>{title}</p>
          <p className="text-sm text-gray-400 mt-0.5">{lockedLabel}</p>
        </div>
      </div>
    );
  }

  // Phones: a compact row (icon · text · arrow) so more of the menu fits
  // above the fold. sm+: the tall tile from /home.
  return (
    <button
      type="button"
      data-tour={dataTour}
      onClick={onClick}
      className={`group relative text-left rounded-xl p-4 sm:p-6 bg-gradient-to-br ${gradient} text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 flex items-center gap-4 sm:flex-col sm:items-stretch sm:justify-between sm:min-h-[150px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600`}
    >
      <div className="flex items-start justify-between shrink-0">
        <span className="shrink-0 rounded-lg bg-white/15 p-2.5 ring-1 ring-white/10">
          <Icon size={22} strokeWidth={2} />
        </span>
        <ArrowUpRight
          size={18}
          strokeWidth={2}
          aria-hidden="true"
          className="hidden sm:block opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
        />
      </div>
      <div className="min-w-0 flex-1 sm:flex-none">
        <p className={`${display.className} text-lg sm:text-xl font-bold leading-tight`}>{title}</p>
        <p className="text-sm text-white/85 mt-0.5">{description}</p>
      </div>
      <ArrowUpRight size={18} strokeWidth={2} aria-hidden="true" className="sm:hidden shrink-0 opacity-70" />
    </button>
  );
}

// Whole-section "module not enabled" state.
export function HubLocked({ title, description }: { title: string; description: string }) {
  return (
    <div className="mt-8 sm:mt-10 flex flex-col items-center justify-center text-center rounded-xl border-2 border-dashed border-blue-300/50 bg-slate-50 py-12 sm:py-16 px-4 sm:px-6">
      <span className="rounded-lg bg-blue-100 p-3 mb-4">
        <Lock size={22} strokeWidth={2} className="text-blue-400" />
      </span>
      <p className={`${display.className} text-lg font-bold text-gray-600`}>{title}</p>
      <p className="text-sm text-gray-400 mt-1 max-w-sm">{description}</p>
    </div>
  );
}
