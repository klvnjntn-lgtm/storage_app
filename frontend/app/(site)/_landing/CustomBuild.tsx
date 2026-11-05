'use client';

import { ArrowRight, Blocks, MessageCircle, Plug, ScrollText, Smartphone } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { WHATSAPP_URL } from '@/lib/support';
import { GridBackdrop, Reveal, SectionHeading, SpotlightCard } from './primitives';

/* ─── 05 · Custom apps. The answer for a business none of the four solutions
   fits: WareSys also builds software to order. Sits straight after "who it's
   for", where a visitor who didn't see their industry is deciding to leave. */

const OFFERS = [
  { key: 'apps', icon: Smartphone },
  { key: 'integrations', icon: Plug },
  { key: 'workflows', icon: Blocks },
  { key: 'reports', icon: ScrollText },
];

export default function CustomBuild() {
  const { t } = useLanguage();
  const c = (k: string) => t(`landing.custom.${k}`);
  return (
    <section id="custom" className="relative overflow-hidden scroll-mt-16 md:scroll-mt-20">
      <GridBackdrop size={44} opacity={0.06} mask="radial-gradient(ellipse at 20% 40%, black 10%, transparent 70%)" />
      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32 grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16 items-center">
        <Reveal>
          <SectionHeading index="05" eyebrow={c('eyebrow')} title={c('heading')} />
          <p className="mt-6 max-w-lg text-base sm:text-lg leading-relaxed text-white/60">{c('body')}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <a
              href={WHATSAPP_URL}
              className="dark-island inline-flex min-h-12 items-center gap-2 rounded-md bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
            >
              <MessageCircle size={16} aria-hidden="true" />
              {c('cta')}
            </a>
            <a
              href="#contact"
              className="group inline-flex items-center gap-2 text-sm font-semibold text-blue-300 hover:text-blue-200 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400"
            >
              {t('landing.nav.contact')}
              <ArrowRight size={15} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </Reveal>
        <Reveal delay={0.1} className="grid gap-3 sm:grid-cols-2">
          {OFFERS.map(({ key, icon: Icon }) => (
            <SpotlightCard key={key} className="h-full p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/[0.14] text-blue-300 ring-1 ring-inset ring-blue-400/30">
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-semibold text-white">{c(`offers.${key}.title`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/60">{c(`offers.${key}.body`)}</p>
            </SpotlightCard>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
