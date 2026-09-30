import { Prisma, PrismaClient } from '@prisma/client';

// Runs `fn` in a Serializable transaction, retrying on P2034 (serialization
// failure / deadlock). Postgres raises P2034 even between unrelated rows —
// its predicate locks cover index pages, not just the rows read — so under
// ordinary concurrent load a first attempt can fail through no fault of
// the request. A few retries with a short jittered backoff absorb that;
// if every attempt fails, the P2034 is rethrown for the caller's existing
// "please retry" (409) handling.
export async function runSerializable<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 4,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      const retryable = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
      if (!retryable || attempt >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 30));
    }
  }
}
