-- AlterEnum
-- Its own migration: Postgres can't use a new enum value in the
-- transaction that adds it (the backfill is the next migration).
ALTER TYPE "ModuleKey" ADD VALUE 'ACCOUNTING';
