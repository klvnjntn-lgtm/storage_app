'use client';

import { motion } from 'framer-motion';
import {
  TriangleAlert,
  CircleHelp,
  MapPin,
  Clock,
  FileSpreadsheet,
  CheckCheck,
  ArrowDown,
} from 'lucide-react';
import { display } from '@/lib/fonts';
import { useLanguage } from '@/app/context/LanguageContext';
import { EASE_OUT, GridBackdrop, ParallaxGlow, Reveal, SectionHeading, Stagger, StaggerItem } from './primitives';
import styles from './ProblemSection.module.css';

/* ─── 01 · The problem. The "before" picture: a spreadsheet nobody
   trusts, a WhatsApp question nobody answers, a sticky note. It's the
   visual counterpoint to the calm, live product in the hero. ─────── */

function ChaosVisual() {
  const { t } = useLanguage();
  const s = (key: string) => t(`landing.scene.${key}`);
  const v = (key: string) => t(`landing.problem.visual.${key}`);

  return (
    <div className={styles.stage} aria-hidden="true">
      {/* the spreadsheet */}
      <div className={styles.sheet}>
        <div className={styles.sheetBar}>
          <span className={styles.dots}>
            <i />
            <i />
            <i />
          </span>
          <FileSpreadsheet size={13} strokeWidth={2} className={styles.fileIcon} />
          <span className={styles.fileName}>{t('landing.problem.mockLog.fileLabel')}</span>
        </div>
        <div className={styles.formula}>
          <span className={styles.cellRef}>D3</span>
          <span className={styles.fx}>fx</span>
          <span>=SUM(D2:D7)</span>
        </div>
        <div className={styles.grid}>
          <div className={`${styles.row} ${styles.letters}`}>
            <span />
            <span>A</span>
            <span>B</span>
            <span>C</span>
            <span>D</span>
          </div>
          <div className={`${styles.row} ${styles.headRow}`}>
            <span>1</span>
            <span>{s('sku')}</span>
            <span>{s('item')}</span>
            <span>{s('location')}</span>
            <span>{s('qty')}</span>
          </div>
          <div className={styles.row}>
            <span>2</span>
            <span>SKU-1042</span>
            <span>{s('items.brakePads')}</span>
            <span>Bay 3</span>
            <span className={styles.n}>12</span>
          </div>
          <div className={`${styles.row} ${styles.bad}`}>
            <span>3</span>
            <span>SKU-1042</span>
            <span>{s('items.brakePads')}</span>
            <span>Bay 7</span>
            <span className={`${styles.n} ${styles.selected}`}>4</span>
          </div>
          <div className={styles.row}>
            <span>4</span>
            <span>SKU-0877</span>
            <span>{s('items.oilFilter')}</span>
            <span className={styles.dim}>???</span>
            <span className={`${styles.n} ${styles.err}`}>#REF!</span>
          </div>
          <div className={`${styles.row} ${styles.struck}`}>
            <span>5</span>
            <span>SKU-2210</span>
            <span>{s('items.timingBelt')}</span>
            <span>Bay 1</span>
            <span className={styles.n}>21</span>
          </div>
          <div className={styles.row}>
            <span>6</span>
            <span>SKU-0932</span>
            <span>{s('items.sparkPlug')}</span>
            <span>Bay 2</span>
            <span className={`${styles.n} ${styles.guess}`}>90?</span>
          </div>
          <div className={styles.row}>
            <span>7</span>
            <span />
            <span />
            <span className={styles.dim}>TOTAL</span>
            <span className={`${styles.n} ${styles.dim}`}>133?</span>
          </div>
        </div>

        {/* hand-drawn circle around the conflicting row */}
        <svg className={styles.scribble} viewBox="0 0 220 70" preserveAspectRatio="none">
          <motion.path
            d="M 20 38 C 18 12, 120 4, 196 14 C 222 20, 216 56, 170 62 C 110 70, 30 66, 14 48 C 8 40, 30 26, 60 22"
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.5 }}
          />
        </svg>
        <motion.span
          className={styles.mismatch}
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.6, ease: EASE_OUT, delay: 1.3 }}
        >
          <TriangleAlert size={11} strokeWidth={2.4} />
          {v('mismatch')}
        </motion.span>
      </div>

      {/* sticky note */}
      <motion.div
        className={styles.note}
        initial={{ opacity: 0, y: -14, rotate: 12 }}
        whileInView={{ opacity: 1, y: 0, rotate: 6 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.25 }}
      >
        <span className={styles.tape} />
        <span className={display.className}>{v('note')}</span>
      </motion.div>

      {/* the unanswered message */}
      <motion.div
        className={styles.chat}
        initial={{ opacity: 0, y: 18, scale: 0.96, rotate: -2 }}
        whileInView={{ opacity: 1, y: 0, scale: 1, rotate: -2 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.9 }}
      >
        <div className={styles.chatHead}>
          <span className={styles.chatAvatar}>B</span>
          <span className={styles.chatName}>{v('chatSender')}</span>
        </div>
        <p className={styles.chatMsg}>{v('chatMessage')}</p>
        <p className={styles.chatMeta}>
          {v('chatTime')}
          <CheckCheck size={13} strokeWidth={2} />
        </p>
      </motion.div>
    </div>
  );
}

export default function ProblemSection() {
  const { t } = useLanguage();
  const pains = [
    { icon: TriangleAlert, key: 'mismatch' },
    { icon: CircleHelp, key: 'disappear' },
    { icon: MapPin, key: 'location' },
    { icon: Clock, key: 'forever' },
  ];

  return (
    <section className="relative overflow-hidden">
      <GridBackdrop size={40} opacity={0.05} mask="radial-gradient(ellipse at 70% 45%, black 5%, transparent 65%)" />
      <ParallaxGlow className="absolute top-24 -left-24 h-80 w-80 rounded-full bg-red-500/[0.09] blur-[120px]" speed={0.18} />
      <ParallaxGlow className="absolute bottom-10 right-0 h-96 w-96 rounded-full bg-blue-600/[0.08] blur-[130px]" speed={-0.12} />

      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-24 sm:pt-32 pb-10 grid lg:grid-cols-[1fr_1.05fr] gap-14 lg:gap-16 items-center">
        <div>
          <Reveal>
            <SectionHeading index="01" eyebrow={t('landing.problem.eyebrow')} title={t('landing.problem.heading')} />
          </Reveal>
          <Stagger className="mt-10 border-t border-white/[0.07]">
            {pains.map(({ icon: Icon, key }) => (
              <StaggerItem key={key} className="flex gap-4 py-5 border-b border-white/[0.07]">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-300 ring-1 ring-inset ring-red-400/20">
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-semibold text-white">{t(`landing.problem.cards.${key}.title`)}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-white/60">{t(`landing.problem.cards.${key}.body`)}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>

        <Reveal delay={0.1}>
          <ChaosVisual />
        </Reveal>
      </div>

      {/* bridge into the solution */}
      <Reveal className="relative flex flex-col items-center pb-20 sm:pb-24">
        <span aria-hidden="true" className="h-16 w-px bg-[linear-gradient(180deg,transparent,rgba(96,165,250,0.6))]" />
        <p className="inline-flex items-center gap-2 rounded-full border border-blue-400/25 bg-blue-500/[0.08] px-4 py-2 text-sm font-medium text-blue-100 shadow-[0_0_40px_-8px_rgba(59,130,246,0.6)]">
          {t('landing.problem.bridge')}
          <ArrowDown size={14} strokeWidth={2.2} aria-hidden="true" className="text-blue-300" />
        </p>
      </Reveal>
    </section>
  );
}
