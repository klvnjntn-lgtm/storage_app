-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MECHANIC';

-- DropIndex
DROP INDEX "Organization_workshopBoardToken_key";

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "isMechanic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "workshopBoardToken";


-- Everyone already picked as a mechanic — on a work order or an invoice — stays pickable.
UPDATE "Employee" e SET "isMechanic" = true
WHERE EXISTS (SELECT 1 FROM "WorkOrder" w WHERE w."mechanicId" = e."id")
   OR EXISTS (SELECT 1 FROM "Invoice" i WHERE i."mechanicId" = e."id");
