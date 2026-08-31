// app/(app)/vehicles/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Car, Search } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type VehicleListItem = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  vin: string | null;
  odometer: number | null;
  customer: { id: string; name: string; companyName: string | null };
};

const PAGE_SIZE = 20;

export default function VehiclesPage() {
  const router = useRouter();

  const [vehicles, setVehicles] = useState<VehicleListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  async function load(q?: string) {
    setLoading(true);
    setError('');
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await apiFetch(`/vehicles${params}`);
      if (res.ok) {
        setVehicles(await res.json());
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Failed to load vehicles (${res.status})`);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => load(query.trim() || undefined), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Reset to page 1 whenever the query (and therefore the underlying
  // result set) changes.
  useEffect(() => {
    setPage(1);
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(vehicles.length / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedVehicles = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return vehicles.slice(start, start + PAGE_SIZE);
  }, [vehicles, page]);

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Hub
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <Car size={22} strokeWidth={2} className="text-gray-700 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold truncate">Vehicles</h1>
              <p className="text-xs text-gray-500 truncate">Every vehicle on file, across all customers</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="relative mb-4 sm:max-w-sm">
          <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by plate, model, VIN, or customer..."
            className="w-full border-2 border-gray-300 rounded-md pl-9 pr-3 py-2.5 sm:py-2 text-sm outline-none focus:border-black"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>
        )}

        {/* This table deliberately scrolls horizontally on narrow screens
            (min-w-[720px] + overflow-x-auto) rather than becoming cards —
            it's a dense, read-only reference list, so a swipe-to-see-more
            table is a reasonable trade-off vs. the effort of a full mobile
            card rework. Say the word if you'd rather it match the
            card-per-row treatment used on the customers page. */}
        <div className="border-2 border-gray-300 rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-100 border-b-2 border-gray-300">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Plate</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Car</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">VIN</th>
                  <th className="text-right px-4 py-3 font-semibold whitespace-nowrap">Latest Odometer</th>
                </tr>
              </thead>
              <tbody>
                {paginatedVehicles.map((v, idx) => (
                  <tr
                    key={v.id}
                    onClick={() => router.push(`/workshop/vehicles/${v.id}`)}
                    className={`border-t border-gray-300 cursor-pointer hover:bg-gray-100 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                  >
                    <td className="px-4 py-3 font-medium whitespace-nowrap">{v.plateNumber}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.vehicleModel}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {v.customer.name}
                      {v.customer.companyName ? ` · ${v.customer.companyName}` : ''}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.vin ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                      {v.odometer != null ? `${v.odometer.toLocaleString('id-ID')} km` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && vehicles.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">No vehicles found</div>
          )}
          {loading && <div className="p-8 text-center text-sm text-gray-500">Loading...</div>}
        </div>

        {/* Pagination */}
        {vehicles.length > 0 && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, vehicles.length)} of {vehicles.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Prev
              </button>
              <span className="text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 border-2 border-gray-300 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}