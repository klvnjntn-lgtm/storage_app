/*
  Warnings:

  - You are about to drop the `SessionExpectedItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SessionReopenEvent` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SessionExpectedItem" DROP CONSTRAINT "SessionExpectedItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "SessionExpectedItem" DROP CONSTRAINT "SessionExpectedItem_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "SessionReopenEvent" DROP CONSTRAINT "SessionReopenEvent_sessionId_fkey";

-- DropTable
DROP TABLE "SessionExpectedItem";

-- DropTable
DROP TABLE "SessionReopenEvent";
