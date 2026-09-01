// app/(app)/customers/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, User, Car, Plus, X, Check } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useHasModule } from '@/lib/useHasModule';
import { Vehicle } from '@/app/components/invoices/types';

type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

type CustomerInvoice = {
  id: string;
  invoiceNumber: string | null;
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  total: string | number;
  amountPaid: string | number;
  paymentStatus: PaymentStatus;
  issuedAt: string | null;
  createdAt: string;
};

type CustomerDetail = {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  address: string | null;
  invoices: CustomerInvoice[];
};

type NewVehicleState = {
  plateNumber: string;
  vehicleModel: string;
  vin: string;
  odometer: string;
};

const EMPTY_VEHICLE: NewVehicleState = { plateNumber: '', vehicleModel: '', vin: '', odometer: '' };

function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function paymentStatusStyle(status: PaymentStatus) {
  switch (status) {
    case 'PAID':
      return 'bg-green-50 text-green-700 border-green-300';
    case 'PARTIAL':
      return 'bg-amber-50 text-amber-700 border-amber-300';
    case 'UNPAID':
      return 'bg-red-50 text-red-700 border-red-300';
  }
}

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const hasWorkshopRms = useHasModule('WORKSHOP_RMS');

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [newVehicle, setNewVehicle] = useState<NewVehicleState>({ ...EMPTY_VEHICLE });
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vehicleError, setVehicleError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/customers/${params.id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (!cancelled) setError(body?.message ?? `Failed to load customer (${res.status})`);
          return;
        }
        const data = await res.json();
        if (!cancelled) setCustomer(data);
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

  async function loadVehicles() {
    setVehiclesLoading(true);
    try {
      const res = await apiFetch(`/customers/${params.id}/vehicles`);
      if (res.ok) setVehicles(await res.json());
    } finally {
      setVehiclesLoading(false);
    }
  }

  useEffect(() => {
    if (!hasWorkshopRms) return;
    loadVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasWorkshopRms, params.id]);

  async function saveVehicle() {
    if (!newVehicle.plateNumber.trim()) {
      setVehicleError('Plate number is required');
      return;
    }
    if (!newVehicle.vehicleModel.trim()) {
      setVehicleError('Car is required');
      return;
    }
    setVehicleSaving(true);
    setVehicleError('');
    try {
      const res = await apiFetch(`/customers/${params.id}/vehicles`, {
        method: 'POST',
        body: JSON.stringify({
          plateNumber: newVehicle.plateNumber.trim(),
          vehicleModel: newVehicle.vehicleModel.trim(),
          vin: newVehicle.vin.trim() || undefined,
          odometer: newVehicle.odometer.trim() ? Number(newVehicle.odometer.trim()) : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || `Failed to save (${res.status})`);
      }
      setAddingVehicle(false);
      setNewVehicle({ ...EMPTY_VEHICLE });
      loadVehicles();
    } catch (e: any) {
      setVehicleError(e.message || 'Could not save vehicle');
    } finally {
      setVehicleSaving(false);
    }
  }

  const totals = customer?.invoices.reduce(
    (acc, inv) => {
      if (inv.status === 'VOID') return acc;
      const total = Number(inv.total);
      const paid = Number(inv.amountPaid);
      acc.total += total;
      acc.paid += paid;
      acc.outstanding += Math.max(total - paid, 0);
      return acc;
    },
    { total: 0, paid: 0, outstanding: 0 },
  );

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="px-6 py-5 border-b-2 border-gray-300">
                <div className="max-w-5xl mx-auto">  
          <button
            onClick={() => router.push('/customers')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Customers
          </button>

          <div className="flex items-center gap-2">
            <User size={22} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">{customer?.name ?? 'Customer'}</h1>
              {customer && (
                <p className="text-xs text-gray-500">
                  {customer.companyName ? `${customer.companyName} · ` : ''}
                  {customer.phone ?? '—'} {customer.address ? `· ${customer.address}` : ''}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

            <div className="max-w-5xl mx-auto p-6">   
        {loading && <p className="text-sm text-gray-500">Loading...</p>}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
        )}

        {customer && hasWorkshopRms && (
          <>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-600">Vehicles</h2>
              <button
                onClick={() => {
                  setVehicleError('');
                  setAddingVehicle(true);
                }}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-black text-white font-semibold hover:bg-gray-800"
              >
                <Plus size={13} strokeWidth={2} />
                Add vehicle
              </button>
            </div>

            {addingVehicle && (
              <div className="border-2 border-gray-300 rounded-md p-3 mb-3">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold text-gray-500">New vehicle</span>
                  <button onClick={() => setAddingVehicle(false)} className="text-gray-400 hover:text-black">
                    <X size={15} strokeWidth={2} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newVehicle.plateNumber}
                    onChange={(e) => setNewVehicle({ ...newVehicle, plateNumber: e.target.value })}
                    placeholder="Plate number"
                    autoFocus
                    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
                  />
                  <input
                    value={newVehicle.vehicleModel}
                    onChange={(e) => setNewVehicle({ ...newVehicle, vehicleModel: e.target.value })}
                    placeholder="Car (make / model)"
                    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
                  />
                  <input
                    value={newVehicle.vin}
                    onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value })}
                    placeholder="VIN (optional)"
                    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
                  />
                  <input
                    value={newVehicle.odometer}
                    onChange={(e) => setNewVehicle({ ...newVehicle, odometer: e.target.value })}
                    placeholder="Odometer (optional)"
                    type="number"
                    inputMode="numeric"
                    className="border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
                  />
                </div>
                {vehicleError && <p className="text-xs text-red-600 mt-2">{vehicleError}</p>}
                <button
                  onClick={saveVehicle}
                  disabled={vehicleSaving}
                  className="w-full mt-3 flex items-center justify-center gap-2 bg-black text-white rounded-md p-2 text-sm font-semibold disabled:bg-gray-300"
                >
                  <Check size={15} strokeWidth={2} />
                  {vehicleSaving ? 'Saving...' : 'Add vehicle'}
                </button>
              </div>
            )}

            {vehiclesLoading && <p className="text-sm text-gray-500">Loading vehicles...</p>}
            {!vehiclesLoading && vehicles.length === 0 && !addingVehicle && (
              <p className="text-sm text-gray-400 mb-6">No vehicles on file for this customer yet.</p>
            )}

            <div className="flex flex-col gap-2 mb-6">
              {vehicles.map((v) => (
                <div
                  key={v.id}
                  onClick={() => router.push(`/vehicles/${v.id}`)}
                  className="flex items-center gap-3 border-2 border-gray-300 rounded-md p-3 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors"
                >
                  <Car size={18} strokeWidth={2} className="text-gray-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{v.plateNumber} · {v.vehicleModel}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {v.vin ? `VIN ${v.vin}` : 'No VIN on file'}
                      {v.odometer != null ? ` · ${v.odometer.toLocaleString('id-ID')} km` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {customer && !hasWorkshopRms && totals && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="border-2 border-gray-300 rounded-md p-3">
                <p className="text-xs text-gray-500">Total invoiced</p>
                <p className="font-bold">{formatIDR(totals.total)}</p>
              </div>
              <div className="border-2 border-gray-300 rounded-md p-3">
                <p className="text-xs text-gray-500">Total paid</p>
                <p className="font-bold text-green-700">{formatIDR(totals.paid)}</p>
              </div>
              <div className="border-2 border-gray-300 rounded-md p-3">
                <p className="text-xs text-gray-500">Outstanding</p>
                <p className="font-bold text-red-700">{formatIDR(totals.outstanding)}</p>
              </div>
            </div>

            <h2 className="text-sm font-semibold text-gray-600 mb-2">Invoice history</h2>

            {customer.invoices.length === 0 && (
              <p className="text-sm text-gray-400">No invoices for this customer yet.</p>
            )}

            <div className="flex flex-col gap-2">
              {customer.invoices.map((inv) => (
                <div
                  key={inv.id}
                  onClick={() => router.push(`/sales/invoices/${inv.id}`)}
                  className="flex items-center justify-between border-2 border-gray-300 rounded-md p-3 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{inv.invoiceNumber ?? 'Unissued draft'}</span>
                      {inv.status !== 'DRAFT' && (
                        <span className={`text-xs px-2 py-0.5 rounded-md border font-medium ${paymentStatusStyle(inv.paymentStatus)}`}>
                          {inv.paymentStatus}
                        </span>
                      )}
                      {inv.status === 'VOID' && (
                        <span className="text-xs px-2 py-0.5 rounded-md border bg-gray-100 text-gray-600 border-gray-300">
                          VOID
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(inv.issuedAt ?? inv.createdAt).toLocaleString('id-ID')}
                    </p>
                  </div>
                  <span className="font-semibold">{formatIDR(Number(inv.total))}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}