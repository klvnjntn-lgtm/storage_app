'use client';

import { useEffect, useRef, useState } from 'react';
import { display } from '@/lib/fonts';
import { BarChart3, Car, Search, X, Users, PackageSearch } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { toCalendarDateString } from '@/lib/dates';
import { getInitialParam, useSyncQueryParams } from '@/lib/useQuerySync';
import { useLanguage } from '@/app/context/LanguageContext';
import { useHasModule } from '@/lib/hooks/useHasModule';
import DateRangePicker from '@/app/components/shared/DateRangePicker';
import TopCustomersBarChart from '@/app/components/reports/TopCustomersBarChart';
import TopItemsPieChart from '@/app/components/reports/TopItemsPieChart';
import TopVehiclesBarChart from '@/app/components/reports/TopVehiclesBarChart';
import type { TopReport } from '@/app/components/reports/types';


const FULL_REPORT_LIMIT = 10;

type VehicleSearchResult = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  customer: { name: string };
};

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toCalendarDateString(d);
}
function defaultTo(): string {
  return toCalendarDateString(new Date());
}

// What DateRangePicker's "All time" preset resolves to — the top-report
// endpoint's from/to are required, not optional, so a null/null onChange
// gets translated to a fixed wide range rather than sent through as-is.
const ALL_TIME_FROM = '2000-01-01';

