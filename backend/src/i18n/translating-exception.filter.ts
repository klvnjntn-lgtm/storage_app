import { ArgumentsHost, Catch } from '@nestjs/common';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import type { Request, Response } from 'express';
import { translateBody, wantsIndonesian } from './translate-message';

// Sentry's filter (reports unexpected errors, then answers exactly as Nest's
// default filter would), with the error's message in Indonesian when the
// person's app is set to Indonesian. Every exception in the API goes
// through here, so no page needs its own translations of server errors.
@Catch()
export class TranslatingExceptionFilter extends SentryGlobalFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === 'http') {
      const http = host.switchToHttp();
      const req = http.getRequest<Request>();
      const res = http.getResponse<Response>();
      if (wantsIndonesian(req) && typeof res?.json === 'function') {
        const json = res.json.bind(res);
        res.json = (body: unknown) => json(translateBody(body));
      }
    }
    return super.catch(exception, host);
  }
}
