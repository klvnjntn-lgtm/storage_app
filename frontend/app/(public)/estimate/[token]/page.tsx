'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { formatIDR } from '@/lib/format';
import { formatDMY, parseCalendarDate } from '@/lib/dates';
import { resolveUploadUrl } from '@/lib/assets';
import { CSRF_HEADERS } from '@/lib/session';
import { useLanguage } from '@/app/context/LanguageContext';
import ThemeToggle from '@/app/components/shared/ThemeToggle';

type Estimate = {
  business: {
    name: string;
    legalName: string | null;
    npwp: string | null;
    address: string | null;
    phone: string | null;
    logoUrl: string | null;
  };
  number: string;
  createdAt: string;
  // A workshop quotation's status (estimates are quotations now).
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'CONVERTED';
  approvedAt: string | null;
  customerName: string;
  customerCompany: string | null;
  customerNpwp: string | null;
  validUntil: string | null;
  customerPoNumber: string | null;
  termsAndConditions: string | null;
  vehicle: { plateNumber: string; vehicleModel: string; odometer?: number | null } | null;
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

  const toolbar = (
    <div className="flex justify-end items-center gap-2 text-xs">
      <div className="flex items-center rounded-md border border-blue-500/20 bg-white p-0.5">
        {(['id', 'en'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLanguage(l)}
            className={`px-2 py-1 rounded font-semibold transition-colors ${
              language === l ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-blue-700'
            }`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <ThemeToggle />
    </div>
  );

  if (!estimate) {
    return (
      <main className="max-w-lg mx-auto px-4 py-8">
        {toolbar}
        <p className="mt-8 text-center text-sm text-gray-500">
          {loadError ? p(`error.${loadError}`) : p('loading')}
        </p>
      </main>
    );
  }

  const logoUrl = resolveUploadUrl(estimate.business.logoUrl);
  // Good through the whole of its validity date.
  const validUntil = estimate.validUntil ? parseCalendarDate(estimate.validUntil) : null;
  const lapsed = !!validUntil && new Date(validUntil.getTime() + 24 * 60 * 60 * 1000) <= new Date();
  const open = estimate.status === 'SENT';
  // Edited after it was sent: answerable again once the workshop sends the new version.
  const revising = estimate.status === 'DRAFT';
  const declined = ['REJECTED', 'CANCELLED', 'EXPIRED'].includes(estimate.status);

  return (
    <main className="max-w-lg mx-auto px-4 py-6">
      {toolbar}

      <header className="mt-2 flex items-center gap-3">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-12 w-12 object-contain" />
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight text-gray-900">{estimate.business.name}</h1>
          {estimate.business.address && <p className="text-xs text-gray-500">{estimate.business.address}</p>}
          {estimate.business.phone && <p className="text-xs text-gray-500">{estimate.business.phone}</p>}
          {estimate.business.npwp && <p className="text-xs text-gray-500">NPWP: {estimate.business.npwp}</p>}
        </div>
      </header>

      <section className="mt-4 bg-white border border-blue-500/15 rounded-xl p-4 shadow-sm">
        <div className="flex justify-between items-start gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-blue-700 font-semibold">{p('title')}</p>
            <p className="font-semibold text-gray-900">{estimate.number}</p>
            <p className="text-xs text-gray-500">{formatDMY(new Date(estimate.createdAt))}</p>
          </div>
          <div className="text-right">
            {estimate.vehicle && (
              <>
                <p className="font-mono font-semibold text-gray-900">{estimate.vehicle.plateNumber}</p>
                <p className="text-xs text-gray-500">{estimate.vehicle.vehicleModel}</p>
                {estimate.vehicle.odometer != null && (
                  <p className="text-xs text-gray-500">{estimate.vehicle.odometer.toLocaleString('id-ID')} km</p>
                )}
              </>
            )}
            <p className="text-xs font-medium text-gray-700">{estimate.customerName}</p>
            {estimate.customerCompany && <p className="text-xs text-gray-500">{estimate.customerCompany}</p>}
          </div>
        </div>

        {(estimate.customerPoNumber || estimate.termsAndConditions || estimate.customerNpwp || validUntil) && (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-800">
            {estimate.customerPoNumber && (
              <>
                <dt className="text-gray-500">{p('poNumber')}</dt>
                <dd>{estimate.customerPoNumber}</dd>
              </>
            )}
            {estimate.termsAndConditions && (
              <>
                <dt className="text-gray-500">{p('terms')}</dt>
                <dd className="whitespace-pre-wrap">{estimate.termsAndConditions}</dd>
              </>
            )}
            {estimate.customerNpwp && (
              <>
                <dt className="text-gray-500">{p('customerNpwp')}</dt>
                <dd>{estimate.customerNpwp}</dd>
              </>
            )}
            {validUntil && (
              <>
                <dt className="text-gray-500">{p('estimateValidUntil')}</dt>
                <dd className={lapsed ? 'text-red-600 font-medium' : ''}>{formatDMY(validUntil)}</dd>
              </>
            )}
          </dl>
        )}

        {estimate.complaint && (
          <div className="mt-3">
            <p className="text-xs text-gray-500">{p('complaint')}</p>
            <p className="text-sm whitespace-pre-wrap text-gray-800">{estimate.complaint}</p>
          </div>
        )}

        <ul className="mt-4 divide-y divide-blue-500/10 border-t border-blue-500/15">
          {estimate.lines.map((l, i) => (
            <li key={i} className="py-2 flex justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="text-gray-900">{l.name}</p>
                <p className="text-xs text-gray-500">
                  {l.isPart ? p('part') : p('labour')} · {l.quantity}
                  {l.unitPrice != null && ` × ${formatIDR(l.unitPrice)}`}
                </p>
              </div>
              {l.lineTotal != null && <p className="shrink-0 font-medium text-gray-900">{formatIDR(l.lineTotal)}</p>}
            </li>
          ))}
        </ul>

        <div className="mt-3 pt-3 border-t border-blue-500/15 text-sm space-y-0.5 text-gray-600">
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
          <p className="flex justify-between text-base font-bold text-gray-900 pt-1">
            <span>{p('total')}</span>
            <span>{formatIDR(estimate.total)}</span>
          </p>
          <p className="text-xs text-gray-500">{p('priceNote')}</p>
        </div>
      </section>

      {error && <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{error}</p>}

      {open && lapsed ? (
        <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{p('lapsed')}</p>
      ) : open ? (
        mode ? (
          <section className="mt-4 bg-white border border-blue-500/15 rounded-xl p-4 shadow-sm space-y-3">
            <p className="text-sm font-semibold text-gray-900">{mode === 'approve' ? p('confirmApprove') : p('confirmDecline')}</p>
            <label className="block">
              <span className="text-xs text-gray-500">{p('yourName')}</span>
              <input
                className="mt-1 w-full bg-white text-gray-900 border border-blue-500/20 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
                value={name}
                maxLength={100}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {mode === 'decline' && (
              <label className="block">
                <span className="text-xs text-gray-500">{p('reason')}</span>
                <textarea
                  className="mt-1 w-full bg-white text-gray-900 border border-blue-500/20 rounded-lg px-3 py-2 text-base outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
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
                className="flex-1 bg-white border border-blue-500/20 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-blue-50/60"
                onClick={() => setMode(null)}
              >
                {p('back')}
              </button>
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={respond}
                className={`flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
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
              className="flex-1 border border-blue-500/20 bg-white rounded-lg py-3 text-sm font-medium text-gray-700 hover:bg-blue-50/60"
            >
              {p('decline')}
            </button>
            <button
              type="button"
              onClick={() => setMode('approve')}
              className="flex-[2] bg-green-600 text-white rounded-lg py-3 text-sm font-semibold"
            >
              {p('approve')}
            </button>
          </div>
        )
      ) : revising ? (
        <p className="mt-4 text-sm rounded-lg p-3 border bg-amber-50 border-amber-200 text-amber-800">
          {p('revisingState')}
        </p>
      ) : (
        <p
          className={`mt-4 flex items-center gap-2 text-sm rounded-lg p-3 border ${
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
