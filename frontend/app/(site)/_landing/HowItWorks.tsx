'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { useLanguage } from '@/app/context/LanguageContext';
import { ParallaxGlow, Reveal, SectionHeading } from './primitives';
import { solutionByKey, type SolutionKey } from './solutions';

/* ─── 03 · How it connects. One order passing through each solution, on a
   rail; the rail fills as the
   section scrolls through the viewport and each node lights up as the
   light reaches it. No timers — scrolling is the only driver, and with
   reduced motion the rail is simply full. ───────────────────────── */

const STEPS: { key: SolutionKey }[] = [{ key: 'warehouse' }, { key: 'sales' }, { key: 'delivery' }, { key: 'workshop' }];

function StepNode({
  index,
  progress,
  solution,
}: {
  index: number;
  progress: MotionValue<number>;
  solution: SolutionKey;
}) {
  const { icon: Icon, rgb, ink } = solutionByKey(solution);
  const at = index / (STEPS.length - 1);
  const lit = useTransform(progress, [Math.max(0, at - 0.08), at], [0, 1]);
  return (
    <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-[var(--l-raised)] text-white/50 shadow-[inset_0_1px_0_rgb(var(--ink)/0.06)]">
      <Icon size={20} strokeWidth={2} aria-hidden="true" />
      <motion.span
        aria-hidden="true"
        style={{ opacity: lit }}
        className="absolute inset-0 grid place-items-center rounded-2xl motion-reduce:!opacity-100"
      >
        <span
          className="absolute inset-0 rounded-2xl border"
          style={{ borderColor: `rgb(${rgb} / 0.6)`, background: `rgb(${rgb} / 0.2)`, boxShadow: `0 0 40px -4px rgb(${rgb} / 0.8)` }}
        />
        <Icon size={20} strokeWidth={2} className="relative" style={{ color: ink }} />
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
          <SectionHeading title={t('landing.howItWorks.heading')} className="max-w-3xl" />
        </Reveal>

        <div ref={railRef} className="relative mt-16 sm:mt-20">
          {/* rail: vertical on mobile, horizontal from md */}
          <div aria-hidden="true" className="absolute left-7 top-7 bottom-7 w-px bg-white/[0.08] md:left-[12.5%] md:right-[12.5%] md:top-7 md:bottom-auto md:h-px md:w-auto">
            <motion.div
              style={{ scaleY: progress }}
              className="absolute inset-0 origin-top motion-reduce:[transform:none!important] bg-[linear-gradient(180deg,#60a5fa,#3b82f6,#60a5fa)] shadow-[0_0_14px_rgba(96,165,250,0.9)] md:hidden"
            />
            <motion.div
              style={{ scaleX: progress }}
              className="absolute inset-0 hidden origin-left motion-reduce:[transform:none!important] bg-[linear-gradient(90deg,#60a5fa,#3b82f6,#60a5fa)] shadow-[0_0_14px_rgba(96,165,250,0.9)] md:block"
            />
          </div>

          <ol className="relative grid gap-12 md:grid-cols-4 md:gap-6">
            {STEPS.map(({ key }, i) => (
              <li key={key} className="flex gap-6 md:flex-col md:items-center md:text-center md:gap-0">
                <StepNode index={i} progress={progress} solution={key} />
                <Reveal delay={0.08 * i} className="md:mt-7 md:max-w-xs">
                  <h3 className="text-xl font-semibold tracking-[-0.01em] text-white">
                    {t(`landing.howItWorks.steps.${key}.title`)}
                  </h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-white/60">
                    {t(`landing.howItWorks.steps.${key}.body`)}
                  </p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
