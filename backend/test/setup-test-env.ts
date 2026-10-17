// Runs before every spec file. Points Prisma at a dedicated test database so
// the DB-backed specs (which create and delete rows) can never touch a real
// one. Start it with `npm run test:db:up`.
const baseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:test@localhost:5434/waresys_test?schema=public';

// Jest runs one worker per core minus one, and each worker's PrismaClient
// otherwise opens a pool of cores*2+1 connections — on 8 cores that's ~119
// against Postgres's default max of 100, so specs failed at random with
// connection errors and timed-out transactions. A small pool per worker
// keeps the full run parallel and under the limit.
const parsed = new URL(baseUrl);
if (!parsed.searchParams.has('connection_limit')) parsed.searchParams.set('connection_limit', '5');
const url = parsed.toString();

const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  throw new Error(
    `Refusing to run tests against database "${dbName}" — its name must end in "_test".`,
  );
}

// Set before any spec imports 'dotenv/config'; dotenv never overrides an
// existing variable, so backend/.env's DATABASE_URL is ignored under jest.
process.env.DATABASE_URL = url;
process.env.JWT_SECRET ??= 'test-jwt-secret';
// Specs exercise the fake gateway and the log WhatsApp provider.
process.env.ONLINE_PAYMENTS_ENABLED ??= 'true';
process.env.WHATSAPP_ENABLED ??= 'true';
