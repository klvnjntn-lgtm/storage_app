-- An admin marked the stop delivered/failed from the office.
ALTER TABLE "RouteStop" ADD COLUMN "markedByOfficeAt" TIMESTAMP(3);
