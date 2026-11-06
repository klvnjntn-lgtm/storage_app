// src/delivery-routes/log-photo-refusal.interceptor.ts
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, throwError, type Observable } from 'rxjs';

// A refused proof photo shows the driver why, but left the office only a status
// code in the web server's log. This records the reason, along with what the
// phone sent that the rules look at. Log only; the refusal itself is unchanged.
// Server errors aren't logged here, as they're already logged elsewhere.
@Injectable()
export class LogPhotoRefusalInterceptor implements NestInterceptor {
  private readonly logger = new Logger('PhotoRefused');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpException && err.getStatus() >= 400 && err.getStatus() < 500) {
          const req = context.switchToHttp().getRequest();
          const body = req.body ?? {};
          const flat = (v: unknown) => String(v).replace(/[\r\n\t]+/g, ' ').slice(0, 300);
          this.logger.warn(
            `status=${err.getStatus()} reason="${flat(err.message)}"` +
              ` user=${flat(req.user?.sub ?? '-')} role=${flat(req.user?.role ?? '-')}` +
              ` path=${flat(req.path ?? req.url)}` +
              ` gps=${body.latitude != null && body.longitude != null ? 'yes' : 'no'}` +
              ` takenAt=${flat(body.takenAt ?? '-')}`,
          );
        }
        return throwError(() => err);
      }),
    );
  }
}
