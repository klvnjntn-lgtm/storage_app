import { Prisma, PrismaClient } from '@prisma/client';

// Postgres serialization failure / deadlock. Prisma reports these as P2034
// from its own queries, but from a raw query ($queryRaw — e.g. a SELECT ...
// FOR UPDATE) as P2010 carrying the Postgres code, which used to escape the
// retry below as an unhandled 500.
const RETRYABLE_PG_CODES = ['40001', '40P01'];

export function isSerializationFailure(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === 'P2034') return true;
  if (e.code !== 'P2010') return false;
  const meta = e.meta as { code?: string } | undefined;
  return RETRYABLE_PG_CODES.includes(meta?.code ?? '') || RETRYABLE_PG_CODES.some((c) => e.message.includes(`Code: \`${c}\``));
}

// Runs `fn` in a Serializable transaction, retrying on a serialization
// failure or deadlock. Postgres raises these even between unrelated rows —
// its predicate locks cover index pages, not just the rows read — so under
// ordinary concurrent load a first attempt can fail through no fault of the
// request. A few retries with a jittered, growing backoff absorb that; if
// every attempt fails, the error is rethrown as P2034 for the caller's
// existing "please retry" (409) handling.
export async function runSerializable<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 6,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      if (!isSerializationFailure(e)) throw e;
      if (attempt >= attempts) {
        throw new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict', {
          code: 'P2034',
          clientVersion: Prisma.prismaVersion.client,
        });
      }
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 50 * attempt));
    }
  }
}
