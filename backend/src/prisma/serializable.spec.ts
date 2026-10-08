import { Prisma } from '@prisma/client';
import { isSerializationFailure, runSerializable } from './serializable';

const known = (code: string, meta?: Record<string, unknown>, message = 'x') =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test', meta });

describe('runSerializable', () => {
  it('treats a raw-query serialization failure (P2010 / 40001) as retryable', () => {
    expect(isSerializationFailure(known('P2034'))).toBe(true);
    expect(isSerializationFailure(known('P2010', { code: '40001' }))).toBe(true);
    expect(isSerializationFailure(known('P2010', { code: '40P01' }))).toBe(true);
    expect(isSerializationFailure(known('P2010', { code: '23505' }))).toBe(false);
    expect(isSerializationFailure(known('P2002'))).toBe(false);
  });

  it('retries until it succeeds', async () => {
    let calls = 0;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<string>) => {
        calls++;
        if (calls < 3) throw known('P2010', { code: '40001' });
        return fn({});
      },
    };
    await expect(runSerializable(prisma as never, async () => 'ok')).resolves.toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up as P2034 so callers can answer "please retry"', async () => {
    const prisma = { $transaction: async () => { throw known('P2010', { code: '40001' }); } };
    await expect(runSerializable(prisma as never, async () => 'never', 2)).rejects.toMatchObject({ code: 'P2034' });
  });
});
