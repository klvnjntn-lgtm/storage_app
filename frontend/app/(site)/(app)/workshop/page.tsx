// app/(app)/workshop/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Car, Bell, ArrowUpRight, ArrowLeft, Wrench } from 'lucide-react';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

const WORKSHOP_ITEMS = [
  {
    title: 'Vehicles',
    description: 'Track vehicles and service history',
    href: '/workshop/vehicles',
    icon: Car,
    gradient: 'from-sky-500 to-blue-700',
  },
  {
    title: 'Reminders',
    description: 'Service due dates and follow-ups',
    href: '/workshop/reminders',
    icon: Bell,
    gradient: 'from-amber-500 to-orange-700',
  },
];

export default function WorkshopHome() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-white text-black">
      {/* Header — matches Sales / Invoices / Statement page style */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to dashboard
          </button>

          <div className="flex items-center gap-2">
            <Wrench size={20} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">Workshop</h1>
              <p className="text-xs text-gray-500">
                Vehicles, service jobs, and reminders
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full px-6 pt-8 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {WORKSHOP_ITEMS.map(({ title, description, href, icon: Icon, gradient }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className={`group relative text-left rounded-lg p-6 bg-gradient-to-br ${gradient} text-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between`}
            >
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-white/15 p-2.5">
                  <Icon size={22} strokeWidth={2} />
                </span>
                <ArrowUpRight
                  size={18}
                  strokeWidth={2}
                  className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                />
              </div>
              <div>
                <p className={`${display.className} text-xl font-bold leading-tight`}>{title}</p>
                <p className="text-sm text-white/85 mt-0.5">{description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}