'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Package,
  Wrench,
  Building2,
  MapPin,
  History,
  Users,
  Zap,
  Plus,
  MessageCircle,
  Mail,
  ArrowRight,
  ArrowUpRight,
  ScanBarcode,
  RefreshCw,
  ShieldCheck,
  ArrowLeftRight,
  Activity,
} from 'lucide-react';
import { display } from '@/lib/fonts';
import { useLanguage } from '@/app/context/LanguageContext';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';
import {
  GridBackdrop,
  Kicker,
  ParallaxGlow,
  Reveal,
  SectionHeading,
  SpotlightCard,
  Stagger,
  StaggerItem,
  useAnimState,
} from './primitives';
import styles from './Sections.module.css';

export const CONTACT_EMAIL = 'klvnjntn@gmail.com';
export const WHATSAPP_URL = 'https://wa.me/6281372127181';

/* ─── Capability marquee ────────────────────────────────────────── */
export function TechMarquee() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const anim = useAnimState(ref);
  const tags = [
    { icon: ScanBarcode, key: 'barcodeScanning' },
    { icon: RefreshCw, key: 'realTimeSync' },
    { icon: ShieldCheck, key: 'roleBasedAccess' },
    { icon: History, key: 'auditTrail' },
    { icon: MapPin, key: 'multiLocationTracking' },
    { icon: ArrowLeftRight, key: 'transferHistory' },
    { icon: Activity, key: 'liveStockCounts' },
  ];
  return (
    <div ref={ref} data-anim={anim} className="relative border-y border-white/[0.06] bg-white/[0.012]">
      <div className={styles.marqueeMask}>
        <ul className={styles.marqueeTrack}>
          {[...tags, ...tags].map(({ icon: Icon, key }, i) => (
            <li
              key={i}
              aria-hidden={i >= tags.length || undefined}
              className="flex shrink-0 items-center gap-2.5 px-7 py-4 font-mono text-[11px] uppercase tracking-[0.18em] text-white/60"
            >
              <Icon size={14} strokeWidth={2} aria-hidden="true" className="text-blue-400" />
              {t(`landing.techMarquee.tags.${key}`)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ─── 05 · Who it's for ─────────────────────────────────────────── */
export function WhoItsFor() {
  const { t } = useLanguage();
  const cards = [
    { key: 'spareParts', icon: Package, glow: '96, 165, 250', ink: 'text-blue-300', tile: 'bg-blue-500/[0.14] ring-blue-400/30' },
    { key: 'workshops', icon: Wrench, glow: '52, 211, 153', ink: 'text-emerald-300', tile: 'bg-emerald-500/[0.14] ring-emerald-400/30' },
    { key: 'multiLocation', icon: Building2, glow: '167, 139, 250', ink: 'text-violet-300', tile: 'bg-violet-500/[0.14] ring-violet-400/30' },
  ];
  return (
    <section className="relative overflow-hidden">
      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <Reveal>
          <SectionHeading index="05" eyebrow={t('landing.whoItsFor.eyebrow')} title={t('landing.whoItsFor.heading')} className="max-w-3xl" />
        </Reveal>
        <Stagger className="mt-14 grid gap-4 md:grid-cols-3">
          {cards.map(({ key, icon: Icon, glow, ink, tile }) => (
            <StaggerItem key={key}>
              <SpotlightCard glow={glow} className="group h-full p-7 sm:p-8 transition-transform duration-300 hover:-translate-y-1">
                <span aria-hidden="true" className="absolute inset-x-8 top-0 h-px opacity-70" style={{ background: `linear-gradient(90deg, rgb(${glow}), transparent)` }} />
                <Icon aria-hidden="true" size={150} strokeWidth={1} className={`pointer-events-none absolute -bottom-8 -right-8 ${ink} opacity-[0.06]`} />
                <span className={`grid h-11 w-11 place-items-center rounded-xl ring-1 ring-inset ${tile} ${ink}`}>
                  <Icon size={20} strokeWidth={2} aria-hidden="true" />
                </span>
                <h3 className="mt-6 text-lg font-semibold tracking-[-0.01em] text-white">{t(`landing.whoItsFor.cards.${key}.title`)}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-white/60">{t(`landing.whoItsFor.cards.${key}.body`)}</p>
              </SpotlightCard>
            </StaggerItem>
          ))}
        </Stagger>
        <Reveal className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-t border-white/[0.07] pt-8">
          <p className="max-w-xl text-[15px] leading-relaxed text-white/60">{t('landing.whoItsFor.footNote')}</p>
          <a
            href="#contact"
            className="group inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-blue-300 hover:text-blue-200 transition-colors rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400"
          >
            {t('landing.nav.bookDemo')}
            <ArrowRight size={15} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}

/* ─── 06 · Why WareSys — a spec-sheet grid ──────────────────────── */
export function WhySection() {
  const { t } = useLanguage();
  const items = [
    { key: 'location', icon: MapPin },
    { key: 'whoMoved', icon: History },
    { key: 'spreadsheets', icon: Users },
    { key: 'quickStart', icon: Zap },
  ];
  return (
    <section className="relative overflow-hidden">
      <GridBackdrop size={48} opacity={0.05} mask="radial-gradient(ellipse at 50% 60%, black 10%, transparent 70%)" />
      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <Reveal>
          <SectionHeading center index="06" eyebrow={t('landing.proof.eyebrow')} title={t('landing.proof.heading')} className="max-w-3xl" />
        </Reveal>
        <Reveal delay={0.1} className="mt-14">
          <div className="grid overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.08] gap-px sm:grid-cols-2 lg:grid-cols-4">
            {items.map(({ key, icon: Icon }, i) => (
              <div key={key} className="group relative bg-[#070c18] p-7 sm:p-8 transition-colors duration-300 hover:bg-[#0a1122]">
                <span aria-hidden="true" className="absolute right-6 top-6 font-mono text-[11px] text-white/25">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="grid h-11 w-11 place-items-center rounded-full border border-blue-400/25 bg-blue-500/10 text-blue-300 transition-shadow duration-300 group-hover:shadow-[0_0_28px_-4px_rgba(59,130,246,0.8)]">
                  <Icon size={19} strokeWidth={2} aria-hidden="true" />
                </span>
                <h3 className="mt-7 text-lg font-semibold leading-snug tracking-[-0.01em] text-white">{t(`landing.proof.cards.${key}.title`)}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-white/60">{t(`landing.proof.cards.${key}.body`)}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ─── 07 · FAQ ──────────────────────────────────────────────────── */
export function Faq() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(0);
  const keys = ['whatDoesItDo', 'multipleEmployees', 'multiLocation', 'getStarted'];
  return (
    <section id="faq" className="relative overflow-hidden scroll-mt-16 md:scroll-mt-20">
      <ParallaxGlow className="absolute top-10 -left-20 h-80 w-80 rounded-full bg-blue-600/[0.10] blur-[120px]" speed={0.15} />
      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 py-24 sm:py-32 grid gap-12 lg:grid-cols-[0.9fr_1.4fr] lg:gap-16">
        <Reveal>
          <SectionHeading index="07" eyebrow={t('landing.faq.eyebrow')} title={t('landing.faq.heading')} />
          <SpotlightCard className="mt-10 p-6 hidden lg:block">
            <p className="font-semibold text-white">{t('landing.faq.stillQuestions')}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/60">{t('landing.faq.stillQuestionsBody')}</p>
            <a
              href="#contact"
              className="group mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-300 hover:text-blue-200 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400"
            >
              {t('landing.faq.contactCta')}
              <ArrowRight size={14} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
            </a>
          </SpotlightCard>
        </Reveal>

        <Stagger className="flex flex-col gap-3">
          {keys.map((key, i) => {
            const isOpen = open === i;
            return (
              <StaggerItem key={key}>
                <div
                  className={`rounded-2xl border transition-colors duration-300 ${
                    isOpen ? 'border-blue-400/25 bg-white/[0.04]' : 'border-white/[0.08] bg-white/[0.015] hover:border-white/[0.14]'
                  }`}
                >
                  <h3>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? -1 : i)}
                      aria-expanded={isOpen}
                      aria-controls={`faq-answer-${i}`}
                      className="flex w-full items-center gap-4 rounded-2xl px-5 py-5 sm:px-6 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                    >
                      <span aria-hidden="true" className="font-mono text-[11px] text-blue-300/80">
                        Q{String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="flex-1 font-semibold text-white">{t(`landing.faq.items.${key}.q`)}</span>
                      <span
                        aria-hidden="true"
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-all duration-300 ${
                          isOpen ? 'rotate-45 border-blue-400/40 bg-blue-500/15 text-blue-200' : 'border-white/10 text-white/60'
                        }`}
                      >
                        <Plus size={15} strokeWidth={2} />
                      </span>
                    </button>
                  </h3>
                  <div
                    id={`faq-answer-${i}`}
                    inert={!isOpen}
                    className={`grid transition-all duration-300 ease-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                  >
                    <div className="overflow-hidden">
                      <p className="px-5 sm:px-6 pb-6 pl-[3.25rem] sm:pl-[3.75rem] text-[15px] leading-relaxed text-white/65">
                        {t(`landing.faq.items.${key}.a`)}
                      </p>
                    </div>
                  </div>
                </div>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>
    </section>
  );
}

/* ─── 08 · Contact — the closing act, lit by a horizon ──────────── */
export function Contact() {
  const { t } = useLanguage();
  return (
    <section id="contact" className="relative overflow-hidden scroll-mt-16 md:scroll-mt-20">
      <GridBackdrop size={40} opacity={0.08} mask="radial-gradient(ellipse at 50% 100%, black 10%, transparent 65%)" />
      <div aria-hidden="true" className={styles.horizon} />
      <div className="relative max-w-3xl mx-auto px-5 sm:px-8 pt-24 sm:pt-28 pb-40 sm:pb-52 text-center">
        <Reveal>
          <Kicker index="08" label={t('landing.contact.eyebrow')} center />
          <h2
            className={`${display.className} mt-6 text-[2.4rem] leading-[1.02] sm:text-6xl lg:text-7xl font-semibold tracking-[-0.04em] text-balance bg-[linear-gradient(180deg,#fff_40%,rgba(255,255,255,0.55))] bg-clip-text text-transparent`}
          >
            {t('landing.contact.heading')}
          </h2>
          <p className="mx-auto mt-6 max-w-md text-base sm:text-lg leading-relaxed text-white/60">{t('landing.contact.sub')}</p>
        </Reveal>
        <Reveal delay={0.12} className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <a
            href={WHATSAPP_URL}
            className="group inline-flex min-h-12 items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-6 py-3.5 font-semibold text-white shadow-[0_0_0_1px_rgba(147,197,253,0.35)_inset,0_12px_40px_-8px_rgba(37,99,235,0.8)] transition hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            <MessageCircle size={18} strokeWidth={2} aria-hidden="true" />
            WhatsApp
            <span className="text-sm font-normal text-blue-100/80">· {t('landing.contact.whatsapp.sub')}</span>
            <ArrowUpRight size={16} aria-hidden="true" className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-flex min-h-12 items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3.5 font-semibold text-white backdrop-blur-sm transition hover:border-white/30 hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            <Mail size={18} strokeWidth={2} aria-hidden="true" />
            {t('landing.contact.email.title')}
            <span className="truncate text-sm font-normal text-white/60">· {CONTACT_EMAIL}</span>
          </a>
        </Reveal>
      </div>
    </section>
  );
}

/* ─── Footer ────────────────────────────────────────────────────── */
export function SiteFooter() {
  const { t } = useLanguage();
  const linkCls =
    'text-sm text-white/60 hover:text-white transition-colors rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400';
  return (
    <footer className="relative overflow-hidden border-t border-white/[0.07]">
      <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-16 pb-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <Image src="/WARESYS.svg" alt="WareSys" width={360} height={84} className="h-12 w-auto brightness-0 invert" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">{t('landing.footer.tagline')}</p>
          </div>
          <nav aria-label={t('landing.footer.product')}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">{t('landing.footer.product')}</p>
            <ul className="mt-4 space-y-3">
              <li><a href="#how-it-works" className={linkCls}>{t('landing.nav.howItWorks')}</a></li>
              <li><a href="#faq" className={linkCls}>{t('landing.nav.faq')}</a></li>
              <li><Link href="/login" className={linkCls}>{t('landing.nav.login')}</Link></li>
            </ul>
          </nav>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">{t('landing.footer.contact')}</p>
            <ul className="mt-4 space-y-3">
              <li><a href={WHATSAPP_URL} className={linkCls}>WhatsApp</a></li>
              <li><a href={`mailto:${CONTACT_EMAIL}`} className={`${linkCls} break-all`}>{CONTACT_EMAIL}</a></li>
              <li><a href="#contact" className={linkCls}>{t('landing.nav.bookDemo')}</a></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">{t('landing.footer.language')}</p>
            <div className="mt-4">
              <LanguageSwitcher dark />
            </div>
          </div>
        </div>
        <div className="mt-14 flex flex-col gap-2 border-t border-white/[0.07] pt-6 text-xs text-white/45 sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} WareSys</span>
          <span>{t('landing.footer.tagline')}</span>
        </div>
      </div>
      {/* oversized wordmark sinking into the bottom edge */}
      <p
        aria-hidden="true"
        className={`${display.className} pointer-events-none select-none -mb-[0.28em] text-center text-[21vw] font-bold leading-none tracking-[-0.06em] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),transparent)] bg-clip-text text-transparent`}
      >
        WARESYS
      </p>
    </footer>
  );
}
