'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  BellRing,
  Camera,
  Car,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  FileText,
  History,
  LineChart,
  MapPin,
  Route,
  ScanBarcode,
  Smartphone,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { useTheme } from '@/app/context/ThemeContext';
import { EASE_OUT, ParallaxGlow, Reveal, SectionHeading, Stagger, StaggerItem, useAnimState } from './primitives';
import { SOLUTIONS, isSolutionKey, solutionByKey, type SolutionKey } from './solutions';
import styles from './Solutions.module.css';

/* ─── 02 · Solutions. The ecosystem at a glance: WareSys as the hub, four
   solutions as its spokes. Each spoke is a tab, and each tab speaks only to
   its own audience — the parent brand stays broad while Warehouse and
   Workshop keep their spare-parts and automotive credibility. Each shows a
   real screen of the product (public/landing, captured from a demo account
   with sample data). Every panel has a shareable link (/#workshop) and only
   the open one is mounted, so its image loads on demand. */

const FEATURES: Record<SolutionKey, { key: string; icon: LucideIcon }[]> = {
  warehouse: [
    { key: 'scan', icon: ScanBarcode },
    { key: 'transfers', icon: ArrowLeftRight },
    { key: 'tracking', icon: Activity },
    { key: 'roles', icon: Users },
    { key: 'audit', icon: History },
    { key: 'import', icon: FileSpreadsheet },
  ],
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

function Panel({ solution }: { solution: SolutionKey }) {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const s = (k: string) => t(`landing.solutions.${solution}.${k}`);
  const { ink, rgb } = solutionByKey(solution);

  return (
    <div style={{ '--zone': rgb } as CSSProperties} className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-14 items-start">
      <div className="min-w-0">
        <h3 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-white text-balance">{s('title')}</h3>
        <p className="mt-2.5 text-[15px] font-semibold" style={{ color: ink }}>
          {s('audience')}
        </p>
        <p className="mt-3 text-base leading-relaxed text-white/60">{s('body')}</p>
        <ul className="mt-8 grid gap-x-6 gap-y-6 sm:grid-cols-2">
          {FEATURES[solution].map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-3.5">
              <span className={styles.featureIcon} style={{ color: ink }}>
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-white">{s(`features.${key}.title`)}</p>
                <p className="mt-1 text-sm leading-relaxed text-white/60">{s(`features.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
        <a
          href="#contact"
          className="group mt-8 inline-flex items-center gap-2 text-sm font-semibold rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400"
          style={{ color: ink }}
        >
          {t('landing.nav.bookDemo')}
          <ArrowRight size={15} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
        </a>
      </div>
      <figure className="min-w-0">
        <Image
          src={`/landing/${solution}-${theme === 'dark' ? 'dark' : 'light'}.webp`}
          alt={s('shotAlt')}
          width={1279}
          height={1100}
          sizes="(min-width: 1024px) 600px, 100vw"
          className={styles.shot}
        />
        <figcaption className="mt-3 text-sm text-white/55">{t('landing.ecosystem.shotCaption')}</figcaption>
      </figure>
    </div>
  );
}

export default function Solutions() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const tabs = useRef<Partial<Record<SolutionKey, HTMLButtonElement | null>>>({});
  const anim = useAnimState(ref);
  const [active, setActive] = useState<SolutionKey>('warehouse');
  // The first panel is in the server HTML and must stay visible without
  // scripts; only a panel the visitor switched to fades in.
  const [switched, setSwitched] = useState(false);

  // #warehouse, #sales, #workshop and #delivery open their panel, from the
  // hero chips, the "who it's for" pills, or a link someone was sent. The
  // browser scrolls to the matching anchor below.
  useEffect(() => {
    const open = () => {
      const hash = window.location.hash.slice(1);
      if (!isSolutionKey(hash)) return;
      setSwitched(true);
      setActive(hash);
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  const select = (key: SolutionKey) => {
    setSwitched(true);
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
          <SectionHeading center title={t('landing.ecosystem.heading')} className="max-w-3xl" />
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
          <div role="tablist" aria-label={t('landing.nav.products')} className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {SOLUTIONS.map(({ key, icon: Icon, name, rgb, ink }, i) => {
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
                    <Icon size={18} strokeWidth={2} aria-hidden="true" style={{ color: ink }} />
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
          initial={switched ? { opacity: 0, y: 10 } : false}
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
