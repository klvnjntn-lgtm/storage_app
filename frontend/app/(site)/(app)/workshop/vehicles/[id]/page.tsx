// app/(app)/vehicles/[id]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Car,
  Plus,
  RotateCcw,
  Trash2,
  AlertCircle,
  ChevronRight,
  Search,
  Wrench,
  CalendarCheck,
  Gauge,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { parseCalendarDate } from '@/lib/dates';
import Pagination from '@/app/components/Pagination';

type VehicleInvoiceItem = {
  id: string;
  quantity: number;
  description: string | null;
  product: { name: string } | null;
};

type VehicleInvoice = {
  id: string;
  invoiceNumber: string | null;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  total: string | number;
  amountPaid: string | number;
  paymentStatus: 'UNPAID' | 'PARTIAL' | 'PAID';
  dueDate: string | null;
  issuedAt: string | null;
  createdAt: string;
  // Per-invoice snapshot — what the vehicle's odometer read at the time
  // *this* invoice was created, distinct from vehicle.odometer below
  // (the vehicle's current/latest reading, which keeps moving forward).
  odometer: number | null;
  items: VehicleInvoiceItem[];
};

type VehicleDetail = {
  id: string;
  plateNumber: string;
  vehicleModel: string;
  vin: string | null;
  odometer: number | null;
  customer: { id: string; name: string; companyName: string | null; phone: string | null };
  invoices: VehicleInvoice[];
};

const PAGE_SIZE_DEFAULT = 20;
const ITEMS_SUMMARY_MAX = 3;

