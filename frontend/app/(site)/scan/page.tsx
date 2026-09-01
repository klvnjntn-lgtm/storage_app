'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ScanLine, CheckCircle2, AlertCircle, MapPin } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

function successFeedback() {
  const audio = new Audio('/beep-success.mp3');
  audio.play().catch(() => {});
  if (navigator.vibrate) navigator.vibrate(150);
}

function errorFeedback() {
  const audio = new Audio('/beep-error.mp3');
  audio.play().catch(() => {});
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
}

const DEBOUNCE_MS = 2000;

type LocationOption = { id: string; name: string };
type ScanLogEntry = {
  id: string;
  barcode: string;
  productName: string;
  ok: boolean;
  message?: string;
  at: number;
};

export default function ScanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');

  const [session, setSession] = useState<any>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');

  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [log, setLog] = useState<ScanLogEntry[]>([]);

  const lastCodeRef = useRef('');
  const lastTimeRef = useRef(0);

  const fromLocationRef = useRef('');
  const toLocationRef = useRef('');
  useEffect(() => { fromLocationRef.current = fromLocationId; }, [fromLocationId]);
  useEffect(() => { toLocationRef.current = toLocationId; }, [toLocationId]);

  const type = session?.type;

  // Sessions that progress through stages (FULFILLMENT, MOVE) return an
  // ordered `stages` array from the backend. Everything about what
  // fields to show and require is driven by the *current stage*, not
  // the session type — mirrors the backend's effectiveType logic in
  // SessionsService.addItem.
  const hasStages = Array.isArray(session?.stages) && session.stages.length > 0;
  const effectiveType = hasStages ? session?.stage : type;

  // PICK (both fulfillment's first stage and MOVE's first stage) needs
  // a source location. MOVE as an *effective type* now only ever means
  // the second stage of a MOVE session (arrival) — the source was
  // already recorded when this product was PICKed earlier in the same
  // session, so this step only needs a destination.
  const showFrom = effectiveType === 'PICK';
  const showTo =
    effectiveType === 'MOVE' ||
    effectiveType === 'RECEIVE' ||
    effectiveType === 'RETURNS';

  // Same fields the backend actually requires (SessionsService.addItem) —
  // checked here too so a missing selection is caught before a scan is
  // fired off, instead of the person finding out only after a failed
  // request with a backend error message.
  const requiresFrom = effectiveType === 'PICK';
  const requiresTo = effectiveType === 'MOVE' || effectiveType === 'RETURNS';

  const missingFrom = requiresFrom && !fromLocationId;
  const missingTo = requiresTo && !toLocationId;
  const readyToScan = !missingFrom && !missingTo && !!sessionId;

  async function handleScan(barcode: string) {
    const now = Date.now();
    if (barcode === lastCodeRef.current && now - lastTimeRef.current < DEBOUNCE_MS) {
      return;
    }
    lastCodeRef.current = barcode;
    lastTimeRef.current = now;

    if (missingFrom || missingTo) {
      const msg = missingFrom
        ? `Select a ${fromLabel()} before scanning.`
        : `Select a ${toLabel()} before scanning.`;
      setStatus('error');
      setErrorMsg(msg);
      errorFeedback();
      pushLog({ barcode, productName: '', ok: false, message: msg });
      return;
    }

    setStatus('submitting');
    setErrorMsg('');

    try {
      // Step 1: resolve barcode -> product
      const productRes = await apiFetch(
        `/products/by-barcode/${encodeURIComponent(barcode)}`
      );

      if (!productRes.ok) {
        if (productRes.status === 404) {
          throw new Error(`No product found for barcode "${barcode}"`);
        }
        throw new Error(`Lookup failed: ${productRes.status}`);
      }

      const product = await productRes.json();

      // Step 2: add item to session
      const itemRes = await apiFetch(`/sessions/${sessionId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          qty: 1,
          fromLocationId: fromLocationRef.current || undefined,
          toLocationId: toLocationRef.current || undefined,
        }),
      });

      if (!itemRes.ok) {
        const text = await itemRes.text();
        throw new Error(text || `Failed to add item: ${itemRes.status}`);
      }

      successFeedback();
      setStatus('idle');
      pushLog({ barcode, productName: product.name, ok: true });
    } catch (e: any) {
      console.error(e);
      const msg = e.message || 'Scan failed';
      setStatus('error');
      setErrorMsg(msg);
      errorFeedback();
      pushLog({ barcode, productName: '', ok: false, message: msg });
    }
  }

  function pushLog(entry: Omit<ScanLogEntry, 'id' | 'at'>) {
    setLog((prev) =>
      [{ ...entry, id: `${Date.now()}-${Math.random()}`, at: Date.now() }, ...prev].slice(0, 8)
    );
  }

  function fromLabel() {
    if (effectiveType === 'PICK') {
      return type === 'MOVE' ? 'Move From Location' : 'Pick From Location';
    }
    return 'Ship From Location';
  }

  function toLabel() {
    if (effectiveType === 'MOVE') return 'Move To Location';
    if (effectiveType === 'RECEIVE') return 'Receive To Location';
    return 'Return To Location';
  }

  const handleScanRef = useRef(handleScan);
  useEffect(() => { handleScanRef.current = handleScan; });

  // Load session + locations
  useEffect(() => {
    if (!sessionId) {
      router.push('/');
      return;
    }

    async function loadSession() {
      const res = await apiFetch(`/sessions/${sessionId}`);
      if (!res.ok) {
        router.push('/');
        return;
      }
      setSession(await res.json());
    }

    async function loadLocations() {
      const res = await apiFetch('/locations');
      if (!res.ok) return;
      setLocations(await res.json());
    }

    loadSession();
    loadLocations();
  }, [sessionId, router]);

  // Scanner gun input — visible now (not hidden) so it's obvious where
  // scans land, and disabled/greyed out until required locations are
  // picked, instead of silently accepting scans that would just fail.
  const gunInputRef = useRef<HTMLInputElement>(null);
  const [gunBuffer, setGunBuffer] = useState('');

  useEffect(() => {
    if (!sessionId) return;

    function refocusGunInput(e?: MouseEvent) {
      const target = e?.target as HTMLElement | undefined;
      if (target && target.closest('select')) return;
      if (!readyToScan) return;
      gunInputRef.current?.focus();
    }

    refocusGunInput();
    document.addEventListener('click', refocusGunInput);

    return () => {
      document.removeEventListener('click', refocusGunInput);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, readyToScan]);

  function handleGunKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = gunBuffer.trim();
      setGunBuffer('');
      if (code) {
        handleScanRef.current(code);
      }
    }
  }

  const lastEntry = log[0];

  return (
    <main className="min-h-screen bg-white text-black">
      {/* Header */}
      <div className="border-b-2 border-gray-300 p-6">
        <div className="max-w-3xl mx-auto flex justify-between items-center">
          <button
            onClick={() => router.push(sessionId ? `/sessions/${sessionId}` : '/')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Exit scanning
          </button>
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 rounded-md bg-gray-100 border border-gray-300 font-semibold">
              {type ?? '...'}
            </span>
            {hasStages && session?.stage && (
              <span className="px-2 py-1 rounded-md bg-black text-white font-semibold">
                {session.stage}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-3xl mx-auto flex flex-col gap-5">

        {/* Step 1: locations, only shown when this mode needs them */}
        {(showFrom || showTo) && (
          <section className="border-2 border-gray-300 rounded-md p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <MapPin size={14} strokeWidth={2} />
              Step 1 — Set location{showFrom && showTo ? 's' : ''}
            </div>

            <div className="flex flex-wrap gap-3">
              {showFrom && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-600">
                    {fromLabel()} {requiresFrom && <span className="text-red-600">*</span>}
                  </label>
                  <select
                    className={`border-2 rounded-md p-2 w-52 ${
                      missingFrom ? 'border-red-300' : 'border-gray-300'
                    }`}
                    value={fromLocationId}
                    onChange={(e) => setFromLocationId(e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {showTo && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-600">
                    {toLabel()} {requiresTo && <span className="text-red-600">*</span>}
                    {!requiresTo && <span className="text-gray-400"> (optional)</span>}
                  </label>
                  <select
                    className={`border-2 rounded-md p-2 w-52 ${
                      missingTo ? 'border-red-300' : 'border-gray-300'
                    }`}
                    value={toLocationId}
                    onChange={(e) => setToLocationId(e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Step 2: scan */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
            <ScanLine size={14} strokeWidth={2} />
            Step {(showFrom || showTo) ? '2' : '1'} — Scan
          </div>

          <input
            ref={gunInputRef}
            value={gunBuffer}
            onChange={(e) => setGunBuffer(e.target.value)}
            onKeyDown={handleGunKeyDown}
            disabled={!readyToScan}
            placeholder={readyToScan ? 'Scan a barcode…' : 'Set location above to enable scanning'}
            autoFocus
            autoComplete="off"
            className={`w-full text-lg font-mono border-2 rounded-md p-4 outline-none ${
              readyToScan
                ? 'border-gray-300 focus:border-black bg-white'
                : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          />

          {!readyToScan && (
            <p className="text-xs text-gray-500">
              This step is locked until the required location{missingFrom && missingTo ? 's are' : ' is'} chosen above.
            </p>
          )}
        </section>

        {/* Live status */}
        {status === 'submitting' && (
          <div className="flex items-center gap-2 bg-gray-50 border-2 border-gray-300 text-gray-700 rounded-md p-3 text-sm">
            Saving scan…
          </div>
        )}

        {status === 'error' && errorMsg && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {errorMsg}
          </div>
        )}

        {status === 'idle' && lastEntry?.ok && (
          <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
            {lastEntry.productName} — added
          </div>
        )}

        {/* Recent scans */}
        {log.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Recent scans
            </h2>
            <div className="border-2 border-gray-300 rounded-md divide-y divide-gray-200">
              {log.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-center justify-between px-3 py-2 text-sm ${
                    entry.ok ? 'bg-white' : 'bg-red-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {entry.ok ? (
                      <CheckCircle2 size={16} strokeWidth={2} className="text-green-600 shrink-0" />
                    ) : (
                      <AlertCircle size={16} strokeWidth={2} className="text-red-600 shrink-0" />
                    )}
                    <span className="font-mono text-xs text-gray-500">{entry.barcode}</span>
                    <span className="font-medium">{entry.ok ? entry.productName : entry.message}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}