'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';
import * as Sentry from '@sentry/browser';

// Last resort, for an error in a root layout itself. It replaces the whole
// document, so no providers (language, theme) or global CSS are available:
// inline styles, both languages, and the OS color scheme.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          colorScheme: 'light dark',
          textAlign: 'center',
        }}
      >
        <title>WareSys</title>
        <div role="alert" style={{ maxWidth: 360 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Terjadi kesalahan · Something went wrong</h1>
          <p style={{ fontSize: 14, opacity: 0.75, marginTop: 8 }}>
            Data yang sudah tersimpan aman. · Your saved data is safe.
          </p>
          {error.digest && <p style={{ fontSize: 12, opacity: 0.5, fontFamily: 'monospace' }}>{error.digest}</p>}
          <button
            onClick={() => retry()}
            style={{
              marginTop: 16,
              padding: '10px 16px',
              borderRadius: 6,
              border: 0,
              background: '#2563eb',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Coba lagi · Try again
          </button>
        </div>
      </body>
    </html>
  );
}
