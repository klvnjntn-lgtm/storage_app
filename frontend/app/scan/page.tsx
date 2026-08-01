'use client';

import { BrowserMultiFormatReader } from '@zxing/browser';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

export default function ScanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');

  const [session, setSession] = useState<any>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');

  const [lastResult, setLastResult] = useState('');
  const [lastProductName, setLastProductName] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const lastCodeRef = useRef('');
  const lastTimeRef = useRef(0);

  // Keep refs of the location selects so callbacks set up once (camera decode,
  // gun keystroke listener) always read the current values, not stale closures.
  const fromLocationRef = useRef('');
  const toLocationRef = useRef('');
  useEffect(() => { fromLocationRef.current = fromLocationId; }, [fromLocationId]);
  useEffect(() => { toLocationRef.current = toLocationId; }, [toLocationId]);

  // Shared submit logic for both the camera decoder and the handheld gun.
  // Wrapped so both input paths can safely apply the same debounce.
  async function handleScan(barcode: string) {
    const now = Date.now();
    if (barcode === lastCodeRef.current && now - lastTimeRef.current < DEBOUNCE_MS) {
      return;
    }
    lastCodeRef.current = barcode;
    lastTimeRef.current = now;

    setLastResult(barcode);
    successFeedback();

    setStatus('submitting');
    setErrorMsg('');

    try {
      // Step 1: resolve barcode -> product
      const productRes = await apiFetch(
        `http://localhost:3000/products/by-barcode/${encodeURIComponent(barcode)}`
      );

      if (!productRes.ok) {
        if (productRes.status === 404) {
          throw new Error(`No product found for barcode "${barcode}"`);
        }
        throw new Error(`Lookup failed: ${productRes.status}`);
      }

      const product = await productRes.json();

      // Step 2: add item to session
      const itemRes = await apiFetch(`http://localhost:3000/sessions/${sessionId}/items`, {
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

      setLastProductName(product.name);
      setStatus('idle');
    } catch (e: any) {
      console.error(e);
      setStatus('error');
      setErrorMsg(e.message || 'Scan failed');
      errorFeedback();
    }
  }

  // Keep a ref to the latest handleScan so effects set up once can call the
  // current version without re-subscribing every render.
  const handleScanRef = useRef(handleScan);
  useEffect(() => { handleScanRef.current = handleScan; });

  // Load session + locations
  useEffect(() => {
    if (!sessionId) {
      router.push('/');
      return;
    }

    async function loadSession() {
      const res = await apiFetch(`http://localhost:3000/sessions/${sessionId}`);
      if (!res.ok) {
        router.push('/');
        return;
      }
      setSession(await res.json());
    }

    async function loadLocations() {
      const res = await apiFetch('http://localhost:3000/locations');
      if (!res.ok) return;
      setLocations(await res.json());
    }

    loadSession();
    loadLocations();
  }, [sessionId, router]);

  useEffect(() => {
    if (!sessionId) return;

    const codeReader = new BrowserMultiFormatReader();
    let controls: any;
    let cancelled = false;

    async function start() {
      const videoEl = document.getElementById('video') as HTMLVideoElement;
      if (!videoEl) return;

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const rearCamera = devices.find(d =>
        d.label.toLowerCase().includes('back') ||
        d.label.toLowerCase().includes('rear') ||
        d.label.toLowerCase().includes('environment')
      );
      const deviceId = rearCamera?.deviceId ?? devices[devices.length - 1]?.deviceId ?? undefined;

      controls = await codeReader.decodeFromVideoDevice(
        deviceId,
        videoEl,
        (result, err) => {
          if (cancelled || !result) return;
          handleScanRef.current(result.getText());
        }
      );
    }

    start();

    return () => {
      cancelled = true;
      controls?.stop?.();
    };
  }, [sessionId]);

  // --- Handheld gun scanner support ---
  // A gun scanner acts as a keyboard: it "types" the barcode fast, then Enter.
  // We keep a hidden, auto-focused input to catch that keystroke stream.
  // Camera decode above and this listener both funnel into handleScan, so
  // either input method (or both, on different devices) works interchangeably.
  const gunInputRef = useRef<HTMLInputElement>(null);
  const [gunBuffer, setGunBuffer] = useState('');

  useEffect(() => {
    if (!sessionId) return;

    // Keep the hidden input focused so gun keystrokes land somewhere,
    // but don't steal focus from the location dropdowns while in use.
    function refocusGunInput(e?: MouseEvent) {
      const target = e?.target as HTMLElement | undefined;
      if (target && target.closest('select')) return;
      gunInputRef.current?.focus();
    }

    refocusGunInput();
    document.addEventListener('click', refocusGunInput);

    return () => {
      document.removeEventListener('click', refocusGunInput);
    };
  }, [sessionId]);

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

  return (
    <main className="min-h-screen bg-white text-black">
      {/* Header */}
      <div className="border-b-2 border-gray-300 p-6">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold">SCAN MODE</h1>
          <button
            onClick={() => router.push(sessionId ? `/sessions/${sessionId}` : '/')}
            className="text-sm underline"
          >
            Exit
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto flex flex-col gap-4">
        {/* Hidden input catching handheld gun scanner keystrokes.
            Not display:none — needs to stay focusable to receive key events. */}
        <input
          ref={gunInputRef}
          value={gunBuffer}
          onChange={(e) => setGunBuffer(e.target.value)}
          onKeyDown={handleGunKeyDown}
          className="absolute opacity-0 pointer-events-none w-px h-px"
          aria-hidden="true"
          autoComplete="off"
        />

        <div className="p-3 rounded">
          ACTIVE MODE: <b>{session?.type ?? '...'}</b>
        </div>

        {/* Location pickers */}
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">From location</label>
            <select
              className="border-2 border-gray-300 rounded-md p-2 w-48"
              value={fromLocationId}
              onChange={(e) => {
                setFromLocationId(e.target.value);
                // Native <select> keeps keyboard focus after a choice, which
                // hijacks the next scan's keystrokes. Hand focus back to the
                // gun input once the browser finishes its own focus handling.
                setTimeout(() => gunInputRef.current?.focus(), 0);
              }}
            >
              <option value="">— none —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">To location</label>
            <select
              className="border-2 border-gray-300 rounded-md p-2 w-48"
              value={toLocationId}
              onChange={(e) => {
                setToLocationId(e.target.value);
                setTimeout(() => gunInputRef.current?.focus(), 0);
              }}
            >
              <option value="">— none —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div id="reader" className="w-full rounded overflow-hidden border border-gray-300">
          <video
            id="video"
            className="w-full h-64 object-cover"
            autoPlay
            muted
            playsInline
          />
        </div>

        <div className="mt-4 text-sm space-y-1">
          <div>Last scanned code: <b>{lastResult || '(nothing yet)'}</b></div>
          {lastProductName && <div>Product: <b>{lastProductName}</b></div>}
          {status === 'submitting' && <span className="text-gray-500">Saving…</span>}
          {status === 'error' && <span className="text-red-600">{errorMsg}</span>}
        </div>
      </div>
    </main>
  );
}