'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { PackagePlus, ArrowLeftRight, Activity } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { ParallaxGlow, Reveal, SectionHeading } from './primitives';

/* ─── 03 · How it works. Three steps on a rail; the rail fills as the
   section scrolls through the viewport and each node lights up as the
   light reaches it. No timers — scrolling is the only driver, and with
   reduced motion the rail is simply full. ───────────────────────── */

const STEPS = [
  { key: 'receive', icon: PackagePlus, chip: '+12 BRK-2041 → A-03' },
  { key: 'move', icon: ArrowLeftRight, chip: 'A-03 → B-11 · Rina' },
  { key: 'track', icon: Activity, chip: '12,492 · LIVE' },
] as const;

function StepNode({
  index,
  progress,
  icon: Icon,
}: {
  index: number;
  progress: MotionValue<number>;
  icon: typeof PackagePlus;
}) {
  const at = index / (STEPS.length - 1);
  const lit = useTransform(progress, [Math.max(0, at - 0.08), at], [0, 1]);
  return (
    <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-[#0a1122] text-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <Icon size={20} strokeWidth={2} aria-hidden="true" />
      <motion.span
        aria-hidden="true"
        style={{ opacity: lit }}
        className="absolute inset-0 grid place-items-center rounded-2xl motion-reduce:!opacity-100 border border-blue-400/60 bg-[linear-gradient(180deg,rgba(59,130,246,0.3),rgba(29,78,216,0.2))] text-white shadow-[0_0_40px_-4px_rgba(59,130,246,0.85),inset_0_1px_0_rgba(255,255,255,0.2)]"
      >
        <Icon size={20} strokeWidth={2} />
      </motion.span>
    </span>
  );
}

export default function HowItWorks() {
  const { t } = useLanguage();
  const railRef = useRef<HTMLDivElement>(null);
  // Same value on server and client; reduced motion is handled in CSS
  // (rail full, nodes lit) so hydration never disagrees.
  const { scrollYProgress: progress } = useScroll({ target: railRef, offset: ['start 80%', 'end 45%'] });

  return (
    <section id="how-it-works" className="relative overflow-hidden scroll-mt-16 md:scroll-mt-20">
      <ParallaxGlow className="absolute -top-20 left-1/3 h-96 w-96 rounded-full bg-blue-600/[0.12] blur-[130px]" speed={0.15} />
      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <Reveal>
          <SectionHeading index="03" eyebrow={t('landing.howItWorks.eyebrow')} title={t('landing.howItWorks.heading')} />
        </Reveal>

        <div ref={railRef} className="relative mt-16 sm:mt-20">
          {/* rail: vertical on mobile, horizontal from md */}
          <div aria-hidden="true" className="absolute left-7 top-7 bottom-7 w-px bg-white/[0.08] md:left-[calc(100%/6)] md:right-[calc(100%/6)] md:top-7 md:bottom-auto md:h-px md:w-auto">
            <motion.div
              style={{ scaleY: progress }}
              className="absolute inset-0 origin-top motion-reduce:[transform:none!important] bg-[linear-gradient(180deg,#60a5fa,#3b82f6,#60a5fa)] shadow-[0_0_14px_rgba(96,165,250,0.9)] md:hidden"
            />
            <motion.div
              style={{ scaleX: progress }}
              className="absolute inset-0 hidden origin-left motion-reduce:[transform:none!important] bg-[linear-gradient(90deg,#60a5fa,#3b82f6,#60a5fa)] shadow-[0_0_14px_rgba(96,165,250,0.9)] md:block"
            />
          </div>

          <ol className="relative grid gap-12 md:grid-cols-3 md:gap-8">
            {STEPS.map(({ key, icon, chip }, i) => (
              <li key={key} className="flex gap-6 md:flex-col md:items-center md:text-center md:gap-0">
                <StepNode index={i} progress={progress} icon={icon} />
                <Reveal delay={0.08 * i} className="md:mt-7 md:max-w-xs">
                  <p className="font-mono text-[11px] tracking-[0.2em] text-blue-300/90">
                    {String(i + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold tracking-[-0.01em] text-white">
                    {t(`landing.howItWorks.steps.${key}.title`)}
                  </h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-white/60">
                    {t(`landing.howItWorks.steps.${key}.body`)}
                  </p>
                  <span
                    aria-hidden="true"
                    className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] text-blue-200/90"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                    {chip}
                  </span>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
