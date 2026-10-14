// Error tracking (Sentry). Imported first thing in main.ts — the SDK has to
// load before Nest and the HTTP stack to hook into them. Without
// SENTRY_DSN it does nothing at all.
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    // Performance tracing is opt-in (it costs quota); errors are always sent.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // Business data stays out of the error reports: no cookies, auth
    // headers or request bodies (invoices, customer details, passwords).
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers.cookie;
          delete event.request.headers.authorization;
        }
      }
      return event;
    },
  });
}
