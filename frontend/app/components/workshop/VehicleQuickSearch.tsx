'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

type SearchResult = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  customerName: string;
};

const DEBOUNCE_MS = 350;

// "B 1234 XYZ" and "b1234xyz" are the same plate.
const normalizePlate = (s: string) => s.replace(/\s+/g, '').toUpperCase();

// Command-palette style vehicle search (workshop hub, vehicle detail header).
// Typing shows a live matches dropdown (plate/model/VIN/customer) but never
// navigates on its own. Clicking a row or Enter on a highlighted row opens
// that vehicle; Enter on raw text opens the vehicle if it's an exact plate
// match or the only match, otherwise the Vehicles list filtered by the text.
export function VehicleQuickSearch({ compact = false, dataTour }: { compact?: boolean; dataTour?: string }) {
  const router = useRouter();
  const { t } = useLanguage();

  const [quickPlate, setQuickPlate] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  // The text `results` were fetched for — Enter must not act on a stale
  // match list while a newer keystroke's search is still debouncing.
  const [resultsFor, setResultsFor] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = quickPlate.trim();
  // An empty box shows nothing, without needing to clear state in an effect.
  const visible = trimmed ? results : [];

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmed) return;

    let cancelled = false; // set when a newer keystroke supersedes this search
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/vehicles/search?q=${encodeURIComponent(trimmed)}`);
        if (cancelled) return;
        if (res.ok) {
          const data: SearchResult[] = await res.json();
          if (cancelled) return;
          setResults(data);
          setResultsFor(trimmed);
          setDropdownOpen(data.length > 0);
          setHighlightIndex(0);
        }
      } catch {
        // Stay quiet on transient search errors — the user can just keep typing.
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [trimmed]);

  // Cleared after navigating: on the detail page this component stays
  // mounted when moving from one vehicle to the next.
  function go(href: string) {
    setDropdownOpen(false);
    setQuickPlate('');
    router.push(href);
  }

  function goToLookup() {
    const current = resultsFor === trimmed ? visible : [];
    const exact = current.find((r) => normalizePlate(r.plateNumber) === normalizePlate(trimmed));
    const match = exact ?? (current.length === 1 ? current[0] : undefined);
    if (trimmed && match) return go(`/workshop/vehicles/${match.id}`);
    go(trimmed ? `/workshop/vehicles?query=${encodeURIComponent(trimmed)}` : '/workshop/vehicles');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (dropdownOpen) setHighlightIndex((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (dropdownOpen) setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Take the highlighted dropdown row if one's showing, otherwise
      // fall back to the raw typed text (see goToLookup).
      if (dropdownOpen && visible[highlightIndex]) {
        go(`/workshop/vehicles/${visible[highlightIndex].id}`);
      } else {
        goToLookup();
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  }

  return (
    <div data-tour={dataTour} className="relative">
      <div
        className={`group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35 ${
          compact ? 'py-2' : 'py-3.5'
        }`}
      >
        <Search size={compact ? 15 : 17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
        <input
          value={quickPlate}
          onChange={(e) => setQuickPlate(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => visible.length > 0 && setDropdownOpen(true)}
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

      {dropdownOpen && visible.length > 0 && (
        <div className="absolute left-0 right-0 mt-1.5 border border-blue-500/20 rounded-xl bg-white shadow-lg overflow-hidden z-20 max-h-[70vh] overflow-y-auto">
          {visible.map((r, idx) => (
            <button
              key={r.id}
              onMouseDown={() => go(`/workshop/vehicles/${r.id}`)}
              onMouseEnter={() => setHighlightIndex(idx)}
              className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors ${
                idx === highlightIndex ? 'bg-blue-50' : 'bg-white'
              } ${idx !== visible.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <span className="font-semibold shrink-0">{r.plateNumber}</span>
              {/* min-w-0 lets `truncate` clamp inside a flex row instead of
                  forcing horizontal scroll on narrow screens. */}
              <span className="text-gray-500 truncate min-w-0 flex-1 text-right">
                {r.vehicleModel} · {r.customerName}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
