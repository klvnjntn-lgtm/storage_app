import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';
import { translateBody, wantsIndonesian } from './translate-message';

// The few successful responses that are just a message for the person
// ("Password has been reset"), in Indonesian like the errors are (see
// TranslatingExceptionFilter).
@Injectable()
export class TranslateMessageInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    if (!wantsIndonesian(context.switchToHttp().getRequest<Request>())) return next.handle();
    return next.handle().pipe(map((body) => translateBody(body)));
  }
}
