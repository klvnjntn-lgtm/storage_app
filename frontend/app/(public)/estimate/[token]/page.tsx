'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { resolveUploadUrl } from '@/lib/assets';
import { CSRF_HEADERS } from '@/lib/session';
import { useLanguage } from '@/app/context/LanguageContext';

type Estimate = {
  business: { name: string; address: string | null; phone: string | null; logoUrl: string | null };
  number: string;
  createdAt: string;
  status: 'ESTIMATE' | 'QUEUED' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'DONE' | 'CANCELLED';
  approvedAt: string | null;
  customerName: string;
  vehicle: { plateNumber: string; vehicleModel: string };
  complaint: string | null;
  lines: { name: string; isPart: boolean; quantity: number; unitPrice: number | null; lineTotal: number | null }[];
  subtotal: number | null;
  discountAmount: number;
  taxAmount: number;
  total: number;
  expiresAt: string;
  version: string;
};

// Plain fetch, not apiFetch: the customer has no session, and apiFetch
// sends a 401 to the login page. The CSRF header matters only if the
// browser happens to hold a staff session cookie.
async function call(path: string, init?: RequestInit) {
  const res = await fetch(`/api/public/estimates/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS },
    credentials: 'omit',
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

// The customer's side of an estimate: shared by the workshop as a link
// (e.g. pasted into WhatsApp). They read it and approve or decline it.
export default function EstimateApprovalPage() {
  const { token } = useParams<{ token: string }>();
  const { t, language, setLanguage } = useLanguage();
  const p = (key: string, vars?: Record<string, string | number>) => t(`publicEstimate.${key}`, vars);

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'approve' | 'decline' | null>(null);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A customer's phone has no saved choice: follow its language.
  useEffect(() => {
    try {
      if (!localStorage.getItem('language') && navigator.language.toLowerCase().startsWith('id')) setLanguage('id');
    } catch {
      // storage unavailable — keep the default
    }
  }, [setLanguage]);

  const fetchEstimate = useCallback(async (): Promise<{ estimate: Estimate } | { error: string }> => {
    try {
      const { res, body } = await call(encodeURIComponent(token));
      return res.ok ? { estimate: body } : { error: res.status === 410 ? 'expired' : 'invalid' };
    } catch {
      return { error: 'network' };
    }
  }, [token]);

  function show(next: { estimate: Estimate } | { error: string }) {
    if ('estimate' in next) {
      setEstimate(next.estimate);
      setLoadError(null);
    } else {
      setLoadError(next.error);
    }
  }

  useEffect(() => {
    let current = true;
    (async () => {
      const next = await fetchEstimate();
      if (!current) return;
      if ('estimate' in next) setEstimate(next.estimate);
      else setLoadError(next.error);
    })();
    return () => {
      current = false;
    };
  }, [fetchEstimate]);

  async function respond() {
    if (!estimate || !mode || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { res, body } = await call(`${encodeURIComponent(token)}/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), reason: reason.trim() || undefined, version: estimate.version }),
      });
      if (res.ok) {
        setEstimate(body);
        setMode(null);
      } else if (res.status === 409) {
        // Changed by the workshop while open: show the new version.
        setError(p('changed'));
        setMode(null);
        show(await fetchEstimate());
      } else {
        setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? p('failed')));
      }
    } catch {
      setError(p('failed'));
    } finally {
      setBusy(false);
    }
  }

  const langToggle = (
    <div className="flex justify-end gap-1 text-xs">
      {(['id', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLanguage(l)}
          className={`px-2 py-1 rounded ${language === l ? 'bg-gray-900 text-white' : 'text-gray-500'}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );

  if (!estimate) {
    return (
      <main className="max-w-lg mx-auto px-4 py-8">
        {langToggle}
        <p className="mt-8 text-center text-sm text-gray-600">
          {loadError ? p(`error.${loadError}`) : p('loading')}
        </p>
      </main>
    );
  }

  const logoUrl = resolveUploadUrl(estimate.business.logoUrl);
  const open = estimate.status === 'ESTIMATE';
  const declined = estimate.status === 'CANCELLED';

  return (
    <main className="max-w-lg mx-auto px-4 py-6">
      {langToggle}

      <header className="mt-2 flex items-center gap-3">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-12 w-12 object-contain" />
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight">{estimate.business.name}</h1>
          {estimate.business.address && <p className="text-xs text-gray-600">{estimate.business.address}</p>}
          {estimate.business.phone && <p className="text-xs text-gray-600">{estimate.business.phone}</p>}
        </div>
      </header>

      <section className="mt-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <div className="flex justify-between items-start gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{p('title')}</p>
            <p className="font-semibold">{estimate.number}</p>
            <p className="text-xs text-gray-500">{formatDMY(new Date(estimate.createdAt))}</p>
          </div>
          <div className="text-right">
            <p className="font-mono font-semibold">{estimate.vehicle.plateNumber}</p>
            <p className="text-xs text-gray-600">{estimate.vehicle.vehicleModel}</p>
            <p className="text-xs text-gray-600">{estimate.customerName}</p>
          </div>
        </div>

        {estimate.complaint && (
          <div className="mt-3">
            <p className="text-xs text-gray-500">{p('complaint')}</p>
            <p className="text-sm whitespace-pre-wrap">{estimate.complaint}</p>
          </div>
        )}

        <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
          {estimate.lines.map((l, i) => (
            <li key={i} className="py-2 flex justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p>{l.name}</p>
                <p className="text-xs text-gray-500">
                  {l.isPart ? p('part') : p('labour')} · {l.quantity}
                  {l.unitPrice != null && ` × ${formatIDR(l.unitPrice)}`}
                </p>
              </div>
              {l.lineTotal != null && <p className="shrink-0">{formatIDR(l.lineTotal)}</p>}
            </li>
          ))}
        </ul>

        <div className="mt-3 pt-3 border-t border-gray-200 text-sm space-y-0.5">
          {estimate.subtotal != null && (estimate.discountAmount > 0 || estimate.taxAmount > 0) && (
            <>
              <p className="flex justify-between">
                <span>{p('subtotal')}</span>
                <span>{formatIDR(estimate.subtotal)}</span>
              </p>
              {estimate.discountAmount > 0 && (
                <p className="flex justify-between">
                  <span>{p('discount')}</span>
                  <span>−{formatIDR(estimate.discountAmount)}</span>
                </p>
              )}
              {estimate.taxAmount > 0 && (
                <p className="flex justify-between">
                  <span>{p('tax')}</span>
                  <span>{formatIDR(estimate.taxAmount)}</span>
                </p>
              )}
            </>
          )}
          <p className="flex justify-between text-base font-bold">
            <span>{p('total')}</span>
            <span>{formatIDR(estimate.total)}</span>
          </p>
          <p className="text-xs text-gray-500">{p('priceNote')}</p>
        </div>
      </section>

      {error && <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">{error}</p>}

      {open ? (
        mode ? (
          <section className="mt-4 bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
            <p className="text-sm font-semibold">{mode === 'approve' ? p('confirmApprove') : p('confirmDecline')}</p>
            <label className="block">
              <span className="text-xs text-gray-600">{p('yourName')}</span>
              <input
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-base"
                value={name}
                maxLength={100}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {mode === 'decline' && (
              <label className="block">
                <span className="text-xs text-gray-600">{p('reason')}</span>
                <textarea
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-base"
                  rows={2}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 border border-gray-300 rounded-md py-2.5 text-sm font-medium"
                onClick={() => setMode(null)}
              >
                {p('back')}
              </button>
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={respond}
                className={`flex-1 rounded-md py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
                  mode === 'approve' ? 'bg-green-600' : 'bg-red-600'
                }`}
              >
                {busy ? p('sending') : mode === 'approve' ? p('approve') : p('decline')}
              </button>
            </div>
          </section>
        ) : (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setMode('decline')}
              className="flex-1 border border-gray-300 bg-white rounded-md py-3 text-sm font-medium text-gray-700"
            >
              {p('decline')}
            </button>
            <button
              type="button"
              onClick={() => setMode('approve')}
              className="flex-[2] bg-green-600 text-white rounded-md py-3 text-sm font-semibold"
            >
              {p('approve')}
            </button>
          </div>
        )
      ) : (
        <p
          className={`mt-4 flex items-center gap-2 text-sm rounded-md p-3 border ${
            declined ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-green-50 border-green-200 text-green-800'
          }`}
        >
          {declined ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          {declined
            ? p('declinedState')
            : p('approvedState', { date: estimate.approvedAt ? formatDMY(new Date(estimate.approvedAt)) : '' })}
        </p>
      )}

      {open && (
        <p className="mt-3 text-center text-xs text-gray-400">
          {p('validUntil', { date: formatDMY(new Date(estimate.expiresAt)) })}
        </p>
      )}
    </main>
  );
}
