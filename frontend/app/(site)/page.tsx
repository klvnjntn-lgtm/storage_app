'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  Inbox,
  ArrowLeftRight,
  BarChart2,
  MessageCircle,
  Mail,
  ChevronRight,
  Menu,
  X,
  ArrowUp,
  ScanLine,
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

/* ─── Live scan feed (hero terminal) ───────────────────────── */
const SCAN_LOG = [
  { time: '09:14:02', text: 'Received 48x Brake Pad Set — Bay 3' },
  { time: '09:14:19', text: 'Transferred 12x Alternator — Bay 3 → Rack A2' },
  { time: '09:15:03', text: 'Scan match confirmed — SKU-88213' },
  { time: '09:15:44', text: 'Low stock alert — Timing Belt (Rack C1)' },
  { time: '09:16:10', text: 'User jdelacruz logged transfer #4471' },
  { time: '09:16:58', text: 'Received 20x Oil Filter — Bay 1' },
  { time: '09:17:22', text: 'Audit log exported by admin' },
];

function TerminalFeed() {
  const [visible, setVisible] = useState(1);

  useEffect(() => {
    const t = setInterval(() => {
      setVisible((v) => (v >= SCAN_LOG.length ? 1 : v + 1));
    }, 1400);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="border border-gray-300 rounded-md overflow-hidden bg-black">
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/10">
        <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
        <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
        <span className="ml-3 text-[11px] sm:text-xs font-mono text-gray-500 truncate">
          warehouse@waresys — live feed
        </span>
      </div>
      <div className="px-4 sm:px-5 py-4 sm:py-5 font-mono text-[11px] sm:text-[13px] leading-6 h-[230px] sm:h-[260px] overflow-hidden">
        {SCAN_LOG.slice(0, visible).map((line) => (
          <div key={line.time} className="text-gray-300">
            <span className="text-gray-600">[{line.time}]</span> {line.text}
          </div>
        ))}
        <span className="inline-block w-2 h-3.5 bg-white/70 align-middle animate-pulse ml-0.5" />
      </div>
    </div>
  );
}

/* ─── Scrolling tech-capability marquee ────────────────────── */
const TECH_TAGS = [
  'BARCODE SCANNING',
  'REAL-TIME SYNC',
  'ROLE-BASED ACCESS',
  'AUDIT TRAIL',
  'MULTI-LOCATION TRACKING',
  'TRANSFER HISTORY',
  'LIVE STOCK COUNTS',
];

function TechMarquee() {
  const doubled = [...TECH_TAGS, ...TECH_TAGS];
  return (
    <div className="border-b-2 border-gray-300 bg-black overflow-hidden">
      <div className="flex whitespace-nowrap py-3 marquee-track">
        {doubled.map((tag, i) => (
          <span
            key={i}
            className="flex items-center text-[11px] sm:text-xs font-mono uppercase tracking-widest text-gray-400 mx-4"
          >
            {tag}
            <span className="mx-4 text-[#FF6A00]">•</span>
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

/* ─── "How it works" interactive stepper ───────────────────── */
const STEPS = [
  {
    step: '01',
    icon: Inbox,
    title: 'Receive inventory',
    body: 'Scan or enter parts as they arrive. Every item is timestamped and assigned to a location immediately.',
  },
  {
    step: '02',
    icon: ArrowLeftRight,
    title: 'Move stock',
    body: 'Transfer parts between shelves or warehouses. The system records who moved what, and when.',
  },
  {
    step: '03',
    icon: BarChart2,
    title: 'Track everything',
    body: 'See live stock counts per location, pull audit logs, and know exactly what you have — and where.',
  },
];

function HowItWorksStepper() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setActive((a) => (a + 1) % STEPS.length), 4000);
    return () => clearInterval(t);
  }, [paused]);

  const ActiveIcon = STEPS[active].icon;

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        {STEPS.map((s, i) => (
          <button
            key={s.step}
            onClick={() => setActive(i)}
            className={`text-left border rounded-md px-4 py-3 transition ${
              active === i ? 'border-black bg-white' : 'border-gray-200 bg-white/60 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-mono tracking-widest ${active === i ? 'text-black' : 'text-gray-400'}`}>
                {s.step}
              </span>
              {active === i && <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />}
            </div>
            <p className={`text-sm font-bold ${active === i ? 'text-black' : 'text-gray-400'}`}>{s.title}</p>
            <div className="h-0.5 bg-gray-200 mt-3 rounded-full overflow-hidden">
              {active === i && <div key={active} className="h-full bg-black fillbar" />}
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-300 rounded-md p-6 sm:p-8 flex items-start gap-4 sm:gap-5">
        <div className="shrink-0 p-2.5 sm:p-3 border border-gray-300 rounded-md">
          <ActiveIcon size={20} strokeWidth={2} className="text-black" />
        </div>
        <div>
          <p className="font-bold text-base mb-1.5">{STEPS[active].title}</p>
          <p className="text-sm text-gray-500 leading-relaxed max-w-xl">{STEPS[active].body}</p>
        </div>
      </div>

      <style jsx>{`
        @keyframes fillbar {
          from { width: 0%; }
          to { width: 100%; }
        }
        .fillbar {
          animation: fillbar 4s linear;
        }
      `}</style>
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
      className={`fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white shadow-lg flex items-center justify-center transition-opacity duration-300 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" className="absolute -rotate-90">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="2.5" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="#000000"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <ArrowUp size={16} strokeWidth={2.5} className="text-black relative" />
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
            accent ? 'border-[#FF6A00]/40 bg-[#FF6A00]/10' : 'border-white/15 bg-white/5'
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
            className={accent ? 'text-[#FF6A00]' : 'text-white/70'}
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
        className={`sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b-2 transition-shadow ${
          scrolled ? 'border-gray-300 shadow-sm' : 'border-gray-300'
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
              { href: '#how-it-works', label: 'How it works' },
              { href: '#faq', label: 'FAQ' },
              { href: '#contact', label: 'Contact' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="relative px-3 py-2 rounded-md hover:text-black hover:bg-gray-100 transition"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <a
              href="#contact"
              className="hidden sm:inline-flex text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-gray-300 hover:bg-gray-100 font-medium transition whitespace-nowrap"
            >
              Book a Demo
            </a>
            <button
              onClick={() => router.push('/login')}
              className="text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-md border border-gray-300 bg-black text-white hover:bg-gray-800 font-medium transition whitespace-nowrap"
            >
              Login
            </button>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle menu"
              className="md:hidden p-2 rounded-md border border-gray-300 hover:bg-gray-100 transition shrink-0"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        <div
          className={`md:hidden overflow-hidden transition-all duration-300 border-t border-gray-200 ${
            menuOpen ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0 border-t-0'
          }`}
        >
          <nav className="flex flex-col px-4 sm:px-6 py-2 text-sm font-medium text-gray-600">
            {[
              { href: '#how-it-works', label: 'How it works' },
              { href: '#faq', label: 'FAQ' },
              { href: '#contact', label: 'Contact' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="py-2.5 border-b border-gray-100 last:border-0 hover:text-black transition"
              >
                {link.label}
              </a>
            ))}
            <a
              href="#contact"
              onClick={() => setMenuOpen(false)}
              className="py-2.5 hover:text-black transition"
            >
              Book a Demo
            </a>
          </nav>
        </div>
      </div>

      {/* ─── HERO ────────────────────────────────────────────── */}
      <section
        className="border-b-2 border-gray-300 relative"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.035) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 md:py-24 grid md:grid-cols-2 gap-10 md:gap-16 items-center relative">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4 sm:mb-5">
              Built for spare parts businesses
            </p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-[1.1] md:leading-[1.05] mb-5 sm:mb-6">
              Stop losing track of your spare parts.
            </h2>
            <p className="text-gray-500 text-base leading-relaxed mb-3 max-w-md">
              WareSys keeps your inventory, locations, and stock movements in one place.
            </p>
            <p className="text-gray-500 text-base leading-relaxed mb-8 sm:mb-10 max-w-md">
              Scan parts. Move stock. Know exactly what you have and where it is.
            </p>
            <div className="flex gap-3 flex-wrap">
              <a
                href="#contact"
                className="flex items-center gap-1.5 text-sm px-5 py-3 rounded-md bg-black text-white hover:bg-gray-800 font-bold transition"
              >
                Book a Demo <ChevronRight size={15} />
              </a>
              <a
                href="#how-it-works"
                className="flex items-center gap-1.5 text-sm px-5 py-3 rounded-md border border-gray-300 hover:bg-gray-100 font-medium transition"
              >
                See How It Works ↓
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
      <section className="border-b-2 border-gray-300 bg-gray-50">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            Sound familiar?
          </p>
          <h3 className="text-2xl sm:text-3xl font-black tracking-tight mb-8 sm:mb-12 max-w-2xl">
            Still managing stock with Excel, paper, or WhatsApp?
          </h3>

          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: AlertTriangle, title: 'Stock doesn\u2019t match', body: 'Manual entries create mistakes.' },
              { icon: HelpCircle,    title: 'Parts disappear',       body: 'You know something moved, but not who moved it.' },
              { icon: MapPin,        title: 'Nobody knows the location', body: 'Your team wastes time searching shelves.' },
              { icon: Clock,         title: 'Inventory takes forever', body: 'Counting and updating stock manually eats hours.' },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-white border border-gray-300 rounded-md p-5 sm:p-6">
                <div className="p-2 border border-gray-300 rounded-md w-fit mb-4">
                  <Icon size={18} strokeWidth={2} className="text-black" />
                </div>
                <p className="font-bold text-sm mb-1.5">{title}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── EVERYTHING INCLUDED ─────────────────────────────── */}
      <section className="border-b-2 border-gray-300">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            WareSys Warehouse
          </p>
          <h3 className="text-2xl sm:text-3xl font-black tracking-tight mb-8 sm:mb-12">
            Everything your stock team needs.
          </h3>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { icon: ScanLine,       label: 'Barcode receiving',            sub: 'Scan on any device, instantly logged' },
              { icon: ArrowLeftRight, label: 'Stock transfers',              sub: 'Between locations with full history' },
              { icon: BarChart2,      label: 'Full inventory tracking',      sub: 'Live counts per location' },
              { icon: Users,          label: 'Multi-user access with roles', sub: 'Admins and staff, separate views' },
              { icon: ShieldCheck,    label: 'Complete audit logs',          sub: 'Every action timestamped' },
              { icon: Inbox,          label: 'Same-day onboarding',          sub: 'Import your existing stock and go' },
            ].map(({ icon: Icon, label, sub }) => (
              <div
                key={label}
                className="flex items-start gap-4 border border-gray-300 rounded-md p-5 hover:border-black transition"
              >
                <div className="shrink-0 p-2 border border-gray-300 rounded-md">
                  <Icon size={17} strokeWidth={2} className="text-black" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">{label}</p>
                  <p className="text-xs text-gray-500 mt-1">{sub}</p>
                </div>
                <span className="ml-auto font-bold text-black text-sm shrink-0">✓</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ────────────────────────────────────── */}
      <section id="how-it-works" className="border-b-2 border-gray-300 bg-gray-50">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            How it works
          </p>
          <h3 className="text-2xl sm:text-3xl font-black tracking-tight mb-8 sm:mb-12">
            From the dock to the shelf.
          </h3>

          <HowItWorksStepper />
        </div>
      </section>

      {/* ─── ECOSYSTEM ────────────────────────────────────────── */}
      <section className="border-b-2 border-gray-300 bg-[#FAF8F3]">
        <div
          className="h-1.5 w-full"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-45deg, #FF6A00 0px, #FF6A00 10px, #111111 10px, #111111 20px)',
          }}
        />
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            The bigger picture
          </p>
          <h3 className="text-2xl sm:text-3xl font-black tracking-tight mb-8 sm:mb-12 max-w-2xl">
            One platform for your entire operation.
          </h3>

          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                icon: Package,
                name: 'WareSys Warehouse',
                tag: 'Inventory & warehouse management',
                body: 'Track stock, locations, transfers, and every movement.',
                status: 'Live',
              },
              {
                icon: ReceiptText,
                name: 'Invoice POS',
                tag: 'Sales & invoicing',
                body: 'Create invoices, manage products, track sales and calculate profit.',
                status: 'Live',
              },
              {
                icon: Wrench,
                name: 'Workshop RMS',
                tag: 'Workshop management',
                body: 'Manage customers, vehicles, service history, reminders, invoices and workshop operations.',
                status: 'Coming soon',
              },
            ].map(({ icon: Icon, name, tag, body, status }) => (
              <div key={name} className="border border-gray-300 rounded-md p-5 sm:p-6 flex flex-col bg-white hover:border-[#FF6A00] transition">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 border border-gray-300 rounded-md">
                    <Icon size={18} strokeWidth={2} className="text-black" />
                  </div>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded-full ${
                      status === 'Live' ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {status}
                  </span>
                </div>
                <p className="font-bold text-sm">{name}</p>
                <p className="text-xs text-gray-400 mt-0.5 mb-3">{tag}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── WHO IT'S FOR ────────────────────────────────────── */}
      <section className="border-b-2 border-gray-300 bg-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            Who it&apos;s for
          </p>
          <h3 className="text-2xl sm:text-3xl font-black tracking-tight mb-8 sm:mb-12 max-w-2xl">
            Built for businesses that move parts every day.
          </h3>

          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            {[
              { icon: Package,   title: 'Spare Parts Shops',         body: 'Track thousands of SKUs without losing location visibility.' },
              { icon: Wrench,    title: 'Automotive Workshops',      body: 'Know what parts are available before starting a job.' },
              { icon: Building2, title: 'Multi-Location Businesses', body: 'Move inventory between locations with a complete history.' },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-gray-50 border border-gray-300 rounded-md p-5 sm:p-6">
                <div className="p-2 border border-gray-300 rounded-md w-fit mb-4">
                  <Icon size={18} strokeWidth={2} className="text-black" />
                </div>
                <p className="font-bold text-sm mb-1.5">{title}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          <p className="text-sm text-gray-500 max-w-xl">
            If your inventory is still managed through Excel, paper, or memory, WareSys is built for you.
          </p>
        </div>
      </section>

      {/* ─── PROOF ────────────────────────────────────────────── */}
      <section className="border-b-2 border-gray-300 bg-black text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <div className="text-center mb-10 sm:mb-14">
            <p className="text-xs uppercase tracking-[0.25em] text-gray-400 font-semibold">
              Why WARESYS
            </p>
            <h3 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight mt-3">
              Built for real spare-parts operations.
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 sm:gap-6 md:gap-8">
            {[
              {
                title: "Know where every part is.",
                body: "Track stock by warehouse, rack, shelf, or location.",
              },
              {
                title: "Know who moved it.",
                body: "Every stock movement is recorded.",
              },
              {
                title: "Stop relying on spreadsheets.",
                body: "Your team works from the same inventory data.",
              },
              {
                title: "Get started without months of setup.",
                body: "Import your existing stock and start using it.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="border border-white/15 rounded-lg p-6 sm:p-7 md:p-8 hover:border-white/40 transition"
              >
                <h4 className="font-bold text-base sm:text-lg mb-2.5 sm:mb-3">{item.title}</h4>
                <p className="text-sm leading-6 sm:leading-7 text-gray-400">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────────────── */}
      <section id="faq" className="border-b-2 border-gray-300">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
              Common questions
            </p>
            <h3 className="text-2xl sm:text-3xl font-black tracking-tight">
              What owners usually ask.
            </h3>
          </div>

          <div>
            {[
              {
                q: 'What does it actually do?',
                a: 'It replaces your spreadsheets. Receive parts, move them between locations, and see live stock counts — with a full history of every action.',
              },
              {
                q: 'Can multiple employees use it?',
                a: 'Yes. Each employee gets their own login. Admins see everything; staff see what they need.',
              },
              {
                q: 'Can I track stock across multiple locations?',
                a: 'Yes. Parts are tracked per shelf or warehouse. Every transfer is logged so you always know where a part went.',
              },
              {
                q: 'How do I get started?',
                a: 'Book a demo below. We will set up your account, import your existing stock, and get your team trained in one session.',
              },
            ].map((item, i) => (
              <div key={i} className="py-4 sm:py-5 border-b border-gray-200 last:border-0">
                <p className="font-bold text-sm mb-1.5">{item.q}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CONTACT ─────────────────────────────────────────── */}
      <section
        id="contact"
        className="relative overflow-hidden border-b-2 border-gray-300 bg-gradient-to-b from-[#0B0C10] to-[#161A21] text-white"
      >
        {/* faint blueprint grid */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />
        {/* warm glow behind the heading */}
        <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-[#FF6A00]/20 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-[#FF6A00]/10 blur-[90px]" />
        {/* scanning sweep */}
        <div className="scan-sweep pointer-events-none absolute inset-x-0 h-24" />

        <FloatingTechIcons />

        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24 grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          <div>
            <p className="text-xs font-semibold text-[#FF6A00] uppercase tracking-widest mb-2 font-mono">
              // Get in touch
            </p>
            <h3 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight mb-3 leading-tight">
              Ready to take control of your stock?
            </h3>
            <p className="text-sm text-white/60 leading-relaxed max-w-sm">
              Book a demo or reach out directly. We will get back to you the same day.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <a
              href="https://wa.me/6281372127181"
              className="flex items-center justify-between px-4 sm:px-5 py-4 rounded-md border border-white/15 bg-white/5 backdrop-blur-sm hover:border-[#FF6A00]/60 hover:bg-white/10 font-medium transition group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 p-2 border border-white/15 rounded-md">
                  <MessageCircle size={17} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">WhatsApp</p>
                  <p className="text-xs text-white/50">Fastest response</p>
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-white/40 group-hover:text-[#FF6A00] transition" />
            </a>
            <a
              href="mailto:hello@warehouselayer.com"
              className="flex items-center justify-between px-4 sm:px-5 py-4 rounded-md border border-white/15 bg-white/5 backdrop-blur-sm hover:border-[#FF6A00]/60 hover:bg-white/10 font-medium transition group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 p-2 border border-white/15 rounded-md">
                  <Mail size={17} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Email us</p>
                  <p className="text-xs text-white/50 truncate">klvnjntn@gmail.com</p>
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-white/40 group-hover:text-[#FF6A00] transition" />
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
              rgba(255, 106, 0, 0.18),
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
        <span className="font-bold text-black tracking-tight">WARESYS</span>
        <span>© {new Date().getFullYear()} · Built for spare parts businesses</span>
      </div>

      <ScrollProgressButton />

    </main>
  );
}