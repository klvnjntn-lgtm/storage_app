// app/(app)/workshop/vehicles/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import { ArrowLeft, Car, Search } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import Pagination from '@/app/components/Pagination';
import { useSortableData } from '@/lib/hooks/useSortableData';
import SortableTh from '@/app/components/SortableTh';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

type VehicleListItem = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  vin: string | null;
  odometer: number | null;
  customer: { id: string; name: string; companyName: string | null };
};

// Columns the table can be sorted by. VIN is deliberately excluded — same
// reasoning as Customers' Address: it's an identifier people scan/match
// against a document, not a value with a meaningful order.
type SortKey = 'plate' | 'model' | 'customer' | 'odometer';

const PAGE_SIZE_DEFAULT = 20;

export default function VehiclesPage() {
  const router = useRouter();

  const [vehicles, setVehicles] = useState<VehicleListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

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

  // The whole result set is loaded client-side (no server pagination
  // here), so — same as Stock and Customers — sorting applies across the
  // full list, and pagination slices the already-sorted array below.
  const { sorted: sortedVehicles, sort, toggleSort } = useSortableData<VehicleListItem, SortKey>(
    vehicles,
    {
      plate: (v) => v.plateNumber,
      model: (v) => v.vehicleModel,
      customer: (v) => v.customer.name,
      odometer: (v) => v.odometer ?? -1,
    },
  );

  const totalPages = Math.max(1, Math.ceil(sortedVehicles.length / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedVehicles = sortedVehicles.slice((page - 1) * pageSize, page * pageSize);

  function cellHighlight(key: SortKey) {
    return sort?.key === key ? 'bg-blue-50/70' : '';
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
      {/* Header — sticky, blue-outline + backdrop-blur treatment matching
          /customers, /vehicles/search, and /inventory/stock. Search bar
          now lives here too, same as those pages. */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Hub
          </button>

          <div className="flex items-center gap-2.5 min-w-0 mb-4">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Car size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Vehicles
              </h1>
              <p className="text-xs text-gray-500 truncate">Every vehicle on file, across all customers</p>
            </div>
          </div>

          {/* Search — command-palette style matching /vehicles/search, /customers, /inventory/stock */}
          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by plate, model, VIN, or customer..."
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>
        )}

        {/* This table deliberately scrolls horizontally on narrow screens
            (min-w-[720px] + overflow-x-auto) rather than becoming cards —
            it's a dense, read-only reference list, so a swipe-to-see-more
            table is a reasonable trade-off vs. the effort of a full mobile
            card rework. Say the word if you'd rather it match the
            card-per-row treatment used on the customers page. */}
        <div className="border-2 border-gray-300 rounded-md overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-blue-50/60 border-b-2 border-gray-300">
                <tr>
                  <SortableTh<SortKey>
                    label="Plate"
                    columnKey="plate"
                    activeKey={sort?.key ?? null}
                    direction={sort?.direction ?? null}
                    onSort={toggleSort}
                    className="whitespace-nowrap"
                  />
                  <SortableTh<SortKey>
                    label="Car"
                    columnKey="model"
                    activeKey={sort?.key ?? null}
                    direction={sort?.direction ?? null}
                    onSort={toggleSort}
                    className="whitespace-nowrap"
                  />
                  <SortableTh<SortKey>
                    label="Customer"
                    columnKey="customer"
                    activeKey={sort?.key ?? null}
                    direction={sort?.direction ?? null}
                    onSort={toggleSort}
                    className="whitespace-nowrap"
                  />
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">VIN</th>
                  <SortableTh<SortKey>
                    label="Latest Odometer"
                    columnKey="odometer"
                    activeKey={sort?.key ?? null}
                    direction={sort?.direction ?? null}
                    onSort={toggleSort}
                    align="right"
                    className="whitespace-nowrap"
                  />
                </tr>
              </thead>
              <tbody>
                {paginatedVehicles.map((v, idx) => (
                  <tr
                    key={v.id}
                    onClick={() => router.push(`/workshop/vehicles/${v.id}`)}
                    className={`border-t border-gray-300 cursor-pointer hover:bg-blue-50 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                  >
                    <td className={`px-4 py-3 font-medium whitespace-nowrap ${cellHighlight('plate')}`}>
                      {v.plateNumber}
                    </td>
                    <td className={`px-4 py-3 text-gray-600 whitespace-nowrap ${cellHighlight('model')}`}>
                      {v.vehicleModel}
                    </td>
                    <td className={`px-4 py-3 text-gray-600 whitespace-nowrap ${cellHighlight('customer')}`}>
                      {v.customer.name}
                      {v.customer.companyName ? ` · ${v.customer.companyName}` : ''}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.vin ?? '—'}</td>
                    <td className={`px-4 py-3 text-right text-gray-600 whitespace-nowrap ${cellHighlight('odometer')}`}>
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

        {/* Pagination — shared component (same as /customers, /invoices,
            /sales-orders, /purchase-orders) instead of a hand-rolled
            Prev/Next row. */}
        {!loading && vehicles.length > 0 && (
          <div className="mt-4">
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={sortedVehicles.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>
    </main>
  );
}