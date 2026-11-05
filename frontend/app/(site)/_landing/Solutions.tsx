'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BellRing,
  Camera,
  Car,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  FileText,
  LineChart,
  MapPin,
  Route,
  Smartphone,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { EASE_OUT, ParallaxGlow, Reveal, SectionHeading, Stagger, StaggerItem, useAnimState } from './primitives';
import { SOLUTIONS, isSolutionKey, solutionByKey, type SolutionKey } from './solutions';
import styles from './Solutions.module.css';

// The bento is the page's heaviest section; split it out of the first load.
const FeatureBento = dynamic(() => import('./FeatureBento'));

/* ─── 02 · Solutions. The ecosystem at a glance: WareSys as the hub, four
   solutions as its spokes. Each spoke is a tab, and each tab speaks only to
   its own audience — the parent brand stays broad while Warehouse and
   Workshop keep their spare-parts and automotive credibility. Every panel
   has a shareable link (/#workshop) and only the open one is mounted. */

const FEATURES: Record<Exclude<SolutionKey, 'warehouse'>, { key: string; icon: LucideIcon }[]> = {
  sales: [
    { key: 'documents', icon: FileText },
    { key: 'payments', icon: CreditCard },
    { key: 'tax', icon: FileSpreadsheet },
    { key: 'margin', icon: LineChart },
  ],
  workshop: [
    { key: 'workOrders', icon: ClipboardList },
    { key: 'vehicles', icon: Car },
    { key: 'mechanic', icon: Smartphone },
    { key: 'reminders', icon: BellRing },
  ],
  delivery: [
    { key: 'routes', icon: Route },
    { key: 'driver', icon: Smartphone },
    { key: 'monitoring', icon: MapPin },
    { key: 'proof', icon: Camera },
  ],
};

function MockFrame({ title, badge, children }: { title: string; badge: string; children: ReactNode }) {
  return (
    <div className={styles.mock} aria-hidden="true">
      <div className={styles.mockHead}>
        <span className={styles.mono}>{title}</span>
        <span className={styles.mockBadge}>
          <CheckCircle2 size={12} strokeWidth={2.4} />
          {badge}
        </span>
      </div>
      {children}
    </div>
  );
}

function SalesMock() {
  const { t } = useLanguage();
  const m = (k: string) => t(`landing.solutions.sales.mock.${k}`);
  return (
    <MockFrame title="INV-2291" badge={m('paid')}>
      <div className={styles.mockRow}><span>{m('line1')}</span><b>Rp 1.800.000</b></div>
      <div className={styles.mockRow}><span>{m('line2')}</span><b>Rp 650.000</b></div>
      <div className={`${styles.mockRow} ${styles.mockTotal}`}><span>{m('total')}</span><b>Rp 2.450.000</b></div>
      <div className={styles.mockSplit}>
        <i style={{ flexBasis: '60%' }} />
        <i style={{ flexBasis: '40%' }} />
      </div>
      <div className={styles.mockRow}><span>{m('transfer')} 60%</span><span>{m('cash')} 40%</span></div>
    </MockFrame>
  );
}

function WorkshopMock() {
  const { t } = useLanguage();
  const m = (k: string) => t(`landing.solutions.workshop.mock.${k}`);
  return (
    <MockFrame title="WO-118" badge={m('status')}>
      <div className={styles.mockRow}><span className={styles.plate}>B 1234 KJT</span><span>40.000 km</span></div>
      <div className={styles.mockRow}><span><Wrench size={12} strokeWidth={2.2} /> {m('job')}</span><b>Rina</b></div>
      <div className={styles.mockRow}><span>{m('part1')}</span><span className={styles.mono}>×1</span></div>
      <div className={styles.mockRow}><span>{m('part2')}</span><span className={styles.mono}>×4L</span></div>
      <div className={`${styles.mockRow} ${styles.mockTotal}`}><span>{m('next')}</span><b>45.000 km</b></div>
    </MockFrame>
  );
}

function DeliveryMock() {
  const { t } = useLanguage();
  const m = (k: string) => t(`landing.solutions.delivery.mock.${k}`);
  const stops = [
    { name: m('stop1'), done: true },
    { name: m('stop2'), done: true },
    { name: m('stop3'), done: true },
    { name: m('stop4'), done: false },
  ];
  return (
    <MockFrame title="R-12 · DO-0418" badge="3 / 4">
      <ol className={styles.stops}>
        {stops.map((s, i) => (
          <li key={s.name} className={s.done ? styles.stopDone : ''}>
            <span className={styles.stopDot}>{i + 1}</span>
            <span className="flex-1">{s.name}</span>
            {s.done && <Camera size={12} strokeWidth={2.2} />}
          </li>
        ))}
      </ol>
    </MockFrame>
  );
}

const MOCKS = { sales: SalesMock, workshop: WorkshopMock, delivery: DeliveryMock };

