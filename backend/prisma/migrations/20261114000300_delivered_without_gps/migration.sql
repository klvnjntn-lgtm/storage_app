-- A driver may finish a delivery with no GPS reading; it's flagged for the office.
ALTER TABLE "DeliveryOrder" ADD COLUMN "deliveredWithoutGps" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RouteStop" ADD COLUMN "deliveredWithoutGps" BOOLEAN NOT NULL DEFAULT false;
