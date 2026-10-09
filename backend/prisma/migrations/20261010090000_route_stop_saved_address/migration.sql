-- A customer route stop can go to one of the customer's saved addresses
-- instead of the main one. addressLabel snapshots that address's name.
-- AlterTable
ALTER TABLE "RouteStop" ADD COLUMN     "addressLabel" TEXT,
ADD COLUMN     "customerAddressId" TEXT;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_customerAddressId_fkey" FOREIGN KEY ("customerAddressId") REFERENCES "CustomerAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
