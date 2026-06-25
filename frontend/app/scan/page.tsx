'use client';

import { BrowserMultiFormatReader } from '@zxing/browser';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function successFeedback() {
  // sound
  const audio = new Audio('/beep-success.mp3');
  audio.play().catch(() => {});

  // vibration (mobile only)
  if (navigator.vibrate) {
    navigator.vibrate(150);
  }
}

function errorFeedback() {
  const audio = new Audio('/beep-error.mp3');
  audio.play().catch(() => {});

  if (navigator.vibrate) {
    navigator.vibrate([100, 50, 100]);
  }
}

export default function ScanPage() {
  const [qr, setQr] = useState('');
  const [mode, setMode] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState('');

  const router = useRouter();

useEffect(() => {
  const savedMode = localStorage.getItem('mode');
  setMode(savedMode);

  if (!savedMode) {
    router.push('/');
    return;
  }

  const codeReader = new BrowserMultiFormatReader();

  let controls: any;

  async function start() {
    const videoElement = document.createElement('video');
    document.getElementById('reader')?.appendChild(videoElement);

controls = await codeReader.decodeFromVideoDevice(
  undefined,
  videoElement,
  (result, err) => {
    if (result) {
      const text = result.getText();
      setQr(text);
      setLastResult(text);   // 👈 add this — currently never set
      successFeedback();     // 👈 add this — currently never called
    }
  }
);
  }

  start();

  return () => {
    if (controls?.stop) {
      controls.stop(); // 👈 THIS replaces reset()
    }
  };
}, []);

  return (
<main className="min-h-screen bg-white text-black">

  {/* Header */}
  <div className="border-b-2 border-gray-300 p-6">
    <div className="max-w-5xl mx-auto flex justify-between items-center">
      <h1 className="text-xl font-bold">SCAN MODE</h1>
      <button
        onClick={() => router.push('/')}
        className="text-sm underline"
      >
        Exit
      </button>
    </div>
  </div>

  {/* Content */}
  <div className="p-6 max-w-5xl mx-auto flex flex-col gap-4">

    {/* Mode display */}
    <div className="p-3 bg-white-100 rounded">
      ACTIVE MODE: <b>{mode}</b>
    </div>

    {/* Scanner */}
    <div id="reader" />

    {/* Live result */}
    <div className="mt-4 text-sm">
      Last scanned: <b>{lastResult || '(nothing yet)'}</b>
    </div>

  </div>

</main>
  );
}