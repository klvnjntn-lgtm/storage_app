'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import {
  Inbox,
  ArrowLeftRight,
  BarChart2,
  MessageCircle,
  Mail,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Menu,
  X,
  ArrowUp,
  ScanLine,
  Check,
  Users,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  MapPin,
  Clock,
  Package,
  Wrench,
  Building2,
  ReceiptText,
} from 'lucide-react';
import Image from "next/image";
import { useLanguage } from '@/app/context/LanguageContext';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

const SECTION_COUNT = '08';

/* ─── Numbered mono section tag — same "system label" language as the
   terminal feed / marquee, applied consistently to every section so the
   whole page reads as one technical spec sheet, not just the contact
   block. ────────────────────────────────────────────────────────── */
function Kicker({
  index,
  label,
  variant = 'light',
  center = false,
  className = 'mb-2',
}: {
  index: string;
  label: string;
  variant?: 'light' | 'dark';
  center?: boolean;
  className?: string;
}) {
  const dark = variant === 'dark';
  return (
    <div className={`flex items-center gap-2 ${center ? 'justify-center' : ''} ${className}`}>
      <span
        className={`font-mono text-[10px] tracking-widest px-1.5 py-0.5 rounded border ${
          dark
            ? 'text-blue-300/70 border-blue-400/25 bg-blue-400/5'
            : 'text-blue-600/70 border-blue-500/25 bg-blue-600/5'
        }`}
      >
        {index}/{SECTION_COUNT}
      </span>
      <p
        className={`text-xs font-semibold uppercase tracking-widest ${
          dark ? 'text-blue-400' : 'text-blue-600'
        }`}
      >
        {label}
      </p>
    </div>
  );
}

/* ─── Live scan feed (hero terminal) ───────────────────────── */
function TerminalFeed() {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(1);

  const SCAN_LOG = [
    { time: '09:14:02', text: t('landing.scanFeed.line1') },
    { time: '09:14:19', text: t('landing.scanFeed.line2') },
    { time: '09:15:03', text: t('landing.scanFeed.line3') },
    { time: '09:15:44', text: t('landing.scanFeed.line4') },
    { time: '09:16:10', text: t('landing.scanFeed.line5') },
    { time: '09:16:58', text: t('landing.scanFeed.line6') },
    { time: '09:17:22', text: t('landing.scanFeed.line7') },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible((v) => (v >= SCAN_LOG.length ? 1 : v + 1));
    }, 1400);
    return () => clearInterval(timer);
  }, [SCAN_LOG.length]);

  return (
    <div className="border border-blue-500/20 rounded-xl overflow-hidden bg-[#0B1220] shadow-lg shadow-blue-900/10">
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-blue-400/10">
        <span className="w-2.5 h-2.5 rounded-full bg-blue-400/20" />
        <span className="w-2.5 h-2.5 rounded-full bg-blue-400/20" />
        <span className="w-2.5 h-2.5 rounded-full bg-blue-400/20" />
        <span className="ml-3 text-[11px] sm:text-xs font-mono text-blue-200/40 truncate">
          {t('landing.scanFeed.terminalLabel')}
        </span>
      </div>
      <div className="px-4 sm:px-5 py-4 sm:py-5 font-mono text-[11px] sm:text-[13px] leading-6 h-[230px] sm:h-[260px] overflow-hidden">
        {SCAN_LOG.slice(0, visible).map((line) => (
          <div key={line.time} className="text-blue-100/80">
            <span className="text-blue-400/50">[{line.time}]</span> {line.text}
          </div>
        ))}
        <span className="inline-block w-2 h-3.5 bg-blue-400/70 align-middle animate-pulse ml-0.5" />
      </div>
    </div>
  );
}

