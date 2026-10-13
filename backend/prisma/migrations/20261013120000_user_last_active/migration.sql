-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- Start from the last password login, the best record there is so far.
UPDATE "User" SET "lastActiveAt" = "lastLoginAt";
