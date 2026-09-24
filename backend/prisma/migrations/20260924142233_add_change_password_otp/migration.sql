-- AlterTable
ALTER TABLE "User" ADD COLUMN     "changePasswordOtpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "changePasswordOtpExpires" TIMESTAMP(3),
ADD COLUMN     "changePasswordOtpHash" TEXT,
ADD COLUMN     "pendingPasswordHash" TEXT;
