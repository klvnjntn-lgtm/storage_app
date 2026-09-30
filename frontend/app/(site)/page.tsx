'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronRight, Menu, X, ArrowUp, Pause, Play, Package, ReceiptText, Wrench, Truck } from 'lucide-react';
import {
  motion,
  MotionConfig,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion';
import { display } from '@/lib/fonts';
import { useLanguage } from '@/app/context/LanguageContext';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';
import ThemeToggle from '@/app/components/shared/ThemeToggle';
import { useTheme } from '@/app/context/ThemeContext';
import HeroScene from './_landing/HeroScene';
import FeatureBento from './_landing/FeatureBento';
import ProblemSection from './_landing/ProblemSection';
import HowItWorks from './_landing/HowItWorks';
import Ecosystem from './_landing/Ecosystem';
import { Contact, Faq, SiteFooter, TechMarquee, WhoItsFor, WhySection } from './_landing/Sections';
import {
  EASE_OUT,
  GridBackdrop,
  Kicker,
  MotionPauseContext,
  ParallaxGlow,
  useLowEndDevice,
  Reveal,
  SectionDivider,
  SectionHeading,
} from './_landing/primitives';

/* ─── Scroll-to-top with a progress ring. framer only does work while the
   page is actually scrolling. ─────────────────────────────────────── */
function ScrollProgressButton() {
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 30, restDelta: 0.001 });
  const [visible, setVisible] = useState(false);
  useMotionValueEvent(scrollY, 'change', (y) => setVisible(y > 600));

  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const offset = useTransform(progress, (p) => circumference - p * circumference);

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Scroll to top"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible || undefined}
      className={`fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-[rgb(var(--l-raised-rgb)/0.9)] backdrop-blur-md shadow-[0_10px_30px_-8px_var(--l-shadow)] transition-opacity duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" className="absolute -rotate-90">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="rgb(var(--ink) / 0.1)" strokeWidth="2" />
        <motion.circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" className="relative text-white" />
    </button>
  );
}

export default function LandingPage() {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  // null = the user hasn't touched the pause control; follow the device default.
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const heroRef = useRef<HTMLElement>(null);
  const lite = useLowEndDevice();
  const motionPaused = userPaused ?? lite;
  const toggleMotion = () => setUserPaused(!motionPaused);
  const reduceMotion = useReducedMotion() || lite;

  // Nav: transparent over the hero, solid once scrolled; slides away while
  // scrolling down and comes back on any upward scroll.
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (y) => {
    setScrolled(y > 24);
    setNavHidden(y > 160 && y > (scrollY.getPrevious() ?? 0));
  });

  // Hero depth: copy fades up and away while the scene lags behind.
  const { scrollYProgress: heroProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroTextY = useTransform(heroProgress, [0, 1], [0, 140]);
  const heroTextOpacity = useTransform(heroProgress, [0, 0.6], [1, 0]);
  const sceneY = useTransform(heroProgress, [0, 1], [0, 200]);
  const sceneScale = useTransform(heroProgress, [0, 1], [1, 0.92]);

  // Paint the whole document in the landing background while this page
  // is mounted so overscroll bounce and not-yet-painted tiles during fast
  // scrolls never flash the app's body colour behind the sections.
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const prev = els.map((el) => [el.style.background, el.style.colorScheme] as const);
    els.forEach((el) => {
      el.style.background = theme === 'dark' ? '#060a13' : '#f6f8fc';
      el.style.colorScheme = theme;
    });
    return () =>
      els.forEach((el, i) => {
        el.style.background = prev[i][0];
        el.style.colorScheme = prev[i][1];
      });
  }, [theme]);

  useEffect(() => {
    if (lite || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'smooth';
    return () => {
      html.style.scrollBehavior = prev;
    };
  }, [lite]);

  const navLinks = [
    { href: '#products', label: t('landing.nav.products') },
    { href: '#how-it-works', label: t('landing.nav.howItWorks') },
    { href: '#faq', label: t('landing.nav.faq') },
    { href: '#contact', label: t('landing.nav.contact') },
  ];

  return (
    <MotionConfig reducedMotion={lite ? 'always' : 'user'}>
    <MotionPauseContext.Provider value={{ paused: motionPaused, lite, toggle: toggleMotion }}>
    <main
      data-anim={motionPaused ? 'paused' : undefined}
      data-lite={lite ? '' : undefined}
      className="landing relative min-h-screen bg-[var(--l-bg)] text-white font-sans antialiased flex flex-col overflow-x-hidden selection:bg-blue-500/40"
    >
      {/* ─── NAV ─────────────────────────────────────────────── */}
      <motion.header
        initial={false}
        animate={{ y: navHidden && !menuOpen ? '-100%' : '0%' }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
        className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300 ${
          scrolled || menuOpen
            ? 'bg-[rgb(var(--l-bg-rgb)/0.85)] backdrop-blur-md border-white/10'
            : 'bg-transparent border-transparent'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 h-16 md:h-20 flex justify-between items-center gap-3">
          <Image
            src="/WARESYS.svg"
            alt="WareSys"
            width={360}
            height={84}
            className="landing-logo h-10 sm:h-12 md:h-16 w-auto shrink-0"
            priority
          />

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <nav className="hidden md:flex items-center gap-1 mr-2 text-sm font-medium text-white/70">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="px-3 py-2 rounded-md hover:text-white hover:bg-white/5 transition focus-visible:outline-2 focus-visible:outline-blue-400"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <a
              href="#contact"
              className="hidden sm:inline-flex text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-white/15 text-white hover:bg-white/10 hover:border-white/30 font-medium transition whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
            >
              {t('landing.nav.bookDemo')}
            </a>
            <Link
              href="/login"
              className="dark-island text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 sm:py-2 min-h-9 inline-flex items-center rounded-md bg-blue-600 text-white hover:bg-blue-500 font-medium transition whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
            >
              {t('landing.nav.login')}
            </Link>
            <LanguageSwitcher dark className="hidden sm:block" />
            <ThemeToggle dark className="h-9 w-9 sm:h-[30px] sm:w-[30px]" />
            <button
              onClick={() => setMenuOpen((v) => !v)}
              type="button"
              aria-label={t('landing.nav.toggleMenu')}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-menu"
              className="md:hidden p-2.5 rounded-md border border-white/15 text-white hover:bg-white/10 transition shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
            >
              {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        <div
          id="landing-mobile-menu"
          inert={!menuOpen}
          className={`md:hidden overflow-hidden transition-all duration-300 ${
            menuOpen ? 'max-h-96 opacity-100 border-t border-white/10' : 'max-h-0 opacity-0'
          }`}
        >
          <nav className="flex flex-col px-4 sm:px-6 py-2 text-sm font-medium text-white/80">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="py-3 border-b border-white/10 hover:text-white transition focus-visible:outline-2 focus-visible:outline-blue-400"
              >
                {link.label}
              </a>
            ))}
            <a
              href="#contact"
              onClick={() => setMenuOpen(false)}
              className="py-3 hover:text-white transition focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              {t('landing.nav.bookDemo')}
            </a>
            <div className="py-3">
              <LanguageSwitcher dark inline />
            </div>
          </nav>
        </div>
      </motion.header>

      {/* ─── HERO ────────────────────────────────────────────── */}
      <section ref={heroRef} className="relative overflow-hidden">
        <GridBackdrop size={44} opacity={0.08} mask="radial-gradient(ellipse at 65% 45%, black 15%, transparent 75%)" />
        <ParallaxGlow
          className="absolute top-[15%] right-[10%] h-[28rem] w-[28rem] rounded-full bg-blue-600/20 blur-[140px]"
          speed={0.25}
        />

        <motion.div
          style={reduceMotion ? { y: 0, opacity: 1 } : { y: heroTextY, opacity: heroTextOpacity }}
          className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-28 sm:pt-32 lg:pt-24 lg:pb-12 lg:min-h-svh flex items-center"
        >
          <div className="max-w-md animate-hero-in motion-reduce:animate-none">
            <Kicker index="00" label={t('landing.hero.eyebrow')} className="mb-5 sm:mb-6" />
            <h1 className={`${display.className} text-[2.5rem] sm:text-6xl xl:text-7xl font-bold tracking-[-0.035em] leading-[0.98] mb-6 sm:mb-7`}>
              {t('landing.hero.headline')}
            </h1>
            <p className="text-white/60 text-base leading-relaxed mb-3">{t('landing.hero.sub1')}</p>
            <p className="text-white/60 text-base leading-relaxed mb-6">{t('landing.hero.sub2')}</p>
            <a
              href="#products"
              className="group mb-8 sm:mb-10 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400"
            >
              <span className="w-full text-[11px] font-mono uppercase tracking-[0.14em] text-white/45 group-hover:text-white/70 transition">
                {t('landing.hero.platformLabel')}
              </span>
              {[
                { icon: Package, label: t('landing.hero.platformWarehouse') },
                { icon: ReceiptText, label: t('landing.hero.platformInvoice') },
                { icon: Wrench, label: t('landing.hero.platformWorkshop') },
                { icon: Truck, label: t('landing.hero.platformDelivery') },
              ].map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-white/75 group-hover:border-white/25 transition"
                >
                  <Icon size={12} strokeWidth={2.2} aria-hidden="true" className="text-blue-300" />
                  {label}
                </span>
              ))}
            </a>
            <div className="flex gap-3 flex-wrap">
              <a
                href="#contact"
                className="dark-island flex items-center gap-1.5 text-sm px-5 py-3 rounded-md bg-blue-600 text-white hover:bg-blue-500 font-bold transition shadow-[0_0_0_1px_rgba(147,197,253,0.35)_inset,0_10px_32px_-8px_rgba(37,99,235,0.85)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                {t('landing.hero.ctaDemo')} <ChevronRight size={15} aria-hidden="true" />
              </a>
              <a
                href="#how-it-works"
                className="flex items-center gap-1.5 text-sm px-5 py-3 rounded-md border border-white/15 hover:bg-white/5 hover:border-white/30 font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                {t('landing.hero.ctaHowItWorks')}
              </a>
            </div>
          </div>
        </motion.div>

        <div className="relative h-[300px] sm:h-[470px] lg:absolute lg:inset-y-0 lg:right-0 lg:h-auto lg:w-[60%] pointer-events-none">
          <motion.div style={reduceMotion ? { y: 0, scale: 1 } : { y: sceneY, scale: sceneScale }} className="absolute inset-0">
            <div className="dark-island absolute left-[53%] lg:left-[60%] xl:left-[52%] top-1/2 lg:top-[52%] -translate-x-1/2 -translate-y-1/2 scale-[0.4] sm:scale-[0.64] lg:scale-[0.56] xl:scale-[0.84] 2xl:scale-[0.96]">
              <HeroScene />
            </div>
          </motion.div>
        </div>

        {/* one control pauses every decorative loop on the page (WCAG 2.2.2) */}
        <button
          type="button"
          onClick={toggleMotion}
          aria-label={motionPaused ? t('landing.hero.playAnimation') : t('landing.hero.pauseAnimation')}
          title={motionPaused ? t('landing.hero.playAnimation') : t('landing.hero.pauseAnimation')}
          className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 z-20 grid h-10 w-10 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-white/70 backdrop-blur-md transition hover:bg-white/10 hover:text-white motion-reduce:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
        >
          {motionPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
      </section>

      <TechMarquee />

      <ProblemSection />

      <SectionDivider />

      {/* ─── 02 · FEATURES ───────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <ParallaxGlow className="absolute -top-32 right-0 h-[30rem] w-[30rem] rounded-full bg-blue-600/[0.12] blur-[140px]" speed={0.18} />
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32">
          <Reveal className="mb-14 sm:mb-16">
            <SectionHeading index="02" eyebrow={t('landing.features.eyebrow')} title={t('landing.features.heading')} className="max-w-3xl" />
          </Reveal>
          <FeatureBento />
        </div>
      </section>

      <SectionDivider />
      <HowItWorks />
      <SectionDivider />
      <Ecosystem />
      <SectionDivider />
      <WhoItsFor />
      <SectionDivider />
      <WhySection />
      <SectionDivider />
      <Faq />
      <Contact />
      <SiteFooter />

      <ScrollProgressButton />
    </main>
    </MotionPauseContext.Provider>
    </MotionConfig>
  );
}
