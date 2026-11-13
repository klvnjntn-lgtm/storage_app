-- Email ownership verification (auth/email-verification.ts).
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerifyOtpHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifyOtpExpires" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerifyOtpAttempts" INTEGER NOT NULL DEFAULT 0;

-- Accounts from before verification existed keep working as they did:
-- they count as verified, so no existing business is suddenly gated.
UPDATE "User" SET "emailVerifiedAt" = "createdAt";
