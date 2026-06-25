'use client';

import { useRouter } from 'next/navigation';
import {
  Inbox,
  ArrowLeftRight,
  BarChart2,
  MessageCircle,
  Mail,
  ChevronRight,
  ShieldCheck,
  Users,
  ScanLine,
} from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-white text-black flex flex-col">

      {/* ─── NAV ─────────────────────────────────────────────── */}
      <div className="border-b-2 border-gray-300 sticky top-0 bg-white z-50">
        <div className="max-w-6xl mx-auto px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Warehouse OS</h1>
            <p className="text-xs text-gray-500">Spare parts inventory</p>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-500 font-medium">
            <a href="#how-it-works" className="hover:text-black transition">How it works</a>
            <a href="#faq" className="hover:text-black transition">FAQ</a>
            <a href="#contact" className="hover:text-black transition">Contact</a>
          </nav>
          <div className="flex gap-2">
            <a
              href="#contact"
              className="text-sm px-3 py-2 rounded-md border border-gray-300 hover:bg-gray-100 font-medium transition"
            >
              Book a Demo
            </a>
            <button
              onClick={() => router.push('/login')}
              className="text-sm px-3 py-2 rounded-md border border-gray-300 bg-black text-white hover:bg-gray-800 font-medium transition"
            >
              Login
            </button>
          </div>
        </div>
      </div>

      {/* ─── HERO ────────────────────────────────────────────── */}
      <section className="border-b-2 border-gray-300">
        <div className="max-w-6xl mx-auto px-8 py-24 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-5">
              Built for spare parts businesses
            </p>
            <h2 className="text-5xl font-black tracking-tight leading-[1.05] mb-6">
              Warehouse software<br />your team will<br />actually use.
            </h2>
            <p className="text-gray-500 text-base leading-relaxed mb-10 max-w-md">
              Receive stock, move parts between locations, and track everything — without spreadsheets.
            </p>
            <div className="flex gap-3 flex-wrap">
              <a
                href="#contact"
                className="flex items-center gap-1.5 text-sm px-5 py-3 rounded-md bg-black text-white hover:bg-gray-800 font-bold transition"
              >
                Book a Demo <ChevronRight size={15} />
              </a>
              <button
                onClick={() => router.push('/login')}
                className="flex items-center gap-1.5 text-sm px-5 py-3 rounded-md border border-gray-300 hover:bg-gray-100 font-medium transition"
              >
                Login →
              </button>
            </div>
          </div>

          {/* Feature checklist panel */}
          <div className="border border-gray-300 rounded-md divide-y divide-gray-200">
            {[
              { icon: ScanLine,    label: 'Barcode receiving',               sub: 'Scan on any device, instantly logged' },
              { icon: ArrowLeftRight, label: 'Stock transfers',              sub: 'Between locations with full history' },
              { icon: BarChart2,   label: 'Full inventory tracking',         sub: 'Live counts per location' },
              { icon: Users,       label: 'Multi-user access with roles',    sub: 'Admins and staff, separate views' },
              { icon: ShieldCheck, label: 'Complete audit logs',             sub: 'Every action timestamped' },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-center gap-4 px-5 py-4">
                <div className="shrink-0 p-2 border border-gray-300 rounded-md">
                  <Icon size={17} strokeWidth={2} className="text-black" />
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
                </div>
                <span className="ml-auto font-bold text-black text-sm">✓</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ────────────────────────────────────── */}
      <section id="how-it-works" className="border-b-2 border-gray-300 bg-gray-50">
        <div className="max-w-6xl mx-auto px-8 py-20">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            How it works
          </p>
          <h3 className="text-3xl font-black tracking-tight mb-12">
            From the dock to the shelf.
          </h3>

          <div className="grid md:grid-cols-3 gap-4">
            {[
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
            ].map(({ step, icon: Icon, title, body }) => (
              <div
                key={title}
                className="bg-white border border-gray-300 rounded-md p-6 flex flex-col gap-4"
              >
                <div className="flex items-center justify-between">
                  <div className="p-2 border border-gray-300 rounded-md">
                    <Icon size={18} strokeWidth={2} className="text-black" />
                  </div>
                  <span className="text-xs font-semibold text-gray-400 tracking-widest">{step}</span>
                </div>
                <div>
                  <p className="font-bold text-sm mb-1.5">{title}</p>
                  <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── STATS STRIP ─────────────────────────────────────── */}
      <section className="border-b-2 border-gray-300">
        <div className="max-w-6xl mx-auto px-8 py-12 grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-300">
          {[
            { value: 'Real-time', label: 'Stock visibility' },
            { value: 'Multi-site', label: 'Location support' },
            { value: 'Role-based', label: 'Access control' },
            { value: 'Full', label: 'Audit trail' },
          ].map(({ value, label }) => (
            <div key={label} className="bg-white px-8 py-8 text-center">
              <p className="text-2xl font-black tracking-tight mb-1">{value}</p>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────────────── */}
      <section id="faq" className="border-b-2 border-gray-300">
        <div className="max-w-6xl mx-auto px-8 py-20 grid md:grid-cols-[1fr_2fr] gap-16">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
              Common questions
            </p>
            <h3 className="text-3xl font-black tracking-tight">
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
                q: 'How much does it cost?',
                a: 'Pricing is based on team size. Book a demo and we will walk you through a plan that fits your operation.',
              },
              {
                q: 'How do I get started?',
                a: 'Book a demo below. We will set up your account, import your existing stock, and get your team trained in one session.',
              },
            ].map((item, i) => (
              <div key={i} className="py-5 border-b border-gray-200 last:border-0">
                <p className="font-bold text-sm mb-1.5">{item.q}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CONTACT ─────────────────────────────────────────── */}
      <section id="contact" className="bg-gray-50 border-b-2 border-gray-300">
        <div className="max-w-6xl mx-auto px-8 py-20 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
              Get in touch
            </p>
            <h3 className="text-3xl font-black tracking-tight mb-3">
              Ready to take control of your stock?
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              Book a demo or reach out directly. We will get back to you the same day.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <a
              href="https://wa.me/YOUR_NUMBER"
              className="flex items-center justify-between px-5 py-4 rounded-md border border-gray-300 bg-white hover:bg-gray-100 font-medium transition group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 border border-gray-300 rounded-md">
                  <MessageCircle size={17} strokeWidth={2} />
                </div>
                <div>
                  <p className="text-sm font-semibold">WhatsApp</p>
                  <p className="text-xs text-gray-500">Fastest response</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 group-hover:text-black transition" />
            </a>
            <a
              href="mailto:hello@warehouselayer.com"
              className="flex items-center justify-between px-5 py-4 rounded-md border border-gray-300 bg-white hover:bg-gray-100 font-medium transition group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 border border-gray-300 rounded-md">
                  <Mail size={17} strokeWidth={2} />
                </div>
                <div>
                  <p className="text-sm font-semibold">Email us</p>
                  <p className="text-xs text-gray-500">hello@warehouselayer.com</p>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 group-hover:text-black transition" />
            </a>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────── */}
      <div className="px-8 py-5 max-w-6xl mx-auto w-full flex justify-between items-center text-xs text-gray-400">
        <span className="font-bold text-black tracking-tight">Warehouse OS</span>
        <span>© {new Date().getFullYear()} · Built for spare parts businesses</span>
      </div>

    </main>
  );
}