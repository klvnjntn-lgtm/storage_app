// app/(app)/workshop/vehicles/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Car, Search } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { getInitialParam, getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import Pagination from '@/app/components/shared/Pagination';
import { useLanguage } from '@/app/context/LanguageContext';


type VehicleListItem = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  vin: string | null;
  odometer: number | null;
  customer: { id: string; name: string; companyName: string | null };
};

export default function VehiclesPage() {
  const router = useRouter();
  const { t, language } = useLanguage();

  const [vehicles, setVehicles] = useState<VehicleListItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Seeded from the URL so pressing the browser's Back button from a
  // vehicle's detail page restores the same search/page instead of
  // resetting to page 1 with no search.
  const [query, setQuery] = useState<string>(() => getInitialParam('query', ''));
  const [error, setError] = useState('');
  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', 20));

  useSyncQueryParams({
    query: query.trim(),
    page: page !== 1 ? page : null,
    pageSize: pageSize !== 20 ? pageSize : null,
  });

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
        setError(body?.message ?? t('workshop.vehiclesList.loadFailed', { status: res.status }));
      }
    } catch {
      setError(t('workshop.vehiclesList.serverError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(query.trim() || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skips its own first run — the mount effect above already covers the
  // initial load, and re-running it here would fire a redundant duplicate
  // fetch on every page load.
  const isFirstDebounceRef = useRef(true);
  useEffect(() => {
    if (isFirstDebounceRef.current) {
      isFirstDebounceRef.current = false;
      return;
    }
    const timeout = setTimeout(() => load(query.trim() || undefined), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Reset to page 1 whenever the query (and therefore the underlying
  // result set) changes — but not on the very first run, or a `page`
  // restored from the URL (e.g. via the browser's Back button) would get
  // clobbered back to 1 before the list even finishes loading.
  const isFirstPageResetRef = useRef(true);
  useEffect(() => {
    if (isFirstPageResetRef.current) {
      isFirstPageResetRef.current = false;
      return;
    }
    setPage(1);
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(vehicles.length / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedVehicles = useMemo(() => {
    const start = (page - 1) * pageSize;
    return vehicles.slice(start, start + pageSize);
  }, [vehicles, page, pageSize]);

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
          <div className="flex items-center gap-2.5 min-w-0 mb-4">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Car size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('workshop.vehiclesList.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('workshop.vehiclesList.subtitle')}</p>
            </div>
          </div>

          {/* Search — command-palette style matching /vehicles/search, /customers, /inventory/stock */}
          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('workshop.vehiclesList.searchPlaceholder')}
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
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.vehiclesList.colPlate')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.vehiclesList.colCar')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.vehiclesList.colCustomer')}</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.vehiclesList.colVin')}</th>
                  <th className="text-right px-4 py-3 font-semibold whitespace-nowrap">{t('workshop.vehiclesList.colLatestOdometer')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedVehicles.map((v, idx) => (
                  <tr
                    key={v.id}
                    onClick={() => router.push(`/workshop/vehicles/${v.id}`)}
                    className={`border-t border-gray-300 cursor-pointer hover:bg-blue-50 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                  >
                    <td className="px-4 py-3 font-medium whitespace-nowrap">{v.plateNumber}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.vehicleModel}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {v.customer.name}
                      {v.customer.companyName ? ` · ${v.customer.companyName}` : ''}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{v.vin ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                      {v.odometer != null
                        ? t('workshop.vehiclesList.km', { value: v.odometer.toLocaleString(language === 'id' ? 'id-ID' : 'en-US') })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && vehicles.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">{t('workshop.vehiclesList.noVehicles')}</div>
          )}
          {loading && <div className="p-8 text-center text-sm text-gray-500">{t('workshop.vehiclesList.loading')}</div>}
        </div>

        {/* Pagination */}
        {vehicles.length > 0 && (
          <div className="mt-4">
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={vehicles.length}
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