function Panel({ solution }: { solution: SolutionKey }) {
  const { t } = useLanguage();
  const s = (k: string) => t(`landing.solutions.${solution}.${k}`);
  const { name, hex, rgb } = solutionByKey(solution);
  const tint = { '--zone': rgb } as CSSProperties;

  const intro = (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: hex }}>
        {name} · {s('audience')}
      </p>
      <h3 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-white text-balance">{s('title')}</h3>
      <p className="mt-3 text-base leading-relaxed text-white/60">{s('body')}</p>
    </div>
  );

  if (solution === 'warehouse') {
    return (
      <>
        {intro}
        <div className="mt-8">
          <FeatureBento />
        </div>
      </>
    );
  }

  const Mock = MOCKS[solution];
  return (
    <div style={tint} className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-14 items-center">
      <div>
        {intro}
        <ul className="mt-8 grid gap-x-6 gap-y-6 sm:grid-cols-2">
          {FEATURES[solution].map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-3.5">
              <span className={styles.featureIcon}>
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
              </span>
              <div>
                <p className="font-semibold text-white">{s(`features.${key}.title`)}</p>
                <p className="mt-1 text-sm leading-relaxed text-white/60">{s(`features.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
        <a
          href="#contact"
          className="group mt-8 inline-flex items-center gap-2 text-sm font-semibold rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400"
          style={{ color: hex }}
        >
          {t('landing.nav.bookDemo')}
          <ArrowRight size={15} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
        </a>
      </div>
      <Mock />
    </div>
  );
}

export default function Solutions() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const tabs = useRef<Partial<Record<SolutionKey, HTMLButtonElement | null>>>({});
  const anim = useAnimState(ref);
  const [active, setActive] = useState<SolutionKey>('warehouse');

  // #warehouse, #sales, #workshop and #delivery open their panel, from the
  // hero chips, the "who it's for" pills, or a link someone was sent. The
  // browser scrolls to the matching anchor below.
  useEffect(() => {
    const open = () => {
      const hash = window.location.hash.slice(1);
      if (isSolutionKey(hash)) setActive(hash);
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  const select = (key: SolutionKey) => {
    setActive(key);
    window.history.replaceState(null, '', `#${key}`);
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = SOLUTIONS[(i + step + SOLUTIONS.length) % SOLUTIONS.length].key;
    select(next);
    tabs.current[next]?.focus();
  };

  return (
    <section id="products" className="relative overflow-hidden scroll-mt-16 md:scroll-mt-20">
      {SOLUTIONS.map(({ key }) => (
        <span key={key} id={key} aria-hidden="true" className="absolute top-0 scroll-mt-16 md:scroll-mt-20" />
      ))}
      <ParallaxGlow className="absolute top-40 left-1/2 -ml-72 h-[36rem] w-[36rem] rounded-full bg-blue-600/[0.10] blur-[150px]" speed={0.1} />
      <div ref={ref} data-anim={anim} className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <Reveal>
          <SectionHeading center index="02" eyebrow={t('landing.ecosystem.eyebrow')} title={t('landing.ecosystem.heading')} className="max-w-3xl" />
          <p className="mx-auto mt-5 max-w-xl text-center text-base sm:text-lg leading-relaxed text-white/60">{t('landing.ecosystem.sub')}</p>
        </Reveal>

        {/* connectors (desktop): the brand above, one spoke to each solution */}
        <div aria-hidden="true" className="mt-14 hidden lg:block">
          <p className="text-center text-sm font-semibold tracking-tight text-white">
            WareSys <span className="font-normal text-white/50">· {t('landing.ecosystem.hubCaption')}</span>
          </p>
          <svg className={styles.wires} viewBox="0 0 1000 80" preserveAspectRatio="none">
            {['M 500 0 C 500 40, 125 30, 125 80', 'M 500 0 C 500 40, 375 30, 375 80', 'M 500 0 C 500 40, 625 30, 625 80', 'M 500 0 C 500 40, 875 30, 875 80'].map((d) => (
              <g key={d}>
                <path d={d} className={styles.wireBase} />
                <path d={d} className={styles.wireFlow} />
              </g>
            ))}
          </svg>
        </div>

        <Stagger className="mt-10 lg:mt-0">
          <div role="tablist" aria-label={t('landing.ecosystem.eyebrow')} className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {SOLUTIONS.map(({ key, icon: Icon, name, rgb, hex }, i) => {
              const on = active === key;
              return (
                <StaggerItem key={key}>
                  <button
                    ref={(el) => {
                      tabs.current[key] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`solution-tab-${key}`}
                    aria-selected={on}
                    aria-controls={`solution-panel-${key}`}
                    tabIndex={on ? 0 : -1}
                    onClick={() => select(key)}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    style={{ '--zone': rgb } as CSSProperties}
                    className={`${styles.tab} ${on ? styles.tabOn : ''} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400`}
                  >
                    <Icon size={18} strokeWidth={2} aria-hidden="true" style={{ color: hex }} />
                    <span className="mt-3 block text-[15px] font-semibold tracking-[-0.01em] text-white">{name}</span>
                    <span className="mt-1 block text-[13px] leading-snug text-white/55">{t(`landing.ecosystem.products.${key}.tag`)}</span>
                  </button>
                </StaggerItem>
              );
            })}
          </div>
        </Stagger>

        {/* framer rather than a CSS animation: the page's motion pause would
            freeze a CSS fade-in at opacity 0, leaving the panel invisible */}
        <motion.div
          role="tabpanel"
          id={`solution-panel-${active}`}
          aria-labelledby={`solution-tab-${active}`}
          key={active}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT }}
          className="mt-10 sm:mt-14"
        >
          <Panel solution={active} />
        </motion.div>
      </div>
    </section>
  );
}
