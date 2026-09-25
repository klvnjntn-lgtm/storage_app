'use client';

import { useRef } from 'react';
import { Package, ReceiptText, Wrench, Warehouse, Check } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { ParallaxGlow, Reveal, SectionHeading, SpotlightCard, Stagger, StaggerItem, useAnimState } from './primitives';
import styles from './Ecosystem.module.css';

/* ─── 04 · Ecosystem. WareSys as the hub, the three products as live
   spokes. Data "flows" down the connectors (dash offset, desktop only,
   paused offscreen). Each card carries a one-line preview of what that
   product actually shows. ─────────────────────────────────────────── */

function Preview({ kind }: { kind: 'warehouse' | 'invoice' | 'workshop' }) {
  const { t } = useLanguage();
  if (kind === 'warehouse') {
    return (
      <div className={styles.preview} aria-hidden="true">
        <span className={styles.mono}>BRK-2041</span>
        <span className={styles.previewText}>{t('landing.scene.items.brakePads')}</span>
        <span className={styles.previewMeta}>B-11</span>
        <span className={styles.previewNum}>48</span>
      </div>
    );
  }
  if (kind === 'invoice') {
    return (
      <div className={styles.preview} aria-hidden="true">
        <span className={styles.mono}>INV-2291</span>
        <span className={styles.previewText}>Rp 2.450.000</span>
        <span className={styles.paid}>
          <Check size={11} strokeWidth={3} />
        </span>
      </div>
    );
  }
  return (
    <div className={styles.preview} aria-hidden="true">
      <span className={styles.plate}>B 1234 KJT</span>
      <span className={styles.previewText}>40.000 km</span>
      <span className={styles.previewMeta}>
        <Wrench size={11} strokeWidth={2.2} />
      </span>
    </div>
  );
}

export default function Ecosystem() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const anim = useAnimState(ref);

  const products = [
    { kind: 'warehouse' as const, icon: Package, name: 'WareSys Warehouse' },
    { kind: 'invoice' as const, icon: ReceiptText, name: 'Invoice POS' },
    { kind: 'workshop' as const, icon: Wrench, name: 'Workshop RMS' },
  ];

  return (
    <section className="relative overflow-hidden">
      <ParallaxGlow className="absolute top-40 left-1/2 -ml-72 h-[36rem] w-[36rem] rounded-full bg-blue-600/[0.10] blur-[150px]" speed={0.1} />
      <div ref={ref} data-anim={anim} className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <Reveal>
          <SectionHeading
            center
            index="04"
            eyebrow={t('landing.ecosystem.eyebrow')}
            title={t('landing.ecosystem.heading')}
            className="max-w-3xl"
          />
        </Reveal>

        {/* hub */}
        <Reveal className="mt-16 flex flex-col items-center" delay={0.1}>
          <div className={styles.hub} aria-hidden="true">
            <span className={styles.ring} />
            <span className={`${styles.ring} ${styles.ring2}`} />
            <span className={styles.hubCore}>
              <Warehouse size={26} strokeWidth={2} />
            </span>
          </div>
          <p className="mt-5 text-sm font-semibold tracking-tight text-white">WareSys</p>
          <p className="mt-1 text-sm text-white/55">{t('landing.ecosystem.hubCaption')}</p>
        </Reveal>

        {/* connectors (desktop): hub → each card */}
        <svg className={styles.wires} viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="eco-wire" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#60a5fa" stopOpacity="0.9" />
              <stop offset="1" stopColor="#60a5fa" stopOpacity="0.15" />
            </linearGradient>
          </defs>
          {['M 500 0 C 500 60, 167 50, 167 120', 'M 500 0 L 500 120', 'M 500 0 C 500 60, 833 50, 833 120'].map((d) => (
            <g key={d}>
              <path d={d} className={styles.wireBase} />
              <path d={d} className={styles.wireFlow} />
            </g>
          ))}
        </svg>

        <Stagger className="mt-10 lg:mt-0 grid gap-4 md:grid-cols-3">
          {products.map(({ kind, icon: Icon, name }) => (
            <StaggerItem key={kind}>
              <SpotlightCard className="h-full p-6 sm:p-7 flex flex-col">
                <div className="flex items-center justify-between gap-3">
                  <span className={styles.productIcon}>
                    <Icon size={18} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                    <span aria-hidden="true" className={styles.liveDot} />
                    {t('landing.ecosystem.statusLive')}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-[-0.01em] text-white">{name}</h3>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-blue-300/90">
                  {t(`landing.ecosystem.products.${kind}.tag`)}
                </p>
                <p className="mt-3 text-[15px] leading-relaxed text-white/60">
                  {t(`landing.ecosystem.products.${kind}.body`)}
                </p>
                <div className="mt-auto pt-6">
                  <Preview kind={kind} />
                </div>
              </SpotlightCard>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