// Same rule as the invoices list page: only ISSUED, not fully PAID, and
// past its due date (compared by local calendar day, not exact time).
// Still used for the small overdue flag on a row, even though the
// dedicated payment-status filter pill has been removed.
function isOverdue(inv: VehicleInvoice): boolean {
  if (inv.status !== 'ISSUED') return false;
  if (inv.paymentStatus === 'PAID') return false;
  if (!inv.dueDate) return false;

  const due = parseCalendarDate(inv.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// The date shown on each row — same field priority as before.
function displayDateFor(inv: VehicleInvoice): Date {
  return new Date(inv.issuedAt ?? inv.createdAt);
}

// A single line of display text for an invoice item — product name if it's
// a stocked product, otherwise the free-text service description.
function itemLabel(item: VehicleInvoiceItem): string {
  return item.product?.name ?? item.description ?? 'Item';
}

// The whole point of this page per the customer's ask ("ganti barang apa
// aja & tgl/bulan sekaligus 1 report") is scanning what was done without
// opening every invoice — so the parts/services list is always visible
// inline, never behind a click. Returns one line per item (with quantity
// prefixed when >1) rather than a comma-joined string, since a 3-part job
// joined into one sentence reads as an unreadable run-on. When a search
// is active, matching items float to the top so the person can
// immediately see *why* a row matched instead of it being buried behind
// "+N more".
function itemsToShow(
  items: VehicleInvoiceItem[],
  searchQuery: string,
): { lines: string[]; overflow: number } {
  if (items.length === 0) return { lines: ['No items recorded'], overflow: 0 };

  const q = searchQuery.trim().toLowerCase();
  const labels = items.map((item) => {
    const label = itemLabel(item);
    return item.quantity > 1 ? `${item.quantity}× ${label}` : label;
  });

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

// Whether an invoice matches the search query — checked against the
// invoice number itself (e.g. "ATL-20002") OR any of its item labels
// (product name / service description). Either one is enough to match.
function invoiceMatchesSearch(inv: VehicleInvoice, q: string): boolean {
  if (!q) return true;
  const invoiceNumberMatch = inv.invoiceNumber?.toLowerCase().includes(q) ?? false;
  if (invoiceNumberMatch) return true;
  return inv.items.some((item) => itemLabel(item).toLowerCase().includes(q));
}

export default function VehicleDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters — pared down from the invoice-list style filters (date range
  // + status + payment + financial totals) to just what a "what's been
  // done to this car" view actually needs: a parts/services/invoice#
  // text search and a year filter. Payment/financial detail now lives
  // inside each invoice, not on this page.
  const [yearFilter, setYearFilter] = useState<'ALL' | string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'ISSUED'>('ALL');
  const [itemSearch, setItemSearch] = useState('');

  // Pagination — client-side, since /vehicles/:id returns the full
  // invoice list in one response rather than a paged one like /invoices.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/vehicles/${params.id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (!cancelled) setError(body?.message ?? `Failed to load vehicle (${res.status})`);
          return;
        }
        const data = await res.json();
        if (!cancelled) setVehicle(data);
      } catch {
        if (!cancelled) setError('Could not reach the server.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  // Lifetime service stats — deliberately NOT affected by the filter pills
  // below, since "Total Visits" and "Last Service" answer "what's this
  // car's whole history", not "what matches my current filter". Only
  // counts ISSUED invoices — a DRAFT hasn't happened yet and a VOID
  // invoice was reversed.
  const serviceStats = useMemo(() => {
    if (!vehicle) return { totalVisits: 0, lastServiceDate: null as Date | null };
    const issued = vehicle.invoices.filter((inv) => inv.status === 'ISSUED');
    const lastServiceDate = issued.reduce<Date | null>((latest, inv) => {
      const d = displayDateFor(inv);
      return !latest || d > latest ? d : latest;
    }, null);
    return { totalVisits: issued.length, lastServiceDate };
  }, [vehicle]);

  // Years that actually have invoices, newest first — populates the year
  // filter dropdown instead of a full date-range picker.
  const availableYears = useMemo(() => {
    if (!vehicle) return [];
    const years = new Set(vehicle.invoices.map((inv) => String(displayDateFor(inv).getFullYear())));
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [vehicle]);

  const statusAndYearFiltered = useMemo(() => {
    if (!vehicle) return [];
    return vehicle.invoices.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      if (yearFilter !== 'ALL' && String(displayDateFor(inv).getFullYear()) !== yearFilter) return false;
      return true;
    });
  }, [vehicle, statusFilter, yearFilter]);

  // Text search — matches if the invoice number itself contains the query
  // (e.g. "ATL-20002") OR any item on the invoice has a product name /
  // service description containing it. Applied last, on top of the
  // status/year filters above.
  const visibleInvoices = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return statusAndYearFiltered;
    return statusAndYearFiltered.filter((inv) => invoiceMatchesSearch(inv, q));
  }, [statusAndYearFiltered, itemSearch]);

  // Any filter change invalidates the current page — land back on page 1
  // instead of showing a stale, possibly out-of-range page. Deliberately
  // excludes `page` itself, same as the invoices list page.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, yearFilter, itemSearch, pageSize]);

  const paginatedInvoices = useMemo(() => {
    const start = (page - 1) * pageSize;
    return visibleInvoices.slice(start, start + pageSize);
  }, [visibleInvoices, page, pageSize]);

  async function discardDraft(id: string) {
    const res = await apiFetch(`/invoices/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setVehicle((prev) =>
        prev ? { ...prev, invoices: prev.invoices.filter((inv) => inv.id !== id) } : prev,
      );
    }
  }

  function openInvoice(inv: VehicleInvoice) {
    if (inv.status === 'DRAFT') {
      router.push(`/sales/invoices/new?draftId=${inv.id}`);
    } else {
      router.push(`/sales/invoices/${inv.id}`);
    }
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => (vehicle ? router.push(`/customers/${vehicle.customer.id}`) : router.push('/customers'))}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md max-w-full"
          >
            <ArrowLeft size={16} strokeWidth={2} className="shrink-0" />
            <span className="truncate">Back to {vehicle?.customer.name ?? 'Customer'}</span>
          </button>

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Car size={22} strokeWidth={2} className="text-gray-700 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate">{vehicle?.plateNumber ?? 'Vehicle'}</h1>
                {vehicle && (
                  <p className="text-xs text-gray-500">
                    {vehicle.vehicleModel} · {vehicle.customer.name}
                    {vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}
                    {vehicle.odometer != null ? ` · Latest Odometer ${vehicle.odometer.toLocaleString('id-ID')} km` : ''}
                  </p>
                )}
              </div>
            </div>

            {vehicle && (
              <button
                onClick={() =>
                  router.push(
                    `/sales/invoices/new?customerId=${vehicle.customer.id}&vehicleId=${vehicle.id}`,
                  )
                }
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-black text-white font-semibold hover:bg-gray-800 shrink-0"
              >
                <Plus size={16} strokeWidth={2} />
                New invoice
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
        )}

        {vehicle && (
          <>
            {/* Service stats — lifetime, unaffected by filters below */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
              <div className="border-2 border-gray-300 rounded-md p-2.5 sm:p-3 min-w-0">
                <p className="flex items-center gap-1 text-[11px] sm:text-xs text-gray-500">
                  <Wrench size={11} strokeWidth={2} />
                  Total visits
                </p>
                <p className="font-bold text-sm sm:text-base">{serviceStats.totalVisits}</p>
              </div>
              <div className="border-2 border-gray-300 rounded-md p-2.5 sm:p-3 min-w-0">
                <p className="flex items-center gap-1 text-[11px] sm:text-xs text-gray-500">
                  <CalendarCheck size={11} strokeWidth={2} />
                  Last service
                </p>
                <p className="font-bold text-sm sm:text-base truncate">
                  {serviceStats.lastServiceDate ? serviceStats.lastServiceDate.toLocaleDateString('id-ID') : '—'}
                </p>
              </div>
              <div className="border-2 border-gray-300 rounded-md p-2.5 sm:p-3 min-w-0">
                <p className="flex items-center gap-1 text-[11px] sm:text-xs text-gray-500">
                  <Gauge size={11} strokeWidth={2} />
                  Latest odometer
                </p>
                <p className="font-bold text-sm sm:text-base truncate">
                  {vehicle.odometer != null ? `${vehicle.odometer.toLocaleString('id-ID')} km` : '—'}
                </p>
              </div>
            </div>

            <h2 className="text-sm font-semibold text-gray-600 mb-2">Vehicle history</h2>

            {/* Search + year + status — deliberately lightweight now that
                payment/date-range filtering and financial totals live on
                the invoice itself, not here. Search covers both invoice
                number and parts/services text. */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
              <div className="relative flex-1 sm:max-w-sm">
                <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Search invoice #, parts/services..."
                  className="w-full border-2 border-gray-300 rounded-md pl-9 pr-3 py-2.5 sm:py-2 text-sm outline-none focus:border-black"
                />
              </div>

              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="border-2 border-gray-300 rounded-md px-3 py-2.5 sm:py-2 text-sm font-semibold outline-none focus:border-black bg-white shrink-0"
              >
                <option value="ALL">All years</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>

              <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible shrink-0">
                {(['ALL', 'DRAFT', 'ISSUED'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`text-xs px-3 py-2.5 sm:py-2 rounded-md border-2 font-semibold whitespace-nowrap shrink-0 ${
                      statusFilter === s
                        ? 'bg-black text-white border-black'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {s === 'ALL' ? 'All' : s === 'DRAFT' ? 'Active drafts' : 'Issued'}
                  </button>
                ))}
              </div>
            </div>

            {visibleInvoices.length === 0 && (
              <p className="text-sm text-gray-400">No visits match these filters.</p>
            )}

            <div className="flex flex-col gap-2">
              {paginatedInvoices.map((inv) => {
                const overdue = isOverdue(inv);
                const { lines, overflow } = itemsToShow(inv.items, itemSearch);
                return (
                  <div
                    key={inv.id}
                    onClick={() => openInvoice(inv)}
                    className={`flex flex-col gap-1.5 border-2 rounded-md p-3 cursor-pointer transition-colors ${
                      overdue
                        ? 'border-red-300 bg-red-50/40 hover:border-red-400 hover:bg-red-50 active:bg-red-100'
                        : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100'
                    }`}
                  >
                    {/* Row 1 — date, invoice number, minimal status flags.
                        Payment status badge removed — that detail now
                        lives inside the invoice itself. Overdue is kept
                        as a small flag since it's actionable at a glance. */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">{displayDateFor(inv).toLocaleDateString('id-ID')}</span>
                      <span className="font-semibold">{inv.invoiceNumber ?? 'Unissued draft'}</span>
                      {inv.status === 'VOID' && (
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

                    {/* Row 2 — the part the customer actually asked for: what
                        was changed, one item per line so a multi-part job
                        stays readable instead of collapsing into a
                        comma-joined run-on sentence. */}
                    <div className="text-sm text-gray-700 leading-snug">
                      {lines.map((line, i) => (
                        <p key={i} className="truncate">
                          {line}
                        </p>
                      ))}
                      {overflow > 0 && <p className="text-xs text-gray-400">+{overflow} more</p>}
                    </div>

                    {/* Row 3 — odometer, total, and either draft actions or
                        a plain "view" affordance (the whole card is already
                        clickable, this is just a visual cue). */}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        {inv.odometer != null && (
                          <>
                            <Gauge size={11} strokeWidth={2} />
                            {inv.odometer.toLocaleString('id-ID')} km
                          </>
                        )}
                      </span>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold text-sm">{formatIDR(Number(inv.total))}</span>

                        {inv.status === 'DRAFT' ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => router.push(`/sales/invoices/new?draftId=${inv.id}`)}
                              className="flex items-center gap-1 text-xs px-2.5 py-2 rounded-md border border-gray-300 hover:bg-gray-100 active:bg-gray-200"
                            >
                              <RotateCcw size={13} strokeWidth={2} />
                              Resume
                            </button>
                            <button
                              onClick={() => discardDraft(inv.id)}
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

            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={visibleInvoices.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </div>
    </main>
  );
}