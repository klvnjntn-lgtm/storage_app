// Runs before the app's own code in the browser (Next.js
// instrumentation-client). Reports uncaught errors to Sentry when
// NEXT_PUBLIC_SENTRY_DSN is set at build time; does nothing otherwise.
import * as Sentry from '@sentry/browser';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    // Errors only; no performance tracing or session replay (they record
    // screens full of customers' business data).
    tracesSampleRate: 0,
    // Network noise and extensions, not bugs in WareSys.
    ignoreErrors: ['Session expired', 'Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//],
  });
}