export default function SalesInsightsPage() {
  const { t } = useLanguage();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');

  const [from, setFrom] = useState(() => getInitialParam('from', defaultFrom()));
  const [to, setTo] = useState(() => getInitialParam('to', defaultTo()));

  // Vehicle scope — WORKSHOP_RMS orgs only. Narrows Top Customers/Items
  // down to invoices for one car; Top Vehicles stays unscoped (see
  // InvoiceService.getTopReport's comment on why).
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [vehicleResults, setVehicleResults] = useState<VehicleSearchResult[]>([]);
  const [vehicleSearching, setVehicleSearching] = useState(false);
  const [showVehicleResults, setShowVehicleResults] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleSearchResult | null>(null);
  const vehicleBoxRef = useRef<HTMLDivElement>(null);

  const [report, setReport] = useState<TopReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSyncQueryParams({ from, to, vehicleId: selectedVehicle?.id ?? null });

  useEffect(() => {
    if (!hasWorkshopRms || !vehicleQuery.trim()) {
      setVehicleResults([]);
      return;
    }
    let cancelled = false;
    setVehicleSearching(true);
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: vehicleQuery.trim() });
        const res = await apiFetch(`/vehicles/search?${params}`);
        if (res.ok && !cancelled) setVehicleResults(await res.json());
      } finally {
        if (!cancelled) setVehicleSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [vehicleQuery, hasWorkshopRms]);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (vehicleBoxRef.current && !vehicleBoxRef.current.contains(e.target as Node)) {
        setShowVehicleResults(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, limit: String(FULL_REPORT_LIMIT) });
      if (selectedVehicle) params.set('vehicleId', selectedVehicle.id);
      const res = await apiFetch(`/invoices/reports/top?${params}`);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.salesInsights.requestFailed', { status: res.status }));
        setReport(null);
        return;
      }

      setReport(await res.json());
    } catch {
      setError(t('accounting.salesInsights.couldNotReachServer'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, selectedVehicle]);

  function pickVehicle(v: VehicleSearchResult) {
    setSelectedVehicle(v);
    setVehicleQuery('');
    setVehicleResults([]);
    setShowVehicleResults(false);
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <BarChart3 size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('accounting.salesInsights.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('accounting.salesInsights.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {/* Date range */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4">
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, t) => {
              setFrom(f ?? ALL_TIME_FROM);
              setTo(t ?? toCalendarDateString(new Date()));
            }}
          />
        </div>

        {/* Vehicle scope — WORKSHOP_RMS only */}
        {hasWorkshopRms && (
          <div className="mb-5">
            <label className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <Car size={12} strokeWidth={2} />
              {t('accounting.salesInsights.vehicleFilter')}
            </label>

            {selectedVehicle ? (
              <div className="flex items-center justify-between border-2 border-black rounded-md p-2.5 max-w-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {selectedVehicle.plateNumber} · {selectedVehicle.vehicleModel}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{selectedVehicle.customer.name}</p>
                </div>
                <button onClick={() => setSelectedVehicle(null)} className="text-gray-400 hover:text-black shrink-0 ml-2">
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <div className="relative max-w-sm" ref={vehicleBoxRef}>
                <div className="flex items-center gap-2 border-2 border-gray-300 rounded-md p-2 focus-within:border-blue-500">
                  <Search size={15} strokeWidth={2} className="text-gray-400 shrink-0" />
                  <input
                    value={vehicleQuery}
                    onChange={(e) => {
                      setVehicleQuery(e.target.value);
                      setShowVehicleResults(true);
                    }}
                    onFocus={() => setShowVehicleResults(true)}
                    placeholder={t('accounting.salesInsights.vehicleSearchPlaceholder')}
                    className="flex-1 text-sm outline-none"
                  />
                </div>
                {showVehicleResults && vehicleQuery.trim() && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 border-2 border-gray-300 rounded-md bg-white shadow-lg max-h-64 overflow-y-auto">
                    {vehicleSearching && <p className="text-sm text-gray-500 p-3">{t('accounting.salesInsights.searching')}</p>}
                    {!vehicleSearching && vehicleResults.length === 0 && (
                      <p className="text-sm text-gray-400 p-3">{t('accounting.salesInsights.noVehiclesFound')}</p>
                    )}
                    {!vehicleSearching &&
                      vehicleResults.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => pickVehicle(v)}
                          className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                        >
                          <p className="font-medium text-sm">{v.plateNumber}</p>
                          <p className="text-xs text-gray-500">
                            {v.vehicleModel} · {v.customer.name}
                          </p>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</p>
        )}
        {loading && <p className="text-sm text-gray-500 mb-4">{t('accounting.salesInsights.crunchingNumbers')}</p>}

        {!loading && !error && report && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top customers */}
            <div className="border-2 border-gray-300 rounded-md p-4 bg-white">
              <div className="flex items-center gap-1.5 mb-1">
                <Users size={14} strokeWidth={2} className="text-blue-700" />
                <h2 className="text-sm font-bold">{t('accounting.salesInsights.topCustomers')}</h2>
              </div>
              <p className="text-xs text-gray-500 mb-3">{t('accounting.salesInsights.topCustomersSubtitle')}</p>
              {report.topCustomers.length === 0 ? (
                <p className="text-sm text-gray-400">{t('accounting.salesInsights.noData')}</p>
              ) : (
                <>
                  <TopCustomersBarChart rows={report.topCustomers} />
                  <div className="flex flex-col gap-1.5 mt-3">
                    {report.topCustomers.map((c, i) => (
                      <div key={c.customerId} className="flex items-center justify-between text-xs">
                        <span className="truncate text-gray-700">
                          <span className="text-gray-400 mr-1.5">{i + 1}.</span>
                          {c.name}
                        </span>
                        <span className="text-gray-500 shrink-0 ml-2">
                          {formatIDR(c.revenue)} · {t('accounting.salesInsights.invoicesCount', { n: c.invoiceCount })}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Top items */}
            <div className="border-2 border-gray-300 rounded-md p-4 bg-white">
              <div className="flex items-center gap-1.5 mb-1">
                <PackageSearch size={14} strokeWidth={2} className="text-blue-700" />
                <h2 className="text-sm font-bold">{t('accounting.salesInsights.topItems')}</h2>
              </div>
              <p className="text-xs text-gray-500 mb-3">{t('accounting.salesInsights.topItemsSubtitle')}</p>
              {report.topProducts.length === 0 ? (
                <p className="text-sm text-gray-400">{t('accounting.salesInsights.noData')}</p>
              ) : (
                <>
                  <TopItemsPieChart rows={report.topProducts} otherLabel={t('accounting.salesInsights.other')} />
                  <div className="flex flex-col gap-1.5 mt-3">
                    {report.topProducts.map((p, i) => (
                      <div key={p.productId} className="flex items-center justify-between text-xs">
                        <span className="truncate text-gray-700">
                          <span className="text-gray-400 mr-1.5">{i + 1}.</span>
                          {p.name}
                        </span>
                        <span className="text-gray-500 shrink-0 ml-2">
                          {formatIDR(p.revenue)} · {p.unitsSold} {t('accounting.salesInsights.units')}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Top vehicles — WORKSHOP_RMS only */}
            {hasWorkshopRms && (
              <div className="border-2 border-gray-300 rounded-md p-4 bg-white lg:col-span-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <Car size={14} strokeWidth={2} className="text-blue-700" />
                  <h2 className="text-sm font-bold">{t('accounting.salesInsights.topVehicles')}</h2>
                </div>
                <p className="text-xs text-gray-500 mb-3">{t('accounting.salesInsights.topVehiclesSubtitle')}</p>
                {report.topVehicles.length === 0 ? (
                  <p className="text-sm text-gray-400">{t('accounting.salesInsights.noData')}</p>
                ) : (
                  <>
                    <TopVehiclesBarChart rows={report.topVehicles} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3">
                      {report.topVehicles.map((v, i) => (
                        <div key={v.vehicleId} className="flex items-center justify-between text-xs">
                          <span className="truncate text-gray-700">
                            <span className="text-gray-400 mr-1.5">{i + 1}.</span>
                            {v.plateNumber} · {v.vehicleModel}
                          </span>
                          <span className="text-gray-500 shrink-0 ml-2">
                            {formatIDR(v.revenue)} · {t('accounting.salesInsights.visitsCount', { n: v.visitCount })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
