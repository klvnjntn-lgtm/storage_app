-- CreateEnum
CREATE TYPE "FulfillmentMode" AS ENUM ('PICK_PACK_SHIP', 'PICK_SHIP');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "fulfillmentMode" "FulfillmentMode" NOT NULL DEFAULT 'PICK_PACK_SHIP';
