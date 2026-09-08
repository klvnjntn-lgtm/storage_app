// app/(app)/vehicles/search/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import {
  ArrowLeft,
  Car,
  Search,
  Gauge,
  ChevronRight,
  ExternalLink,
  Loader2,
  AlertCircle,
  RotateCcw,
  Trash2,
  CornerDownLeft,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { parseCalendarDate } from '@/lib/dates';
import Pagination from '@/app/components/Pagination';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type SearchResult = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  customerName: string;
};

type VehicleSummary = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  vin: string | null;
  odometer: number | null;
  customer: { id: string; name: string; companyName: string | null };
};

type HistoryItem = {
  id: string;
  invoiceNumber: string | null;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  total: string;
  issuedAt: string | null;
  createdAt: string;
  odometer: number | null;
  dueDate: string | null;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  items: Array<{
    id: string | number; // API sends a numeric id (e.g. 97319)
    quantity: number;
    description: string | null;
    product: { name: string } | null; // nested, matches the actual API response
  }>;
};

type HistoryPage = {
  items: HistoryItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const DEBOUNCE_MS = 350;
const HISTORY_LIMIT_DEFAULT = 20;
const ITEMS_SUMMARY_MAX = 3;

function displayDateFor(h: HistoryItem): Date {
  return new Date(h.issuedAt ?? h.createdAt);
}

// Same rule as /vehicles/[id] and the invoices list page: only ISSUED,
// not fully PAID, and past its due date (compared by local calendar day).
function isOverdue(h: HistoryItem): boolean {
  if (h.status !== 'ISSUED') return false;
  if (h.paymentStatus === 'PAID') return false;
  if (!h.dueDate) return false;

  const due = parseCalendarDate(h.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function itemLabel(item: HistoryItem['items'][number]): string {
  const label = item.product?.name ?? item.description ?? 'Item';
  return item.quantity > 1 ? `${item.quantity}× ${label}` : label;
}

// Same shape as /vehicles/[id]'s itemsToShow — one line per item (not
// comma-joined, so a multi-part job stays readable) capped at 3, with an
// overflow count beyond that. Takes an optional item-level search query
// (separate from the vehicle-lookup query above): when present, matching
// items float to the top, same as /vehicles/[id].
function itemsToShow(
  items: HistoryItem['items'],
  itemQuery: string,
): { lines: string[]; overflow: number } {
  if (items.length === 0) return { lines: ['No items recorded'], overflow: 0 };

  const q = itemQuery.trim().toLowerCase();
  const labels = items.map(itemLabel);

  const ordered = q
    ? [...labels].sort((a, b) => {
        const aMatch = a.toLowerCase().includes(q) ? 0 : 1;
        const bMatch = b.toLowerCase().includes(q) ? 0 : 1;
        return aMatch - bMatch;
      })
    : labels;

  if (ordered.length <= ITEMS_SUMMARY_MAX) return { lines: ordered, overflow: 0 };
  return { lines: ordered.slice(0, ITEMS_SUMMARY_MAX), overflow: ordered.length - ITEMS_SUMMARY_MAX };
}

export default function VehicleLookupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Search bar state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);

  // Selected vehicle state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [vehicleError, setVehicleError] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(HISTORY_LIMIT_DEFAULT);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Item-level search — separate from the vehicle-lookup `query` above.
  // Filters within the currently-loaded history page only (history is
  // paginated server-side, unlike /vehicles/[id] which loads everything
  // at once), reordering matching items to the top of each card just
  // like /vehicles/[id]'s itemsToShow.
  const [itemSearch, setItemSearch] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set right before a *programmatic* setQuery (e.g. after picking a
  // vehicle) so the debounced search effect below doesn't treat it like
  // user typing and pop the dropdown back open.
  const skipNextSearchRef = useRef(false);

  // ── Debounced typeahead search ──────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setDropdownOpen(false);
      setNotFound(null);
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
          setNotFound(data.length === 0 ? trimmed : null);
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
  }, [query]);

  // ── Deep link from /workshop (?q=BP1234XX) ────────────────────────────
  // Runs once on mount. Goes straight to the exact-match endpoint rather
  // than setQuery()-then-waiting-for-the-debounce, so a link click lands
  // directly on the vehicle instead of first flashing a dropdown. Uses the
  // same multi-field search() as typing does (plate, model, VIN, customer
  // name) — a single match goes straight through, several matches (e.g. a
  // common customer name) fall back to showing the dropdown for disambiguation.
  useEffect(() => {
    const initialQ = searchParams.get('q');
    if (!initialQ) return;
    setQuery(initialQ);

    (async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/vehicles/search?q=${encodeURIComponent(initialQ)}`);
        if (res.ok) {
          const data: SearchResult[] = await res.json();
          if (data.length === 1) {
            await selectVehicle(data[0].id, data[0].plateNumber);
          } else if (data.length > 1) {
            setResults(data);
            setDropdownOpen(true);
            setHighlightIndex(0);
          } else {
            setNotFound(initialQ);
          }
        }
      } catch {
        setVehicleError('Could not reach the server.');
      } finally {
        setSearching(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Selecting a vehicle ──────────────────────────────────────────────
  async function selectVehicle(id: string, plateNumber: string) {
    setDropdownOpen(false);
    setNotFound(null);
    skipNextSearchRef.current = true; // this setQuery is programmatic, not typing
    setQuery(plateNumber);
    setSelectedId(id);
    setVehicle(null);
    setHistory(null);
    setHistoryPage(1);
    setItemSearch(''); // reset the item filter for the newly selected vehicle
    setVehicleError(null);
    setVehicleLoading(true);

    try {
      const res = await apiFetch(`/vehicles/${id}/summary`);
      if (res.ok) {
        setVehicle(await res.json());
        await loadHistory(id, 1, historyPageSize);
      } else {
        const body = await res.json().catch(() => null);
        setVehicleError(body?.message ?? `Failed to load vehicle (${res.status})`);
      }
    } catch {
      setVehicleError('Could not reach the server.');
    } finally {
      setVehicleLoading(false);
    }
  }

  async function loadHistory(vehicleId: string, page: number, limit: number = historyPageSize) {
    setHistoryLoading(true);
    try {
      const res = await apiFetch(`/vehicles/${vehicleId}/history?page=${page}&limit=${limit}`);
      if (res.ok) {
        setHistory(await res.json());
        setHistoryPage(page);
      }
    } catch {
      // Leave existing history visible on a transient error.
    } finally {
      setHistoryLoading(false);
    }
  }

  // Same discard behavior as /vehicles/[id] — removes the draft from the
  // currently-shown history page in place, no full refetch.
  async function discardDraft(id: string) {
    const res = await apiFetch(`/invoices/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setHistory((prev) => (prev ? { ...prev, items: prev.items.filter((h) => h.id !== id) } : prev));
    }
  }

  // ── Enter-to-confirm ─────────────────────────────────────────────────
  // 1. If the dropdown is already open, take whatever's highlighted —
  //    works whether it matched on plate, model, VIN, or customer name.
  // 2. Otherwise (e.g. typed fast and hit Enter before the 350ms debounce
  //    fired), run the same multi-field search() directly: if it resolves
  //    to exactly one vehicle, go straight there; if it resolves to more
  //    than one (a common customer name can easily match several cars),
  //    surface the dropdown instead of guessing which one they meant.
  async function confirmSelection() {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (dropdownOpen && results[highlightIndex]) {
      const r = results[highlightIndex];
      await selectVehicle(r.id, r.plateNumber);
      return;
    }

    setSearching(true);
    try {
      const res = await apiFetch(`/vehicles/search?q=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        const data: SearchResult[] = await res.json();
        if (data.length === 1) {
          await selectVehicle(data[0].id, data[0].plateNumber);
        } else if (data.length > 1) {
          setResults(data);
          setDropdownOpen(true);
          setHighlightIndex(0);
        } else {
          setNotFound(trimmed);
          setDropdownOpen(false);
        }
      }
    } catch {
      setVehicleError('Could not reach the server.');
    } finally {
      setSearching(false);
    }
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
      confirmSelection();
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  }

  function startNewSearch(value: string) {
    // Typing a new plate after a vehicle is already shown: clear the
    // selected vehicle/history so stale data doesn't linger under a
    // half-typed query, but keep it lightweight — no full page reset.
    setQuery(value);
    if (selectedId) {
      setSelectedId(null);
      setVehicle(null);
      setHistory(null);
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
      {/* Header — blue-outline + backdrop-blur treatment matching /labels,
          /inventory/stock, and /customers. Widened to max-w-5xl to match
          those pages instead of the old max-w-3xl. */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-6 py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/workshop')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-3 transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Workshop
          </button>

          <div className="flex items-center gap-2.5 mb-4">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Search size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Vehicle History Lookup
              </h1>
              <p className="text-xs text-gray-500 truncate">
                Search by plate, model, VIN, or customer to jump straight to history
              </p>
            </div>
          </div>

          {/* Search bar — command-palette style: outlined, focus glow,
              monospace Enter hint. Logic (debounce, dropdown, arrow-key
              nav, deep link) is unchanged — only the visual treatment. */}
          <div className="relative">
            <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
              <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => startNewSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => results.length > 0 && setDropdownOpen(true)}
                onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                placeholder="Enter plate, model, VIN, or customer name..."
                autoFocus
                className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
              />
              {searching ? (
                <Loader2 size={15} strokeWidth={2} className="text-blue-600/60 animate-spin shrink-0" />
              ) : (
                <button
                  onClick={confirmSelection}
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
                    onMouseDown={() => selectVehicle(r.id, r.plateNumber)}
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
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {notFound && !vehicleLoading && !vehicle && (
          <p className="text-sm text-gray-500 bg-white border-2 border-gray-200 rounded-md p-4 text-center">
            No vehicle found for &quot;{notFound}&quot;
          </p>
        )}

        {vehicleError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{vehicleError}</p>
        )}

        {vehicleLoading && <p className="text-sm text-gray-500">Loading vehicle...</p>}

        {vehicle && (
          <>
            {/* Vehicle summary card */}
            <div className="border-2 border-gray-300 rounded-md p-4 mb-4 bg-white">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <Car size={20} strokeWidth={2} className="text-gray-700 shrink-0" />
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold truncate">{vehicle.plateNumber}</h2>
                    <p className="text-sm text-gray-500 truncate">{vehicle.vehicleModel}</p>
                  </div>
                </div>
                <button
                  onClick={() => router.push(`/vehicles/${vehicle.id}`)}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md border-2 border-blue-600/30 text-blue-700 hover:bg-blue-50 shrink-0 transition-colors"
                >
                  <ExternalLink size={13} strokeWidth={2} />
                  View Full Vehicle Profile
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-3 text-sm">
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-500">Customer</p>
                  <p className="font-semibold truncate">
                    {vehicle.customer.name}
                    {vehicle.customer.companyName ? ` · ${vehicle.customer.companyName}` : ''}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-500">VIN</p>
                  <p className="font-semibold truncate">{vehicle.vin ?? '—'}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-500">Odometer</p>
                  <p className="font-semibold truncate">
                    {vehicle.odometer != null ? `${vehicle.odometer.toLocaleString('id-ID')} km` : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* History */}
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-600">Service / Invoice History</h3>
              <div className="relative w-full sm:w-56">
                <Search size={13} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Find a part/service on this page..."
                  className="w-full border-2 border-gray-300 rounded-md pl-8 pr-3 py-1.5 text-xs outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {historyLoading && !history && <p className="text-sm text-gray-500">Loading history...</p>}

            {history && history.items.length === 0 && (
              <p className="text-sm text-gray-400">No service history yet for this vehicle.</p>
            )}

            <div className="flex flex-col gap-2">
              {history?.items.map((h) => {
                const { lines, overflow } = itemsToShow(h.items, itemSearch);
                const overdue = isOverdue(h);
                return (
                  <div
                    key={h.id}
                    onClick={() =>
                      router.push(h.status === 'DRAFT' ? `/sales/invoices/new?draftId=${h.id}` : `/sales/invoices/${h.id}`)
                    }
                    className={`flex flex-col gap-1.5 border-2 rounded-md p-3 cursor-pointer bg-white transition-colors ${
                      overdue
                        ? 'border-red-300 bg-red-50/40 hover:border-red-400 hover:bg-red-50 active:bg-red-100'
                        : 'border-gray-300 hover:border-blue-500/40 hover:bg-blue-50/40 active:bg-blue-100/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">{displayDateFor(h).toLocaleDateString('id-ID')}</span>
                      <span className="font-semibold">{h.invoiceNumber ?? 'Unissued draft'}</span>
                      {h.status === 'VOID' && (
                        <span className="text-xs px-2 py-0.5 rounded-md border bg-gray-100 text-gray-600 border-gray-300">
                          VOID
                        </span>
                      )}
                      {overdue && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border font-medium bg-red-100 text-red-800 border-red-400">
                          <AlertCircle size={11} strokeWidth={2} />
                          OVERDUE
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-700 leading-snug">
                      {lines.map((line, i) => (
                        <p key={i} className="truncate">
                          {line}
                        </p>
                      ))}
                      {overflow > 0 && <p className="text-xs text-gray-400">+{overflow} more</p>}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        {h.odometer != null && (
                          <>
                            <Gauge size={11} strokeWidth={2} />
                            {h.odometer.toLocaleString('id-ID')} km
                          </>
                        )}
                      </span>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold text-sm">{formatIDR(Number(h.total))}</span>

                        {h.status === 'DRAFT' ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => router.push(`/sales/invoices/new?draftId=${h.id}`)}
                              className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-gray-300 hover:bg-blue-50 active:bg-blue-100"
                            >
                              <RotateCcw size={13} strokeWidth={2} />
                              Resume
                            </button>
                            <button
                              onClick={() => discardDraft(h.id)}
                              className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-gray-300 hover:bg-red-50 active:bg-red-100 hover:border-red-300 text-red-600"
                            >
                              <Trash2 size={13} strokeWidth={2} />
                              Discard
                            </button>
                          </div>
                        ) : (
                          <span className="flex items-center gap-0.5 text-xs text-gray-400">
                            View
                            <ChevronRight size={13} strokeWidth={2} />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {history && history.total > 0 && (
              <div className="mt-4">
                <Pagination
                  page={historyPage}
                  pageSize={historyPageSize}
                  totalItems={history.total}
                  onPageChange={(p) => selectedId && loadHistory(selectedId, p, historyPageSize)}
                  onPageSizeChange={(size) => {
                    setHistoryPageSize(size);
                    if (selectedId) loadHistory(selectedId, 1, size);
                  }}
                />
              </div>
            )}
          </>
        )}

        {!vehicle && !vehicleLoading && !notFound && (
          <div className="flex flex-col items-center justify-center text-center py-16 text-gray-400">
            <Search size={32} strokeWidth={1.5} className="mb-3" />
            <p className="text-sm">Start typing a plate number above to see its history.</p>
          </div>
        )}
      </div>
    </main>
  );
}