/* ─── Scrolling tech-capability marquee ────────────────────── */
function TechMarquee() {
  const { t } = useLanguage();
  const TECH_TAGS = [
    t('landing.techMarquee.tags.barcodeScanning'),
    t('landing.techMarquee.tags.realTimeSync'),
    t('landing.techMarquee.tags.roleBasedAccess'),
    t('landing.techMarquee.tags.auditTrail'),
    t('landing.techMarquee.tags.multiLocationTracking'),
    t('landing.techMarquee.tags.transferHistory'),
    t('landing.techMarquee.tags.liveStockCounts'),
  ];
  const doubled = [...TECH_TAGS, ...TECH_TAGS];
  return (
    <div className="border-b border-blue-500/15 bg-[#0B1220] overflow-hidden">
      <div className="flex whitespace-nowrap py-3 marquee-track">
        {doubled.map((tag, i) => (
          <span
            key={i}
            className="flex items-center text-[11px] sm:text-xs font-mono uppercase tracking-widest text-blue-200/50 mx-4"
          >
            {tag}
            <span className="mx-4 text-blue-500">•</span>
          </span>
        ))}
      </div>
      <style jsx>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .marquee-track {
          width: max-content;
          animation: marquee 24s linear infinite;
        }
      `}</style>
    </div>
  );
}

/* ─── "How it works" connected pipeline ─────────────────────
   Numbered nodes on a rail instead of a button grid — a different
   mechanic from the card/list patterns used elsewhere on the page. Each
   stage gets its own accent color, echoing the same emerald/blue/violet
   story used in the "Who it's for" tiles. ─────────────────── */
function HowItWorksStepper() {
  const { t } = useLanguage();
  const STEPS = [
    {
      step: '01',
      icon: Inbox,
      title: t('landing.howItWorks.steps.receive.title'),
      body: t('landing.howItWorks.steps.receive.body'),
      node: 'bg-emerald-600 border-emerald-600 shadow-emerald-600/30',
      panel: 'border-emerald-500/30',
      iconBg: 'bg-emerald-600/5 border-emerald-500/20',
      iconColor: 'text-emerald-700',
    },
    {
      step: '02',
      icon: ArrowLeftRight,
      title: t('landing.howItWorks.steps.move.title'),
      body: t('landing.howItWorks.steps.move.body'),
      node: 'bg-blue-600 border-blue-600 shadow-blue-600/30',
      panel: 'border-blue-500/30',
      iconBg: 'bg-blue-600/5 border-blue-500/20',
      iconColor: 'text-blue-700',
    },
    {
      step: '03',
      icon: BarChart2,
      title: t('landing.howItWorks.steps.track.title'),
      body: t('landing.howItWorks.steps.track.body'),
      node: 'bg-violet-600 border-violet-600 shadow-violet-600/30',
      panel: 'border-violet-500/30',
      iconBg: 'bg-violet-600/5 border-violet-500/20',
      iconColor: 'text-violet-700',
    },
  ];

  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setActive((a) => (a + 1) % STEPS.length), 4000);
    return () => clearInterval(timer);
  }, [paused, STEPS.length]);

  const current = STEPS[active];
  const ActiveIcon = current.icon;

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="relative mb-6 sm:mb-8">
        <div className="absolute top-5 left-[16.666%] right-[16.666%] h-0.5 bg-blue-500/15 hidden sm:block" />
        <div
          className="absolute top-5 left-[16.666%] h-0.5 bg-blue-600 transition-all duration-700 ease-out hidden sm:block"
          style={{ width: `${(active / (STEPS.length - 1)) * 66.667}%` }}
        />

        <div className="relative grid grid-cols-3 gap-2 sm:gap-4">
          {STEPS.map((s, i) => {
            const isActive = i === active;
            const isDone = i < active;
            return (
              <button
                key={s.step}
                onClick={() => setActive(i)}
                className="flex flex-col items-center text-center group"
              >
                <span
                  className={`relative z-10 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border-2 font-mono text-xs font-bold transition-all duration-300 ${
                    isActive
                      ? `${s.node} text-white scale-110 shadow-lg`
                      : isDone
                        ? `${s.node} text-white`
                        : 'bg-white border-blue-500/25 text-gray-400 group-hover:border-blue-500/50'
                  }`}
                >
                  {isDone ? <Check size={14} strokeWidth={3} /> : s.step}
                </span>
                <p
                  className={`mt-2.5 text-xs sm:text-sm font-bold transition-colors ${
                    isActive ? 'text-black' : 'text-gray-400'
                  }`}
                >
                  {s.title}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`bg-white border rounded-xl p-6 sm:p-8 flex items-start gap-4 sm:gap-5 transition-colors duration-300 ${current.panel}`}
      >
        <div className={`shrink-0 p-2.5 sm:p-3 border rounded-lg ${current.iconBg}`}>
          <ActiveIcon size={20} strokeWidth={2} className={current.iconColor} />
        </div>
        <div>
          <p className="font-bold text-base mb-1.5">{current.title}</p>
          <p className="text-sm text-gray-500 leading-relaxed max-w-xl">{current.body}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Ecosystem carousel ────────────────────────────────────── */
type EcosystemProduct = {
  icon: typeof Inbox;
  name: string;
  tag: string;
  body: string;
  status: 'Live' | 'Coming soon';
  statusLabel: string;
};

function EcosystemCarousel({ products }: { products: EcosystemProduct[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || products.length <= 1) return;
    const timer = setInterval(() => setActive((a) => (a + 1) % products.length), 4500);
    return () => clearInterval(timer);
  }, [paused, products.length]);

  const go = (i: number) => setActive(((i % products.length) + products.length) % products.length);

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="relative overflow-hidden rounded-xl border border-blue-500/20 bg-white shadow-sm">
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${active * 100}%)` }}
        >
          {products.map(({ icon: Icon, name, tag, body, status, statusLabel }) => (
            <div key={name} className="w-full shrink-0 p-6 sm:p-10">
              <div className="flex items-start justify-between gap-4 mb-5 sm:mb-6">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0 p-2.5 border border-blue-500/20 rounded-lg bg-blue-600/5">
                    <Icon size={22} strokeWidth={2} className="text-blue-700" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-base sm:text-lg truncate">{name}</p>
                    <p className="text-xs text-gray-400">{tag}</p>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-md border shrink-0 ${
                    status === 'Live'
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-blue-100 text-blue-800 border-blue-300'
                  }`}
                >
                  {statusLabel}
                </span>
              </div>
              <p className="text-sm text-gray-500 leading-relaxed max-w-lg">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <span className="font-mono text-[11px] text-gray-400 tracking-widest">
          {String(active + 1).padStart(2, '0')} / {String(products.length).padStart(2, '0')}
        </span>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            {products.map((p, i) => (
              <button
                key={p.name}
                onClick={() => go(i)}
                aria-label={`Go to ${p.name}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === active ? 'w-5 bg-blue-600' : 'w-1.5 bg-blue-500/25 hover:bg-blue-500/40'
                }`}
              />
            ))}
          </div>
          <button
            onClick={() => go(active - 1)}
            aria-label="Previous"
            className="p-1.5 rounded-md border border-blue-500/20 hover:bg-blue-50 hover:border-blue-500/40 transition"
          >
            <ChevronLeft size={14} strokeWidth={2} className="text-blue-700" />
          </button>
          <button
            onClick={() => go(active + 1)}
            aria-label="Next"
            className="p-1.5 rounded-md border border-blue-500/20 hover:bg-blue-50 hover:border-blue-500/40 transition"
          >
            <ChevronRight size={14} strokeWidth={2} className="text-blue-700" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── FAQ accordion ─────────────────────────────────────────── */
function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);

  return (
    <div>
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className="border-b border-blue-500/10 last:border-0">
            <button
              onClick={() => setOpen(isOpen ? -1 : i)}
              className="w-full flex items-start gap-3 py-4 sm:py-5 text-left"
              aria-expanded={isOpen}
            >
              <span className="font-mono text-[11px] text-blue-600/60 mt-0.5 shrink-0">
                Q{String(i + 1).padStart(2, '0')}
              </span>
              <span className="flex-1 font-bold text-sm">{item.q}</span>
              <ChevronDown
                size={16}
                strokeWidth={2}
                className={`shrink-0 mt-0.5 text-blue-600/60 transition-transform duration-200 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            <div
              className={`grid transition-all duration-200 ease-out ${
                isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <p className="text-sm text-gray-500 leading-relaxed pb-4 sm:pb-5 pl-9">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Circular scroll-progress button ──────────────────────── */
function ScrollProgressButton() {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const targetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const updateTarget = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min(Math.max((scrollTop / docHeight) * 100, 0), 100) : 0;
      targetRef.current = pct;
      setVisible(scrollTop > 400);
    };

    const tick = () => {
      setProgress((prev) => {
        const diff = targetRef.current - prev;
        if (Math.abs(diff) < 0.05) return targetRef.current;
        return prev + diff * 0.12;
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    updateTarget();
    window.addEventListener('scroll', updateTarget, { passive: true });
    window.addEventListener('resize', updateTarget);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('scroll', updateTarget);
      window.removeEventListener('resize', updateTarget);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Scroll to top"
      className={`fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white shadow-lg shadow-blue-900/10 flex items-center justify-center transition-opacity duration-300 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" className="absolute -rotate-90">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="#dbeafe" strokeWidth="2.5" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="#2563eb"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <ArrowUp size={16} strokeWidth={2.5} className="text-blue-700 relative" />
    </button>
  );
}

/* ─── Floating tech icons (contact section) ────────────────── */
const FLOATING_ICONS = [
  { Icon: ScanLine,       top: '10%', left: '9%',  size: 30, dur: 5.2, delay: 0,    fx: 7,  fy: 15, fr: 9,   accent: true },
  { Icon: Package,        top: '16%', left: '80%', size: 42, dur: 6.6, delay: 0.7,  fx: -9, fy: 12, fr: -7,  accent: false },
  { Icon: ArrowLeftRight, top: '64%', left: '5%',  size: 34, dur: 5.8, delay: 1.2,  fx: 8,  fy: -13, fr: 11, accent: false },
  { Icon: Wrench,         top: '80%', left: '86%', size: 28, dur: 4.7, delay: 0.3,  fx: -6, fy: 14, fr: -13, accent: true,  hideMobile: true },
  { Icon: ShieldCheck,    top: '36%', left: '92%', size: 26, dur: 6.1, delay: 1.6,  fx: 6,  fy: -10, fr: 8,  accent: false, hideMobile: true },
  { Icon: MapPin,         top: '86%', left: '28%', size: 24, dur: 5.4, delay: 0.9,  fx: -8, fy: 11, fr: -10, accent: false, hideMobile: true },
  { Icon: BarChart2,      top: '6%',  left: '52%', size: 26, dur: 6.9, delay: 0.2,  fx: 5,  fy: 13, fr: 10,  accent: true,  hideMobile: true },
];

function FloatingTechIcons() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {FLOATING_ICONS.map(({ Icon, top, left, size, dur, delay, fx, fy, fr, accent, hideMobile }, i) => (
        <div
          key={i}
          className={`floaty absolute ${hideMobile ? 'hidden sm:flex' : 'flex'} items-center justify-center rounded-full border backdrop-blur-sm ${
            accent ? 'border-blue-400/40 bg-blue-400/10' : 'border-white/15 bg-white/5'
          }`}
          style={
            {
              top,
              left,
              width: size,
              height: size,
              '--dur': `${dur}s`,
              '--delay': `${delay}s`,
              '--fx': fx,
              '--fy': fy,
              '--fr': `${fr}deg`,
            } as CSSProperties
          }
        >
          <Icon
            size={Math.round(size * 0.45)}
            strokeWidth={2}
            className={accent ? 'text-blue-400' : 'text-white/70'}
          />
        </div>
      ))}
      <style jsx>{`
        @keyframes floatWobble {
          0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
          25% { transform: translate(calc(var(--fx) * 1px), calc(var(--fy) * -1px)) rotate(var(--fr)) scale(1.06); }
          50% { transform: translate(calc(var(--fx) * -0.6px), calc(var(--fy) * -1.4px)) rotate(calc(var(--fr) * -1)) scale(0.96); }
          75% { transform: translate(calc(var(--fx) * 0.8px), calc(var(--fy) * -0.3px)) rotate(var(--fr)) scale(1.03); }
        }
        .floaty {
          animation: floatWobble var(--dur, 6s) ease-in-out infinite;
          animation-delay: var(--delay, 0s);
        }
        @media (prefers-reduced-motion: reduce) {
          .floaty { animation: none; }
        }
      `}</style>
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <main className="min-h-screen bg-white text-black flex flex-col overflow-x-hidden">

      {/* ─── NAV ─────────────────────────────────────────────── */}
      <div
        className={`sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)] transition-shadow ${
          scrolled ? 'border-blue-500/20' : ''
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-3 md:py-4 flex justify-between items-center gap-3">
          <div className="flex items-center shrink-0">
            <Image
              src="/WARESYS.svg"
              alt="WareSys"
              width={360}
              height={84}
              className="h-10 sm:h-14 md:h-20 w-auto transition-opacity hover:opacity-80"
              priority
            />
          </div>

          <nav className="hidden md:flex items-center gap-1 text-sm text-gray-500 font-medium">
            {[
              { href: '#how-it-works', label: t('landing.nav.howItWorks') },
              { href: '#faq', label: t('landing.nav.faq') },
              { href: '#contact', label: t('landing.nav.contact') },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="relative px-3 py-2 rounded-md hover:text-blue-700 hover:bg-blue-50 transition"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <a
              href="#contact"
              className="hidden sm:inline-flex text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-blue-500/20 text-blue-700 hover:bg-blue-50 font-medium transition whitespace-nowrap"
            >
              {t('landing.nav.bookDemo')}
            </a>
            <button
              onClick={() => router.push('/login')}
              className="text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 font-medium transition whitespace-nowrap"
            >
              {t('landing.nav.login')}
            </button>
            <LanguageSwitcher className="hidden sm:block" />
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t('landing.nav.toggleMenu')}
              className="md:hidden p-2 rounded-md border border-blue-500/20 hover:bg-blue-50 transition shrink-0"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        <div
          className={`md:hidden overflow-hidden transition-all duration-300 border-t border-blue-500/10 ${
            menuOpen ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0 border-t-0'
          }`}
        >
          <nav className="flex flex-col px-4 sm:px-6 py-2 text-sm font-medium text-gray-600">
            {[
              { href: '#how-it-works', label: t('landing.nav.howItWorks') },
              { href: '#faq', label: t('landing.nav.faq') },
              { href: '#contact', label: t('landing.nav.contact') },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="py-2.5 border-b border-blue-500/10 last:border-0 hover:text-blue-700 transition"
              >
                {link.label}
              </a>
            ))}
            <a
              href="#contact"
              onClick={() => setMenuOpen(false)}
              className="py-2.5 hover:text-blue-700 transition"
            >
              {t('landing.nav.bookDemo')}
            </a>
            <div className="py-2.5">
              <LanguageSwitcher />
            </div>
          </nav>
        </div>
      </div>

      {/* ─── HERO ────────────────────────────────────────────── */}
      <section
        className="border-b border-blue-500/15 relative"
        style={{
          backgroundColor: '#f8fafc',
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        <div className="pointer-events-none absolute top-6 right-0 sm:right-10 h-72 w-72 rounded-full bg-blue-400/10 blur-[100px]" />
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 md:py-24 grid md:grid-cols-2 gap-10 md:gap-16 items-center relative">
          <div>
            <Kicker index="00" label={t('landing.hero.eyebrow')} className="mb-4 sm:mb-5" />
            <h2 className={`${display.className} text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-[1.1] md:leading-[1.05] mb-5 sm:mb-6`}>
              {t('landing.hero.headline')}
            </h2>
            <p className="text-gray-500 text-base leading-relaxed mb-3 max-w-md">
              {t('landing.hero.sub1')}
            </p>
            <p className="text-gray-500 text-base leading-relaxed mb-8 sm:mb-10 max-w-md">
              {t('landing.hero.sub2')}
            </p>
            <div className="flex gap-3 flex-wrap">
              <a
                href="#contact"
                className="flex items-center gap-1.5 text-sm px-5 py-3 rounded-md bg-blue-600 text-white hover:bg-blue-700 font-bold transition"
              >
                {t('landing.hero.ctaDemo')} <ChevronRight size={15} />
              </a>
              <a
                href="#how-it-works"
                className="flex items-center gap-1.5 text-sm px-5 py-3 rounded-md border border-blue-500/20 hover:bg-blue-50 font-medium transition"
              >
                {t('landing.hero.ctaHowItWorks')}
              </a>
            </div>
          </div>

          {/* Live scan terminal, replaces static checklist */}
          <TerminalFeed />
        </div>
      </section>

      {/* ─── TECH MARQUEE ────────────────────────────────────── */}
      <TechMarquee />

      {/* ─── THE PROBLEM ─────────────────────────────────────── */}
      <section className="border-b border-blue-500/15 bg-gradient-to-b from-[#0B1220] to-[#0d1626] text-white relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #60a5fa 1px, transparent 1px), linear-gradient(to bottom, #60a5fa 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="pointer-events-none absolute top-0 right-1/4 h-72 w-72 rounded-full bg-red-500/10 blur-[110px]" />
        <div className="pointer-events-none absolute bottom-0 left-10 h-64 w-64 rounded-full bg-blue-500/10 blur-[100px]" />

        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 grid md:grid-cols-2 gap-10 md:gap-16 items-center relative">
          <div>
            <Kicker index="01" label={t('landing.problem.eyebrow')} variant="dark" />
            <h3 className={`${display.className} text-2xl sm:text-3xl font-bold tracking-tight mb-7 sm:mb-8 max-w-lg`}>
              {t('landing.problem.heading')}
            </h3>

            <div className="space-y-3">
              {[
                { icon: AlertTriangle, title: t('landing.problem.cards.mismatch.title'), body: t('landing.problem.cards.mismatch.body') },
                { icon: HelpCircle,    title: t('landing.problem.cards.disappear.title'), body: t('landing.problem.cards.disappear.body') },
                { icon: MapPin,        title: t('landing.problem.cards.location.title'), body: t('landing.problem.cards.location.body') },
                { icon: Clock,         title: t('landing.problem.cards.forever.title'), body: t('landing.problem.cards.forever.body') },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex items-start gap-2.5 border-l-2 border-red-400/30 pl-3 py-0.5">
                  <Icon size={14} strokeWidth={2} className="text-red-300/70 mt-0.5 shrink-0" />
                  <p className="text-sm text-white/60 leading-relaxed">
                    <span className="font-semibold text-white">{title}.</span> {body}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* mock "broken" log, the chaotic counterpart to the clean hero terminal */}
          <div className="border border-red-500/20 rounded-xl overflow-hidden bg-[#0B1220] shadow-lg shadow-red-900/10">
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-red-400/10">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/30" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/30" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
              <span className="ml-3 text-[11px] sm:text-xs font-mono text-red-200/40 truncate">
                {t('landing.problem.mockLog.fileLabel')}
              </span>
            </div>
            <div className="px-4 sm:px-5 py-4 sm:py-5 font-mono text-[11px] sm:text-[13px] leading-7">
              <div className="text-white/25 line-through decoration-white/20">{t('landing.problem.mockLog.line1')}</div>
              <div className="text-red-300/80">⚠ {t('landing.problem.mockLog.line2')}</div>
              <div className="text-blue-200/40">{t('landing.problem.mockLog.line3')}</div>
              <div className="text-white/20 line-through decoration-white/15">{t('landing.problem.mockLog.line4')}</div>
              <span className="inline-block w-2 h-3.5 bg-red-400/70 align-middle animate-pulse mt-1" />
            </div>
          </div>
        </div>
      </section>

      {/* ─── EVERYTHING INCLUDED ─────────────────────────────── */}
      <section className="border-b border-blue-500/15 relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 right-0 h-80 w-80 rounded-full bg-blue-500/10 blur-[110px]" />
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 relative">
          <Kicker index="02" label={t('landing.features.eyebrow')} />
          <h3 className={`${display.className} text-2xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-10`}>
            {t('landing.features.heading')}
          </h3>

          {/* hero tile — the flagship capability gets its own banner instead
              of blending into the grid like the other five */}
          <div className="mb-3 rounded-xl overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-800 text-white p-6 sm:p-8 relative">
            <div
              className="absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />
            <div className="relative flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">
              <span className="shrink-0 inline-flex p-3.5 rounded-xl bg-white/15">
                <ScanLine size={26} strokeWidth={2} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="text-lg sm:text-xl font-bold">{t('landing.features.items.barcodeReceiving.label')}</p>
                  <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-white/25 bg-white/10">
                    core
                  </span>
                </div>
                <p className="text-sm text-white/75 max-w-md">{t('landing.features.items.barcodeReceiving.sub')}</p>
              </div>
              <span className="hidden sm:inline-flex shrink-0 font-bold text-white/90 text-xl">✓</span>
            </div>
          </div>

          {/* supporting capabilities — a spec-sheet strip (hairline dividers,
              no card borders) so it doesn't repeat the bordered-card recipe */}
          <div className="grid sm:grid-cols-5 gap-px bg-blue-500/10 border border-blue-500/10 rounded-xl overflow-hidden">
            {[
              { icon: ArrowLeftRight, label: t('landing.features.items.transfers.label'), sub: t('landing.features.items.transfers.sub') },
              { icon: BarChart2,      label: t('landing.features.items.tracking.label'), sub: t('landing.features.items.tracking.sub') },
              { icon: Users,          label: t('landing.features.items.multiUser.label'), sub: t('landing.features.items.multiUser.sub') },
              { icon: ShieldCheck,    label: t('landing.features.items.auditLogs.label'), sub: t('landing.features.items.auditLogs.sub') },
              { icon: Inbox,          label: t('landing.features.items.onboarding.label'), sub: t('landing.features.items.onboarding.sub') },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="bg-white p-4 sm:p-5 flex flex-col gap-2.5 hover:bg-blue-50/50 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="p-1.5 rounded-md bg-blue-600/5 border border-blue-500/20">
                    <Icon size={14} strokeWidth={2} className="text-blue-700" />
                  </span>
                  <span className="text-blue-600 text-xs font-bold">✓</span>
                </div>
                <div>
                  <p className="text-xs font-semibold leading-tight">{label}</p>
                  <p className="text-[11px] text-gray-500 mt-1 leading-snug">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ────────────────────────────────────── */}
      <section
        id="how-it-works"
        className="border-b border-blue-500/15"
        style={{
          backgroundColor: '#f8fafc',
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.06) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <Kicker index="03" label={t('landing.howItWorks.eyebrow')} />
          <h3 className={`${display.className} text-2xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-12`}>
            {t('landing.howItWorks.heading')}
          </h3>

          <HowItWorksStepper />
        </div>
      </section>

      {/* ─── ECOSYSTEM ────────────────────────────────────────── */}
      <section className="border-b border-blue-500/15 bg-[#F1F5FB] relative overflow-hidden">
        <div
          className="h-1.5 w-full"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, #2563EB 0px, #2563EB 10px, #0F172A 10px, #0F172A 20px)',
          }}
        />
        <div className="pointer-events-none absolute top-1/3 -left-24 h-72 w-72 rounded-full bg-indigo-500/10 blur-[100px]" />
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 relative">
          <Kicker index="04" label={t('landing.ecosystem.eyebrow')} />
          <h3 className={`${display.className} text-2xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-12 max-w-2xl`}>
            {t('landing.ecosystem.heading')}
          </h3>

          <EcosystemCarousel
            products={[
              {
                icon: Package,
                name: 'WareSys Warehouse',
                tag: t('landing.ecosystem.products.warehouse.tag'),
                body: t('landing.ecosystem.products.warehouse.body'),
                status: 'Live',
                statusLabel: t('landing.ecosystem.statusLive'),
              },
              {
                icon: ReceiptText,
                name: 'Invoice POS',
                tag: t('landing.ecosystem.products.invoice.tag'),
                body: t('landing.ecosystem.products.invoice.body'),
                status: 'Live',
                statusLabel: t('landing.ecosystem.statusLive'),
              },
              {
                icon: Wrench,
                name: 'Workshop RMS',
                tag: t('landing.ecosystem.products.workshop.tag'),
                body: t('landing.ecosystem.products.workshop.body'),
                status: 'Live',
                statusLabel: t('landing.ecosystem.statusLive'),
              },
            ]}
          />
        </div>
      </section>

      {/* ─── WHO IT'S FOR ────────────────────────────────────── */}
      <section className="border-b border-blue-500/15 bg-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <Kicker index="05" label={t('landing.whoItsFor.eyebrow')} />
          <h3 className={`${display.className} text-2xl sm:text-3xl font-bold tracking-tight mb-8 sm:mb-12 max-w-2xl`}>
            {t('landing.whoItsFor.heading')}
          </h3>

          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            {[
              {
                icon: Package,
                title: t('landing.whoItsFor.cards.spareParts.title'),
                body: t('landing.whoItsFor.cards.spareParts.body'),
                gradient: 'bg-gradient-to-br from-blue-500 to-indigo-700',
              },
              {
                icon: Wrench,
                title: t('landing.whoItsFor.cards.workshops.title'),
                body: t('landing.whoItsFor.cards.workshops.body'),
                gradient: 'bg-gradient-to-br from-emerald-500 to-emerald-700',
              },
              {
                icon: Building2,
                title: t('landing.whoItsFor.cards.multiLocation.title'),
                body: t('landing.whoItsFor.cards.multiLocation.body'),
                gradient: 'bg-gradient-to-br from-violet-500 to-purple-700',
              },
            ].map(({ icon: Icon, title, body, gradient }) => (
              <div
                key={title}
                className={`${gradient} text-white rounded-lg p-5 sm:p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200`}
              >
                <span className="inline-flex shrink-0 rounded-lg bg-white/15 p-2.5 mb-4">
                  <Icon size={20} strokeWidth={2} />
                </span>
                <p className="font-bold text-base mb-1.5">{title}</p>
                <p className="text-sm text-white/85 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          <p className="text-sm text-gray-500 max-w-xl">
            {t('landing.whoItsFor.footNote')}
          </p>
        </div>
      </section>

      {/* ─── PROOF ────────────────────────────────────────────── */}
      <section className="border-b border-blue-500/15 bg-gradient-to-b from-slate-950 to-[#0B1220] text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <div className="text-center mb-10 sm:mb-14">
            <Kicker index="06" label={t('landing.proof.eyebrow')} variant="dark" center className="justify-center mb-0" />
            <h3 className={`${display.className} text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mt-3`}>
              {t('landing.proof.heading')}
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 sm:gap-6 md:gap-8">
            {[
              {
                title: t('landing.proof.cards.location.title'),
                body: t('landing.proof.cards.location.body'),
              },
              {
                title: t('landing.proof.cards.whoMoved.title'),
                body: t('landing.proof.cards.whoMoved.body'),
              },
              {
                title: t('landing.proof.cards.spreadsheets.title'),
                body: t('landing.proof.cards.spreadsheets.body'),
              },
              {
                title: t('landing.proof.cards.quickStart.title'),
                body: t('landing.proof.cards.quickStart.body'),
              },
            ].map((item) => (
              <div
                key={item.title}
                className="border border-blue-400/15 rounded-xl p-6 sm:p-7 md:p-8 hover:border-blue-400/40 transition"
              >
                <h4 className="font-bold text-base sm:text-lg mb-2.5 sm:mb-3">{item.title}</h4>
                <p className="text-sm leading-6 sm:leading-7 text-blue-100/50">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────────────── */}
      <section id="faq" className="border-b border-blue-500/15 relative overflow-hidden">
        <div className="pointer-events-none absolute top-0 left-1/4 h-64 w-64 rounded-full bg-blue-400/10 blur-[100px]" />
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 relative">
          <div>
            <Kicker index="07" label={t('landing.faq.eyebrow')} />
            <h3 className={`${display.className} text-2xl sm:text-3xl font-bold tracking-tight`}>
              {t('landing.faq.heading')}
            </h3>
          </div>

          <FaqAccordion
            items={[
              {
                q: t('landing.faq.items.whatDoesItDo.q'),
                a: t('landing.faq.items.whatDoesItDo.a'),
              },
              {
                q: t('landing.faq.items.multipleEmployees.q'),
                a: t('landing.faq.items.multipleEmployees.a'),
              },
              {
                q: t('landing.faq.items.multiLocation.q'),
                a: t('landing.faq.items.multiLocation.a'),
              },
              {
                q: t('landing.faq.items.getStarted.q'),
                a: t('landing.faq.items.getStarted.a'),
              },
            ]}
          />
        </div>
      </section>

      {/* ─── CONTACT ─────────────────────────────────────────── */}
      <section
        id="contact"
        className="relative overflow-hidden border-b border-blue-500/15 bg-gradient-to-b from-[#0B0F1A] to-[#0F1B2E] text-white"
      >
        {/* faint blueprint grid */}
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #60a5fa 1px, transparent 1px), linear-gradient(to bottom, #60a5fa 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />
        {/* blue glow behind the heading */}
        <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-blue-500/20 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-blue-500/10 blur-[90px]" />
        {/* scanning sweep */}
        <div className="scan-sweep pointer-events-none absolute inset-x-0 h-24" />

        <FloatingTechIcons />

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24 grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          <div>
            <Kicker index="08" label={t('landing.contact.eyebrow')} variant="dark" />
            <h3 className={`${display.className} text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 leading-tight`}>
              {t('landing.contact.heading')}
            </h3>
            <p className="text-sm text-white/60 leading-relaxed max-w-sm">
              {t('landing.contact.sub')}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <a
              href="https://wa.me/6281372127181"
              className="flex items-center justify-between px-4 sm:px-5 py-4 rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm hover:border-blue-400/60 hover:bg-white/10 font-medium transition group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 p-2 border border-white/15 rounded-lg">
                  <MessageCircle size={17} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">WhatsApp</p>
                  <p className="text-xs text-white/50">{t('landing.contact.whatsapp.sub')}</p>
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-white/40 group-hover:text-blue-400 transition" />
            </a>
            <a
              href="mailto:hello@warehouselayer.com"
              className="flex items-center justify-between px-4 sm:px-5 py-4 rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm hover:border-blue-400/60 hover:bg-white/10 font-medium transition group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 p-2 border border-white/15 rounded-lg">
                  <Mail size={17} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{t('landing.contact.email.title')}</p>
                  <p className="text-xs text-white/50 truncate">klvnjntn@gmail.com</p>
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-white/40 group-hover:text-blue-400 transition" />
            </a>
          </div>
        </div>

        <style jsx>{`
          @keyframes scanSweep {
            0% { top: -10%; opacity: 0; }
            10% { opacity: 0.5; }
            90% { opacity: 0.5; }
            100% { top: 100%; opacity: 0; }
          }
          .scan-sweep {
            background: linear-gradient(
              to bottom,
              transparent,
              rgba(59, 130, 246, 0.18),
              transparent
            );
            animation: scanSweep 7s ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .scan-sweep { animation: none; opacity: 0; }
          }
        `}</style>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────── */}
      <div className="px-5 sm:px-8 py-5 max-w-6xl mx-auto w-full flex flex-col sm:flex-row gap-2 sm:gap-0 justify-between items-center text-xs text-gray-400 text-center sm:text-left">
        <span className={`${display.className} font-bold text-blue-700 tracking-tight`}>WARESYS</span>
        <span>© {new Date().getFullYear()} · {t('landing.footer.tagline')}</span>
      </div>

      <ScrollProgressButton />

    </main>
  );
}