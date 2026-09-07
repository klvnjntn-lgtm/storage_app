// app/(app)/workshop/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { Car, Bell, ArrowUpRight, ArrowLeft, Wrench, Search, CornerDownLeft, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

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
    title: 'Vehicle Lookup',
    description: 'Jump straight to a plate\'s history',
    href: '/workshop/vehicles/search',
    icon: Search,
    gradient: 'from-blue-600 to-indigo-800',
  },
  {
    title: 'Reminders',
    description: 'Service due dates and follow-ups',
    href: '/workshop/reminders',
    icon: Bell,
    gradient: 'from-amber-500 to-orange-700',
  },
];

type SearchResult = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  customerName: string;
};

const DEBOUNCE_MS = 350;

export default function WorkshopHome() {
  const router = useRouter();

  // Quick lookup — shows a live dropdown as you type (same /vehicles/search
  // API the lookup page itself uses), but this box never resolves/loads a
  // vehicle on its own. Selecting a row (click or Enter) just navigates to
  // /vehicles/search?q=<plate>, and that page's existing deep-link effect
  // resolves and auto-selects it there.
  const [quickPlate, setQuickPlate] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = quickPlate.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setDropdownOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/vehicles/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data: SearchResult[] = await res.json();
          setResults(data);
          setDropdownOpen(data.length > 0);
          setHighlightIndex(0);
        }
      } catch {
        // Stay quiet on transient search errors — the user can just keep typing.
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [quickPlate]);

  function goToLookup(plateOverride?: string) {
    const trimmed = (plateOverride ?? quickPlate).trim();
    router.push(trimmed ? `/workshop/vehicles/search?q=${encodeURIComponent(trimmed)}` : '/workshop/vehicles/search');
  }

  function selectResult(r: SearchResult) {
    setDropdownOpen(false);
    goToLookup(r.plateNumber);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (dropdownOpen) setHighlightIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (dropdownOpen) setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Take the highlighted dropdown row if one's showing, otherwise
      // fall back to navigating with the raw typed text (the lookup
      // page's own search/dropdown handles disambiguation from there).
      if (dropdownOpen && results[highlightIndex]) {
        selectResult(results[highlightIndex]);
      } else {
        goToLookup();
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Header — subtle blue outline + backdrop blur instead of the flat
          white/gray-300 border, to read as "techy" rather than plain */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-6 py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-3 transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to dashboard
          </button>

          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20">
              <Wrench size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div>
              <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>Workshop</h1>
              <p className="text-xs text-gray-500">Vehicles, service jobs, and reminders</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full px-6 pt-8 pb-16">
        {/* Quick vehicle lookup — command-palette style trigger. Typing
            shows a live matches dropdown (plate/model/VIN/customer, same
            as the lookup page), but doesn't navigate on its own — only
            pressing Enter or clicking a row sends you to
            /vehicles/search?q=... where that vehicle gets auto-selected. */}
        <div className="mb-8 relative">
          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={quickPlate}
              onChange={(e) => setQuickPlate(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => results.length > 0 && setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              placeholder="Look up a vehicle — plate, model, VIN, or customer..."
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {searching ? (
              <Loader2 size={15} strokeWidth={2} className="text-blue-600/60 animate-spin shrink-0" />
            ) : (
              <button
                onClick={() => goToLookup()}
                className="flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-600/10 border border-blue-600/20 rounded-md px-2 py-1 shrink-0 hover:bg-blue-600/15 transition-colors"
              >
                Enter
                <CornerDownLeft size={11} strokeWidth={2} />
              </button>
            )}
          </div>

          {dropdownOpen && results.length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 border border-blue-500/20 rounded-xl bg-white shadow-lg overflow-hidden z-20">
              {results.map((r, idx) => (
                <button
                  key={r.id}
                  onMouseDown={() => selectResult(r)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors ${
                    idx === highlightIndex ? 'bg-blue-50' : 'bg-white'
                  } ${idx !== results.length - 1 ? 'border-b border-gray-100' : ''}`}
                >
                  <span className="font-semibold">{r.plateNumber}</span>
                  <span className="text-gray-500 truncate">
                    {r.vehicleModel} · {r.customerName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {WORKSHOP_ITEMS.map(({ title, description, href, icon: Icon, gradient }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className={`group relative text-left rounded-xl p-6 bg-gradient-to-br ${gradient} text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[150px] flex flex-col justify-between`}
            >
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-white/15 p-2.5 ring-1 ring-white/10">
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