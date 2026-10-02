// app/(app)/workshop/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Car, Bell, Search, CornerDownLeft, Loader2 } from 'lucide-react';
import { HubCard, HubGrid, HubPage, HubSection } from '@/app/components/shared/Hub';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';


type SearchResult = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  customerName: string;
};

const DEBOUNCE_MS = 350;

export default function WorkshopHome() {
  const router = useRouter();
  const { t } = useLanguage();

  const WORKSHOP_ITEMS = [
    {
      title: t('workshop.overview.vehiclesCardTitle'),
      description: t('workshop.overview.vehiclesCardDescription'),
      href: '/workshop/vehicles',
      icon: Car,
      gradient: 'from-sky-500 to-blue-700',
    },
    {
      title: t('workshop.overview.lookupCardTitle'),
      description: t('workshop.overview.lookupCardDescription'),
      href: '/workshop/vehicles/search',
      icon: Search,
      gradient: 'from-blue-600 to-indigo-800',
    },
    {
      title: t('workshop.overview.remindersCardTitle'),
      description: t('workshop.overview.remindersCardDescription'),
      href: '/workshop/reminders',
      icon: Bell,
      gradient: 'from-amber-500 to-orange-700',
    },
  ];

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
    <HubPage path="~/workshop" title={t('workshop.overview.title')} subtitle={t('workshop.overview.subtitle')}>
      {/* Quick vehicle lookup — command-palette style trigger. Typing
          shows a live matches dropdown (plate/model/VIN/customer, same
          as the lookup page), but doesn't navigate on its own — only
          pressing Enter or clicking a row sends you to
          /vehicles/search?q=... where that vehicle gets auto-selected. */}
      <HubSection index="01" label={t('common.hubSearch')}>
        <div data-tour="rms-search" className="relative">
          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={quickPlate}
              onChange={(e) => setQuickPlate(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => results.length > 0 && setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              placeholder={t('workshop.overview.quickLookupPlaceholder')}
              className="flex-1 min-w-0 text-base sm:text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {searching ? (
              <Loader2 size={15} strokeWidth={2} className="text-blue-600/60 animate-spin shrink-0" />
            ) : (
              <button
                onClick={() => goToLookup()}
                className="flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-600/10 border border-blue-600/20 rounded-md px-2 py-1 shrink-0 hover:bg-blue-600/15 transition-colors"
              >
                {t('workshop.overview.enter')}
                <CornerDownLeft size={11} strokeWidth={2} />
              </button>
            )}
          </div>

          {dropdownOpen && results.length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 border border-blue-500/20 rounded-xl bg-white shadow-lg overflow-hidden z-20 max-h-[70vh] overflow-y-auto">
              {results.map((r, idx) => (
                <button
                  key={r.id}
                  onMouseDown={() => selectResult(r)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors ${
                    idx === highlightIndex ? 'bg-blue-50' : 'bg-white'
                  } ${idx !== results.length - 1 ? 'border-b border-gray-100' : ''}`}
                >
                  <span className="font-semibold shrink-0">{r.plateNumber}</span>
                  {/* CHANGED — needs min-w-0 for `truncate` to actually
                      clamp inside a flex row; without it this span could
                      grow past the container width and force horizontal
                      scroll on narrow screens. */}
                  <span className="text-gray-500 truncate min-w-0 flex-1 text-right">
                    {r.vehicleModel} · {r.customerName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </HubSection>

      <HubSection index="02" label={t('common.hubMenu')}>
        <HubGrid>
          {WORKSHOP_ITEMS.map(({ href, ...item }) => (
            <HubCard
              key={href}
              {...item}
              dataTour={`rms-card-${href.split('/').pop()}`}
              onClick={() => router.push(href)}
            />
          ))}
        </HubGrid>
      </HubSection>
    </HubPage>
  );
}