import { createHash } from 'crypto';
import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

// Makes a write safe to send twice.
//
// A phone that loses signal after sending a request can't tell whether it
// landed. Sending it again used to risk doing the thing twice — a second
// payment, a second expense. A client that puts an Idempotency-Key header
// on a write (lib/apifetch.ts does, one key per call, kept across its own
// retries) gets this instead: the first request with a key runs and its
// reply is kept; a repeat with the same key gets that reply back without
// running again.
//
// Per signed-in user. Requests without the header, reads, and anything
// unauthenticated pass straight through. Replies that aren't plain JSON
// (a PDF, a stream) aren't kept — a repeat of those simply runs again.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// A request still marked in progress after this long died mid-flight
// (server restart); its key is released rather than refusing forever.
const STALE_IN_PROGRESS_MS = 2 * 60 * 1000;
const KEEP_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const key = req.headers?.['idempotency-key'];
    const userId: string | undefined = req.user?.sub;
    if (typeof key !== 'string' || !key || key.length > 100 || !userId || SAFE_METHODS.has(req.method)) {
      return next.handle();
    }

    const fingerprint = this.fingerprint(req);
    const claimed = await this.claim(userId, key, fingerprint);
    if (claimed.kind === 'replay') {
      res.status(claimed.statusCode);
      return of(claimed.response);
    }

    const where = { userId_key: { userId, key } };
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          (async () => {
            const stored = this.storable(body, res);
            if (stored === undefined) {
              await this.prisma.idempotencyRecord.delete({ where }).catch(() => undefined);
            } else {
              await this.prisma.idempotencyRecord
                .update({
                  where,
                  data: { statusCode: res.statusCode, response: stored ?? Prisma.JsonNull, completedAt: new Date() },
                })
                .catch(() => undefined);
            }
            return body;
          })(),
        ),
      ),
      // A refused or failed request did nothing, so the key is free again.
      catchError((err) =>
        from(this.prisma.idempotencyRecord.delete({ where }).catch(() => undefined)).pipe(
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }

  private fingerprint(req: { method: string; originalUrl?: string; url: string; body?: unknown; headers: Record<string, unknown> }) {
    const isJson = String(req.headers['content-type'] ?? '').includes('application/json');
    const body = isJson && req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : '';
    return createHash('sha256').update(`${req.method} ${req.originalUrl ?? req.url}\n${body}`).digest('hex');
  }

  private async claim(
    userId: string,
    key: string,
    fingerprint: string,
  ): Promise<{ kind: 'run' } | { kind: 'replay'; statusCode: number; response: unknown }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.prisma.idempotencyRecord.create({ data: { userId, key, fingerprint } });
        return { kind: 'run' };
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
      const existing = await this.prisma.idempotencyRecord.findUnique({ where: { userId_key: { userId, key } } });
      if (!existing) continue; // released between the insert and this read
      if (existing.fingerprint !== fingerprint) {
        throw new UnprocessableEntityException('This Idempotency-Key was already used for a different request');
      }
      if (existing.completedAt) {
        return { kind: 'replay', statusCode: existing.statusCode ?? 200, response: existing.response };
      }
      if (Date.now() - existing.createdAt.getTime() < STALE_IN_PROGRESS_MS) {
        throw new ConflictException({
          message: 'This request is still being processed',
          code: 'IDEMPOTENCY_IN_PROGRESS',
        });
      }
      await this.prisma.idempotencyRecord.deleteMany({ where: { id: existing.id, completedAt: null } });
    }
    return { kind: 'run' };
  }

  // The reply as plain JSON, or undefined when it isn't something to keep.
  private storable(body: unknown, res: { headersSent?: boolean }): Prisma.InputJsonValue | null | undefined {
    if (res.headersSent || body instanceof StreamableFile || Buffer.isBuffer(body)) return undefined;
    if (body === undefined || body === null) return null;
    try {
      return JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue;
    } catch {
      return undefined;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async clearOld() {
    await this.prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } });
  }
}
