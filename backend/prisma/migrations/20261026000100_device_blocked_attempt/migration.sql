-- A rejected or revoked phone trying to sign in: noted on the device and
-- reported to the office instead of being refused silently.
ALTER TYPE "NotificationType" ADD VALUE 'DEVICE_BLOCKED_ATTEMPT';
ALTER TABLE "Device" ADD COLUMN "lastBlockedAttemptAt" TIMESTAMP(3);
