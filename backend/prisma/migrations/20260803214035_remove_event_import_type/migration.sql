/*
  Warnings:

  - The values [IMPORT] on the enum `EventType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "EventType_new" AS ENUM ('IMPORT_REPLACE', 'IMPORT_INCREMENT', 'RECEIVE', 'RETURNS', 'MOVE', 'PICK', 'PACK', 'SHIP', 'ADJUSTMENT');
ALTER TABLE "Session" ALTER COLUMN "stage" TYPE "EventType_new" USING ("stage"::text::"EventType_new");
ALTER TABLE "Event" ALTER COLUMN "type" TYPE "EventType_new" USING ("type"::text::"EventType_new");
ALTER TYPE "EventType" RENAME TO "EventType_old";
ALTER TYPE "EventType_new" RENAME TO "EventType";
DROP TYPE "public"."EventType_old";
COMMIT;
