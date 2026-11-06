import { BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { LogPhotoRefusalInterceptor } from './log-photo-refusal.interceptor';

const context = (body: Record<string, unknown> | undefined) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        body,
        path: '/delivery-routes/r1/stops/s1/proof-photo',
        user: { sub: 'u1', role: 'DRIVER' },
      }),
    }),
  }) as unknown as ExecutionContext;
const failing = (err: Error): CallHandler => ({ handle: () => throwError(() => err) });

describe('LogPhotoRefusalInterceptor', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => warn.mockRestore());

  it('logs why a photo was refused, and still refuses it', async () => {
    const refusal = new BadRequestException('A GPS location is required\nto record a delivery');
    await expect(
      firstValueFrom(
        new LogPhotoRefusalInterceptor().intercept(
          context({ takenAt: '2026-11-06T05:00:00.000Z' }),
          failing(refusal),
        ),
      ),
    ).rejects.toBe(refusal);

    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain('status=400');
    expect(line).toContain('reason="A GPS location is required to record a delivery"');
    expect(line).toContain('user=u1 role=DRIVER');
    expect(line).toContain('path=/delivery-routes/r1/stops/s1/proof-photo');
    expect(line).toContain('gps=no');
    expect(line).toContain('takenAt=2026-11-06T05:00:00.000Z');
  });

  it('copes with a refusal before the form was read, like a file too large', async () => {
    await expect(
      firstValueFrom(
        new LogPhotoRefusalInterceptor().intercept(context(undefined), failing(new BadRequestException('Too big'))),
      ),
    ).rejects.toThrow('Too big');
    expect(warn.mock.calls[0][0]).toContain('gps=no');
  });

  it('stays quiet on success and on server errors', async () => {
    const interceptor = new LogPhotoRefusalInterceptor();
    await firstValueFrom(interceptor.intercept(context({}), { handle: () => of({ hasPhoto: true }) }));
    await expect(
      firstValueFrom(interceptor.intercept(context({}), failing(new InternalServerErrorException()))),
    ).rejects.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
