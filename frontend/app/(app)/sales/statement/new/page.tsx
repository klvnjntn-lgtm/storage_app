// app/(app)/sales/statement/new/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Search, Car, Calendar, X, Check } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useHasModule } from '@/lib/useHasModule';
import { Vehicle } from '@/app/components/invoices/types';

// Entry point for building a statement: pick a customer, optionally
// scope to one or more of their vehicles (WORKSHOP_RMS orgs only), pick
// a date range, then hand off to /sales/statement to render + print it.
// This page holds no state of its own beyond the form — leaving it and
// coming back means starting over, which is intentional.
//
// "All vehicles" (i.e. no selection) includes every invoice for the
// customer, vehicle-tagged or not — there's no separate "General" choice
// to make since plenty of orgs invoice customers with no car involved at
// all (parts-only sales, non-workshop customers, etc).

type CustomerSearchResult = {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
};

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toDateInput(d);
}

const PRESETS = [
  { label: 'This month', from: () => { const d = new Date(); d.setDate(1); return d; } },
  { label: 'Last month', from: () => { const d = new Date(); d.setMonth(d.getMonth() - 1, 1); return d; }, to: () => { const d = new Date(); d.setDate(0); return d; } },
  { label: 'Last 3 months', from: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d; } },
  { label: 'This year', from: () => { const d = new Date(); d.setMonth(0, 1); return d; } },
];

export default function NewStatementPage() {
  const router = useRouter();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');

  // Customer search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);

  // Vehicle scoping — multi-select, only shown for WORKSHOP_RMS orgs.
  // Empty array = no filter = all invoices for this customer.
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);

  // Date range
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(toDateInput(new Date()));

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: query.trim() });
        const res = await apiFetch(`/customers?${params}`);
        if (res.ok && !cancelled) setResults(await res.json());
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  useEffect(() => {
    if (!selectedCustomer || !hasWorkshopRms) {
      setVehicles([]);
      return;
    }
    let cancelled = false;
    setVehiclesLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/customers/${selectedCustomer.id}/vehicles`);
        if (res.ok && !cancelled) setVehicles(await res.json());
      } finally {
        if (!cancelled) setVehiclesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer, hasWorkshopRms]);

  function pickCustomer(c: CustomerSearchResult) {
    setSelectedCustomer(c);
    setQuery('');
    setResults([]);
    setShowResults(false);
    setSelectedVehicleIds([]);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setVehicles([]);
    setSelectedVehicleIds([]);
  }

  function toggleVehicle(id: string) {
    setSelectedVehicleIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setFrom(toDateInput(preset.from()));
    setTo(toDateInput(preset.to ? preset.to() : new Date()));
  }

  function generate() {
    if (!selectedCustomer) return;
    const params = new URLSearchParams({
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      from,
      to,
    });
    for (const id of selectedVehicleIds) params.append('vehicleId', id);
    router.push(`/sales/statement?${params}`);
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back
          </button>

          <div className="flex items-center gap-2">
            <FileText size={22} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">Generate Statement</h1>
              <p className="text-xs text-gray-500">Choose a customer, optionally one or more vehicles, and a date range.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {/* Customer search */}
        <div className="mb-5">
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Customer</label>

          {selectedCustomer ? (
            <div className="flex items-center justify-between border-2 border-black rounded-md p-3">
              <div>
                <p className="font-semibold">{selectedCustomer.name}</p>
                {(selectedCustomer.companyName || selectedCustomer.phone) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {selectedCustomer.companyName ? `${selectedCustomer.companyName} · ` : ''}
                    {selectedCustomer.phone ?? ''}
                  </p>
                )}
              </div>
              <button onClick={clearCustomer} className="text-gray-400 hover:text-black">
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <div className="relative" ref={searchBoxRef}>
              <div className="flex items-center gap-2 border-2 border-gray-300 rounded-md p-2 focus-within:border-black">
                <Search size={15} strokeWidth={2} className="text-gray-400 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShowResults(true);
                  }}
                  onFocus={() => setShowResults(true)}
                  placeholder="Search customer by name, company, or phone"
                  className="flex-1 text-sm outline-none"
                  autoFocus
                />
              </div>

              {showResults && query.trim() && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 border-2 border-gray-300 rounded-md bg-white shadow-lg max-h-64 overflow-y-auto">
                  {searching && <p className="text-sm text-gray-500 p-3">Searching...</p>}
                  {!searching && results.length === 0 && (
                    <p className="text-sm text-gray-400 p-3">No customers found.</p>
                  )}
                  {!searching &&
                    results.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => pickCustomer(c)}
                        className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-xs text-gray-500">
                          {c.companyName ? `${c.companyName} · ` : ''}
                          {c.phone ?? ''}
                        </p>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Vehicle scope — WORKSHOP_RMS only. Multi-select; nothing checked = all. */}
        {selectedCustomer && hasWorkshopRms && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                <Car size={12} strokeWidth={2} />
                Vehicles
              </label>
              {selectedVehicleIds.length > 0 && (
                <button
                  onClick={() => setSelectedVehicleIds([])}
                  className="text-xs text-gray-500 hover:text-black"
                >
                  Clear ({selectedVehicleIds.length})
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mb-2">
              Leave all unchecked to include invoices for every vehicle (and any without one).
            </p>

            {vehiclesLoading && <p className="text-sm text-gray-500">Loading vehicles...</p>}
            {!vehiclesLoading && vehicles.length === 0 && (
              <p className="text-sm text-gray-400">No vehicles on file for this customer.</p>
            )}
            {!vehiclesLoading && vehicles.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {vehicles.map((v) => {
                  const checked = selectedVehicleIds.includes(v.id);
                  return (
                    <label
                      key={v.id}
                      className={`flex items-center gap-2.5 border-2 rounded-md p-2.5 cursor-pointer ${
                        checked ? 'border-black bg-gray-50' : 'border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleVehicle(v.id)}
                        className="w-4 h-4 accent-black"
                      />
                      <span className="text-sm font-medium">{v.plateNumber} · {v.vehicleModel}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Date range */}
        <div className="mb-6">
          <label className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
            <Calendar size={12} strokeWidth={2} />
            Date range
          </label>

          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => applyPreset(preset)}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-black hover:bg-gray-50"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-gray-500">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2 text-sm w-full"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-gray-500">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border-2 border-gray-300 rounded-md p-2 text-sm w-full"
              />
            </div>
          </div>
        </div>

        <button
          onClick={generate}
          disabled={!selectedCustomer}
          className="w-full flex items-center justify-center gap-2 bg-black text-white rounded-md p-3 text-sm font-semibold hover:bg-gray-800 disabled:bg-gray-300"
        >
          <Check size={16} strokeWidth={2} />
          Generate Statement
        </button>
      </div>
    </main>
  );
}