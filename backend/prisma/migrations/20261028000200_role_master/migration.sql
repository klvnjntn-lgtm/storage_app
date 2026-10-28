-- A business-wide role above ADMIN. Added on its own: Postgres can't use a
-- new enum value in the transaction that adds it.
ALTER TYPE "Role" ADD VALUE 'MASTER' BEFORE 'ADMIN';
