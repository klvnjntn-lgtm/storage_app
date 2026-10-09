'use client';

import { useEffect, useState } from 'react';
import { MapPin, MapPinOff, Check } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

export type CustomerAddress = {
  id: string;
  label: string;
  address: string | null;
  // Prisma Decimal fields serialize as strings over JSON.
  latitude: string | null;
  longitude: string | null;
  // Where the pin came from — see PinStatus.tsx.
  pinSource?: 'MANUAL' | 'GPS' | null;
  pinAccuracy?: number | null;
  pinSetAt?: string | null;
};

export function useCustomerAddresses(customerId: string | null | undefined) {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/customers/${customerId}/addresses`);
        if (res.ok && !cancelled) setAddresses(await res.json());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return { addresses: customerId ? addresses : [], loading };
}

function LocationDot({ has }: { has: boolean }) {
  const { t } = useLanguage();
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
        has ? 'bg-green-50 text-green-800 border-green-300' : 'bg-amber-50 text-amber-800 border-amber-300'
      }`}
    >
      {has ? <MapPin size={10} /> : <MapPinOff size={10} />}
      {has ? t('delivery.routeDetail.locationSet') : t('delivery.routeDetail.noLocation')}
    </span>
  );
}

// "Deliver to" chooser: the customer's default address plus their saved
// addresses. value '' means the default.
export default function CustomerAddressPicker({
  addresses,
  defaultAddress,
  defaultHasLocation,
  value,
  onChange,
}: {
  addresses: CustomerAddress[];
  defaultAddress: string | null | undefined;
  defaultHasLocation?: boolean;
  value: string;
  onChange: (addressId: string) => void;
}) {
  const { t } = useLanguage();

  const options = [
    {
      id: '',
      label: t('delivery.addresses.defaultLabel'),
      address: defaultAddress ?? null,
      hasLocation: defaultHasLocation,
    },
    ...addresses.map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      hasLocation: !!(a.latitude && a.longitude),
    })),
  ];

  return (
    <div className="space-y-1.5" role="radiogroup">
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id || '__default'}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.id)}
            className={`w-full flex items-start gap-2.5 text-left rounded-md border-2 p-2.5 transition-colors ${
              selected ? 'border-blue-500 bg-blue-50/60' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <span
              className={`mt-0.5 shrink-0 grid place-items-center w-4 h-4 rounded-full border-2 ${
                selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300'
              }`}
            >
              {selected && <Check size={10} strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold">{o.label}</span>
                {o.hasLocation !== undefined && <LocationDot has={o.hasLocation} />}
              </span>
              <span className="block text-xs text-gray-500 line-clamp-2">
                {o.address || t('delivery.addresses.noAddressText')}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
