'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { display } from '@/lib/fonts';

export const SECTION_COUNT = '08';
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/* ─── Page-wide motion switch ────────────────────────────────────────
   One pause control (in the hero) stops every decorative CSS loop on the
   page — hero scene, marquee, bento demos, flow lines — which is what
   WCAG 2.2.2 asks for with auto-playing motion. Sections additionally
   pause themselves while offscreen, so nothing animates unseen. */
export const MotionPauseContext = createContext<{ paused: boolean; toggle: () => void }>({
  paused: false,
  toggle: () => {},
});

export const useMotionPause = () => useContext(MotionPauseContext);

/** `data-anim` value for a decorative-animation root: paused when the
 *  user paused motion or the element is offscreen. Pair with the global
 *  `[data-anim='paused']` rule in globals.css. */
export function useAnimState(ref: RefObject<Element | null>) {
  const { paused } = useMotionPause();
  const inView = useInView(ref, { margin: '120px 0px 120px 0px' });
  return paused || !inView ? 'paused' : 'running';
}

/* ─── Numbered mono section tag ─────────────────────────────────── */
export function Kicker({
  index,
  label,
  center = false,
  className = '',
}: {
  index: string;
  label: string;
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${center ? 'justify-center' : ''} ${className}`}>
      <span className="font-mono text-[10px] tracking-[0.2em] text-blue-200/90 px-2 py-1 rounded-full border border-blue-400/20 bg-blue-400/[0.07]">
        {index}/{SECTION_COUNT}
      </span>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">{label}</p>
    </div>
  );
}

/* ─── Section heading: kicker + gradient display title ────────────── */
export function SectionHeading({
  index,
  eyebrow,
  title,
  center = false,
  className = '',
  titleClassName = '',
}: {
  index: string;
  eyebrow: string;
  title: string;
  center?: boolean;
  className?: string;
  titleClassName?: string;
}) {
  return (
    <div className={`${center ? 'text-center mx-auto' : ''} ${className}`}>
      <Kicker index={index} label={eyebrow} center={center} />
      <h2
        className={`${display.className} mt-5 text-[2.1rem] leading-[1.04] sm:text-5xl lg:text-[3.4rem] font-semibold tracking-[-0.035em] text-balance bg-[linear-gradient(180deg,#fff_40%,rgba(255,255,255,0.6))] bg-clip-text text-transparent ${titleClassName}`}
      >
        {title}
      </h2>
    </div>
  );
}

/* ─── Scroll-triggered fade/rise reveal. Reduced motion is handled by
   <MotionConfig reducedMotion="user"> at the page root. ─────────── */
export function Reveal({
  children,
  className = '',
  delay = 0,
  y = 28,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.9, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

/* Staggered reveal for grids: children rise in sequence, 60ms apart. */
const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const staggerChild = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.75, ease: EASE_OUT } },
};

export function Stagger({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.12, margin: '0px 0px -8% 0px' }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={staggerChild}>
      {children}
    </motion.div>
  );
}

/* ─── Glass card with a cursor-following spotlight and lit border.
   Pointer position is written straight to CSS variables (no React
   re-render per mousemove). ────────────────────────────────────── */
export function SpotlightCard({
  children,
  className = '',
  glow = '96, 165, 250',
}: {
  children: ReactNode;
  className?: string;
  /** rgb triplet for the spotlight tint */
  glow?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || e.pointerType !== 'mouse') return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      }}
      style={{ '--glow': glow } as React.CSSProperties}
      className={`spotlight-card relative isolate overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── Blurred background glow that drifts slower than the page.
   Desktop only: on phones, moving several large blurred layers every
   scroll frame costs more than the effect is worth. ─────────────── */
export function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return desktop;
}

export function ParallaxGlow({ className, speed }: { className: string; speed: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const desktop = useIsDesktop();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [speed * 600, speed * -600]);
  return (
    <motion.div
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none ${className}`}
      style={reduce || !desktop ? undefined : { y }}
    />
  );
}

/* ─── Faint blueprint grid, masked so it fades out at the edges ───── */
export function GridBackdrop({
  size = 44,
  opacity = 0.07,
  mask = 'radial-gradient(ellipse at 50% 40%, black 10%, transparent 70%)',
}: {
  size?: number;
  opacity?: number;
  mask?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        opacity,
        backgroundImage:
          'linear-gradient(to right, #60a5fa 1px, transparent 1px), linear-gradient(to bottom, #60a5fa 1px, transparent 1px)',
        backgroundSize: `${size}px ${size}px`,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

/* ─── Luminous hairline between sections ──────────────────────────── */
export function SectionDivider() {
  return (
    <div aria-hidden="true" className="relative h-px w-full">
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.09),transparent)]" />
      <div className="absolute left-1/2 top-0 h-px w-[min(560px,70%)] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgba(96,165,250,0.5),transparent)]" />
      <div className="absolute left-1/2 -top-6 h-12 w-[min(420px,50%)] -translate-x-1/2 rounded-full bg-blue-500/[0.07] blur-2xl" />
    </div>
  );
}
