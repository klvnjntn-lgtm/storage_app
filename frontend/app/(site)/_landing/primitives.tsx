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

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/* ─── Page-wide motion switch ────────────────────────────────────────
   One pause control (in the hero) stops every decorative CSS loop on the
   page — hero scene, marquee, bento demos, flow lines — which is what
   WCAG 2.2.2 asks for with auto-playing motion. Sections additionally
   pause themselves while offscreen, so nothing animates unseen. */
export const MotionPauseContext = createContext<{ paused: boolean; lite: boolean; toggle: () => void }>({
  paused: false,
  lite: false,
  toggle: () => {},
});

export const useMotionPause = () => useContext(MotionPauseContext);

/* ─── Low-end device detection ───────────────────────────────────────
   True for Save-Data, ≤4 GB RAM, or ≤4 CPU cores. The page then runs in
   "lite" mode: loops start paused, no scroll parallax, and the big blur
   glows swap for cheap masked gradients (see `.landing[data-lite]`).
   Starts false so SSR and first paint match; flips after mount. */
type NavigatorHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

export function isLowEndDevice() {
  const nav = navigator as NavigatorHints;
  return (
    nav.connection?.saveData === true ||
    (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) ||
    (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4)
  );
}

export function useLowEndDevice() {
  const [lowEnd, setLowEnd] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only APIs once after mount
    if (isLowEndDevice()) setLowEnd(true);
  }, []);
  return lowEnd;
}

/** True when the browser can create a WebGL context. */
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/* ─── Hero tier ──────────────────────────────────────────────────────
   Decides how much of the hero a device gets, before three.js downloads:
     lite    static HeroLite only. Low-end hints, no WebGL, or a software
             renderer (no GPU, where the 3D scene would crawl).
     medium  3D with no shadows or reflections, at capped resolution. Phones
             and mid-range machines.
     high    the full scene.
   HeroCanvas's frame-rate watchdog corrects the guess at runtime. */
export type HeroQuality = 'high' | 'medium';

function softwareRenderer() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (!gl || !ext) return false;
    const name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software|microsoft basic render/i.test(name);
  } catch {
    return false;
  }
}

export function heroTier(): 'lite' | HeroQuality {
  if (isLowEndDevice() || !hasWebGL() || softwareRenderer()) return 'lite';
  const nav = navigator as NavigatorHints;
  const modest =
    window.matchMedia('(max-width: 767px), (pointer: coarse)').matches ||
    (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 6) ||
    (nav.deviceMemory !== undefined && nav.deviceMemory <= 6);
  return modest ? 'medium' : 'high';
}

/** `data-anim` value for a decorative-animation root: paused when the
 *  user paused motion or the element is offscreen. Pair with the global
 *  `[data-anim='paused']` rule in globals.css. */
export function useAnimState(ref: RefObject<Element | null>) {
  const { paused } = useMotionPause();
  const inView = useInView(ref, { margin: '120px 0px 120px 0px' });
  return paused || !inView ? 'paused' : 'running';
}

/* ─── Section heading ──────────────────────────────────────────── */
export function SectionHeading({
  title,
  center = false,
  className = '',
  titleClassName = '',
}: {
  title: string;
  center?: boolean;
  className?: string;
  titleClassName?: string;
}) {
  return (
    <div className={`${center ? 'text-center mx-auto' : ''} ${className}`}>
      <h2
        className={`${display.className} min-w-0 [overflow-wrap:break-word] text-[2.1rem] leading-[1.04] sm:text-5xl lg:text-[3.4rem] font-semibold tracking-[-0.035em] text-balance text-white ${titleClassName}`}
      >
        {title}
      </h2>
    </div>
  );
}

/* ─── Scroll-triggered reveal. Content is visible in the server HTML, so a
   slow device or a failed script never shows a blank page. Only after
   hydration does an element still below the fold hide itself, off screen,
   to fade in when reached. Reduced motion is handled by <MotionConfig> at
   the page root. ──────────────────────────────────────────────────── */
function useReveal<T extends Element>() {
  const ref = useRef<T>(null);
  const [armed, setArmed] = useState(false);
  const inView = useInView(ref, { once: true, amount: 0.12, margin: '0px 0px -8% 0px' });
  useEffect(() => {
    const el = ref.current;
    if (el && el.getBoundingClientRect().top > window.innerHeight) setArmed(true);
  }, []);
  return { ref, hidden: armed && !inView };
}

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
  const { ref, hidden } = useReveal<HTMLDivElement>();
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={false}
      animate={hidden ? { opacity: 0, y } : { opacity: 1, y: 0 }}
      transition={hidden ? { duration: 0 } : { duration: 0.9, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

/* Staggered reveal for grids: children rise in sequence, 70ms apart. */
const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const staggerChild = {
  hidden: { opacity: 0, y: 24, transition: { duration: 0 } },
  show: { opacity: 1, y: 0, transition: { duration: 0.75, ease: EASE_OUT } },
};

export function Stagger({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { ref, hidden } = useReveal<HTMLDivElement>();
  return (
    <motion.div ref={ref} className={className} variants={staggerParent} initial={false} animate={hidden ? 'hidden' : 'show'}>
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
      className={`spotlight-card relative isolate overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_0_rgb(var(--ink)/0.06)] ${className}`}
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
  const { lite } = useMotionPause();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [speed * 600, speed * -600]);
  return (
    <motion.div
      ref={ref}
      aria-hidden="true"
      className={`landing-glow pointer-events-none ${className}`}
      style={reduce || lite || !desktop ? undefined : { y }}
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
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(var(--ink)/0.09),transparent)]" />
      <div className="absolute left-1/2 top-0 h-px w-[min(560px,70%)] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgba(96,165,250,0.5),transparent)]" />
      <div className="absolute left-1/2 -top-6 h-12 w-[min(420px,50%)] -translate-x-1/2 rounded-full bg-blue-500/[0.07] blur-2xl landing-glow" />
    </div>
  );
}
