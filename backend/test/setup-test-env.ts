// Runs before every spec file. Points Prisma at a dedicated test database so
// the DB-backed specs (which create and delete rows) can never touch a real
// one. Start it with `npm run test:db:up`.
const url =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:test@localhost:5434/waresys_test?schema=public';

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
