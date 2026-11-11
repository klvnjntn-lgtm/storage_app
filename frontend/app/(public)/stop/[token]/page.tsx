'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { formatDMY, parseCalendarDate } from '@/lib/dates';
import { CSRF_HEADERS } from '@/lib/session';
import { useLanguage } from '@/app/context/LanguageContext';
import ThemeToggle from '@/app/components/shared/ThemeToggle';
import GoogleMapsLink from '@/app/components/delivery/GoogleMapsLink';
import PhotoZoom from '@/app/components/shared/PhotoZoom';

type PublicStop = {
  businessName: string;
  routeDate: string;
  label: string;
  customerName: string | null;
  addressLabel: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  deliveryNotes: string | null;
  // Signed links, valid 15–30 minutes from when this page loaded.
  photos: { id: string; path: string }[];
};

// A route stop as pasted into WhatsApp from the route page's Copy button
// (see PublicStopController): where to go, the customer's directions and
// landmark photos. No login, no app shell.
export default function PublicStopPage() {
  const { token } = useParams<{ token: string }>();
  const { t, setLanguage } = useLanguage();
  const p = (key: string, vars?: Record<string, string | number>) => t(`delivery.publicStop.${key}`, vars);

  const [stop, setStop] = useState<PublicStop | null>(null);
  const [invalid, setInvalid] = useState(false);

  // A phone with no saved choice: follow its language.
  useEffect(() => {
    try {
      if (!localStorage.getItem('language') && navigator.language.toLowerCase().startsWith('id')) setLanguage('id');
    } catch {
      // storage unavailable — keep the default
    }
  }, [setLanguage]);

  useEffect(() => {
    let cancelled = false;
    // Plain fetch, not apiFetch: no session here, and apiFetch sends a 401 to the login page.
    fetch(`/api/public/stops/${encodeURIComponent(token)}`, { headers: CSRF_HEADERS, credentials: 'omit' })
      .then(async (res) => {
        const body = res.ok ? await res.json().catch(() => null) : null;
        if (cancelled) return;
        if (body) setStop(body);
        else setInvalid(true);
      })
      .catch(() => !cancelled && setInvalid(true));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {stop?.businessName ?? 'WareSys'} · {p('title')}
        </p>
        <ThemeToggle />
      </div>

      {invalid && (
        <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-md px-3 py-3">
          {p('invalid')}
        </div>
      )}
      {!invalid && !stop && <p className="text-sm text-gray-500">{p('loading')}</p>}

      {stop && (
        <>
          <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
            <h1 className="text-lg font-bold break-words flex items-start gap-2">
              <MapPin size={20} className="text-blue-600 shrink-0 mt-0.5" />
              {stop.label}
            </h1>
            {(stop.addressLabel || stop.address) && (
              <p className="text-sm text-gray-700 break-words">
                {stop.addressLabel && <span className="font-semibold">{stop.addressLabel}{stop.address ? ' · ' : ''}</span>}
                {stop.address}
              </p>
            )}
            <p className="text-xs text-gray-500">
              {p('routeDate', { date: formatDMY(parseCalendarDate(stop.routeDate.slice(0, 10))) })}
            </p>
            <div className="pt-1">
              {stop.latitude && stop.longitude ? (
                <GoogleMapsLink lat={stop.latitude} lng={stop.longitude} className="text-sm px-4 py-2" />
              ) : (
                <p className="text-sm text-amber-700">{p('noLocation')}</p>
              )}
            </div>
          </section>

          {stop.deliveryNotes?.trim() && (
            <section className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold mb-1">{p('notes')}</h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{stop.deliveryNotes}</p>
            </section>
          )}

          <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <h2 className="text-sm font-semibold">{p('photos')}</h2>
            {stop.photos.length === 0 ? (
              <p className="text-sm text-gray-500">{p('noPhotos')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {stop.photos.map((photo) => (
                  <PhotoZoom
                    key={photo.id}
                    src={`/api${photo.path}`}
                    alt={p('photos')}
                    className="w-full rounded-md border border-gray-200 object-cover"
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
