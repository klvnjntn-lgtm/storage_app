'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ScanLine, CheckCircle2, AlertCircle, MapPin, Camera, VideoOff, Loader2, History } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

const CAMERA_REGION_ID = 'scan-camera-region';

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

// FIX — useSearchParams() requires a Suspense boundary for static
// prerendering, or `next build` fails outright ("useSearchParams()
// should be wrapped in a suspense boundary"). See login/page.tsx's
// identical fix.
export default function ScanPage() {
  return (
    <Suspense fallback={null}>
      <ScanPageInner />
    </Suspense>
  );
}

function ScanPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const { t, language } = useLanguage();

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
        ? t('scan.selectBeforeScanning', { label: fromLabel() })
        : t('scan.selectBeforeScanning', { label: toLabel() });
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
          throw new Error(t('scan.noProductForBarcode', { barcode }));
        }
        throw new Error(t('scan.lookupFailed', { status: productRes.status }));
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
        throw new Error(text || t('scan.failedToAddItem', { status: itemRes.status }));
      }

      successFeedback();
      setStatus('idle');
      pushLog({ barcode, productName: product.name, ok: true });
    } catch (e: any) {
      console.error(e);
      const msg = e.message || t('scan.scanFailed');
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
      return type === 'MOVE' ? t('scan.moveFromLocation') : t('scan.pickFromLocation');
    }
    return t('scan.shipFromLocation');
  }

  function toLabel() {
    if (effectiveType === 'MOVE') return t('scan.moveToLocation');
    if (effectiveType === 'RECEIVE') return t('scan.receiveToLocation');
    return t('scan.returnToLocation');
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

  // Camera-based scanning — lets a phone's own camera read barcodes
  // directly, so anyone signed in on their own device can scan without
  // a hardware scanner gun.
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const html5QrcodeRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (!cameraActive || !readyToScan) return;

    let cancelled = false;
    const scanner = new Html5Qrcode(CAMERA_REGION_ID, { verbose: false });
    html5QrcodeRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          handleScanRef.current(decodedText);
        },
        () => {
          // per-frame decode miss — expected while framing the code, ignore
        }
      )
      .catch(() => {
        if (cancelled) return;
        setCameraError(t('scan.cameraStartFailed'));
        setCameraActive(false);
      });

    return () => {
      cancelled = true;
      html5QrcodeRef.current = null;
      if (scanner.isScanning) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
      } else {
        scanner.clear();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive, readyToScan]);

  function toggleCamera() {
    setCameraError('');
    setCameraActive((v) => !v);
  }

  // Scanner gun input — visible now (not hidden) so it's obvious where
  // scans land, and disabled/greyed out until required locations are
  // picked, instead of silently accepting scans that would just fail.
  const gunInputRef = useRef<HTMLInputElement>(null);
  const [gunBuffer, setGunBuffer] = useState('');

  useEffect(() => {
    if (!sessionId) return;

    function refocusGunInput(e?: MouseEvent) {
      const target = e?.target as HTMLElement | undefined;
      if (target && (target.closest('select') || target.closest('button'))) return;
      if (!readyToScan || cameraActive) return;
      gunInputRef.current?.focus();
    }

    refocusGunInput();
    document.addEventListener('click', refocusGunInput);

    return () => {
      document.removeEventListener('click', refocusGunInput);
    };
  }, [sessionId, readyToScan, cameraActive]);

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
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Header — icon badge + title/subtitle, matching /inventory/stock/[id]
          and /vehicles/search. Navigation back is just the browser's own
          back button, same as those pages — no in-page exit control. */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <ScanLine size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate">{t('scan.title')}</h1>
              <p className="text-xs text-gray-500 truncate">{t('scan.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm shrink-0">
            <span className="px-2.5 py-1.5 rounded-md bg-blue-600/10 border border-blue-600/20 text-blue-800 font-semibold">
              {type ?? '...'}
            </span>
            {hasStages && session?.stage && (
              <span className="px-2.5 py-1.5 rounded-md bg-blue-600 text-white font-semibold">
                {session.stage}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto flex flex-col gap-5">

        {/* Step 1: locations, only shown when this mode needs them */}
        {(showFrom || showTo) && (
          <section className="border-2 border-gray-300 rounded-md p-4 space-y-3 bg-white">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <MapPin size={14} strokeWidth={2} />
              {showFrom && showTo ? t('scan.step1SetLocationsPlural') : t('scan.step1SetLocationSingular')}
            </div>

            <div className="flex flex-wrap gap-3">
              {showFrom && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-600">
                    {fromLabel()} {requiresFrom && <span className="text-red-600">*</span>}
                  </label>
                  <select
                    className={`border-2 rounded-md p-2 w-52 outline-none focus:border-blue-500 ${
                      missingFrom ? 'border-red-300' : 'border-gray-300'
                    }`}
                    value={fromLocationId}
                    onChange={(e) => setFromLocationId(e.target.value)}
                  >
                    <option value="">{t('scan.selectPlaceholder')}</option>
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
                    {!requiresTo && <span className="text-gray-400"> ({t('common.optional')})</span>}
                  </label>
                  <select
                    className={`border-2 rounded-md p-2 w-52 outline-none focus:border-blue-500 ${
                      missingTo ? 'border-red-300' : 'border-gray-300'
                    }`}
                    value={toLocationId}
                    onChange={(e) => setToLocationId(e.target.value)}
                  >
                    <option value="">{t('scan.selectPlaceholder')}</option>
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
        <section className="border-2 border-gray-300 rounded-md bg-white overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50/70">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <ScanLine size={14} strokeWidth={2} />
              {(showFrom || showTo) ? t('scan.step2Scan') : t('scan.step1Scan')}
            </div>

            <button
              type="button"
              onClick={toggleCamera}
              disabled={!readyToScan}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                cameraActive
                  ? 'bg-red-50 border-2 border-red-300 text-red-700 hover:bg-red-100'
                  : 'bg-blue-600 border-2 border-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20'
              }`}
            >
              {cameraActive ? (
                <>
                  <VideoOff size={14} strokeWidth={2.5} />
                  {t('scan.stopCamera')}
                </>
              ) : (
                <>
                  <Camera size={14} strokeWidth={2.5} />
                  {t('scan.scanWithCamera')}
                </>
              )}
            </button>
          </div>

          <div className="p-4 space-y-3">
            {cameraActive && (
              <div className="relative w-full max-w-xs mx-auto aspect-square rounded-lg overflow-hidden border-2 border-blue-500/40 bg-black">
                <div id={CAMERA_REGION_ID} className="w-full h-full" />
                <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-white text-[11px] font-semibold px-2 py-1 rounded-full pointer-events-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  {t('scan.cameraLive')}
                </div>
              </div>
            )}

            {cameraError && (
              <p className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle size={13} strokeWidth={2} className="shrink-0" />
                {cameraError}
              </p>
            )}

            {!cameraActive && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  {t('scan.orUseScannerGun')}
                </span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            <div className="relative">
              <ScanLine
                size={18}
                strokeWidth={2}
                className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${readyToScan ? 'text-blue-500' : 'text-gray-300'}`}
              />
              <input
                ref={gunInputRef}
                value={gunBuffer}
                onChange={(e) => setGunBuffer(e.target.value)}
                onKeyDown={handleGunKeyDown}
                disabled={!readyToScan}
                placeholder={readyToScan ? t('scan.scanBarcodePlaceholder') : t('scan.setLocationToEnableScanning')}
                autoFocus
                autoComplete="off"
                className={`w-full text-lg font-mono border-2 rounded-lg pl-11 pr-4 py-3.5 outline-none transition-colors ${
                  readyToScan
                    ? 'border-blue-500/30 focus:border-blue-500 bg-white'
                    : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              />
            </div>

            {!readyToScan && (
              <p className="text-xs text-gray-500">
                {missingFrom && missingTo ? t('scan.lockedUntilLocationsChosen') : t('scan.lockedUntilLocationChosen')}
              </p>
            )}
          </div>
        </section>

        {/* Live status */}
        {status === 'submitting' && (
          <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-200 text-blue-800 rounded-lg p-3 text-sm">
            <Loader2 size={16} strokeWidth={2} className="shrink-0 animate-spin" />
            {t('scan.savingScan')}
          </div>
        )}

        {status === 'error' && errorMsg && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-lg p-3 text-sm">
            <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {errorMsg}
          </div>
        )}

        {status === 'idle' && lastEntry?.ok && (
          <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-lg p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
            {t('scan.addedEntry', { name: lastEntry.productName })}
          </div>
        )}

        {/* Recent scans */}
        {log.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <History size={14} strokeWidth={2} />
              {t('scan.recentScans')}
            </div>
            <div className="border-2 border-gray-300 rounded-lg divide-y divide-gray-200 bg-white overflow-hidden">
              {log.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm ${
                    entry.ok ? 'bg-white' : 'bg-red-50'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {entry.ok ? (
                      <CheckCircle2 size={16} strokeWidth={2} className="text-green-600 shrink-0" />
                    ) : (
                      <AlertCircle size={16} strokeWidth={2} className="text-red-600 shrink-0" />
                    )}
                    <span className="font-mono text-xs text-gray-500 shrink-0">{entry.barcode}</span>
                    <span className="font-medium truncate">{entry.ok ? entry.productName : entry.message}</span>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {new Date(entry.at).toLocaleTimeString(language === 'id' ? 'id-ID' : 'en-US')}
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