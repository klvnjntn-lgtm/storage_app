-- HIGH priority stops now come before normal ones among the stops still to do
-- (see priority-order.ts). Puts open routes that break the rule in that order.
-- Finished stops hold their place, and closed routes stay as they were run.
-- The "pending" test matches pendingStopWhere; a DO stop's priority is on its DO.
CREATE TEMP TABLE "_pending_stop" ON COMMIT DROP AS
SELECT
  s."id",
  s."routeId",
  s."sequence",
  COALESCE(d."priority", s."priority") = 'HIGH' AS "high"
FROM "RouteStop" s
LEFT JOIN "DeliveryOrder" d ON d."id" = s."deliveryOrderId"
JOIN "Route" r ON r."id" = s."routeId"
WHERE r."status" IN ('PLANNED', 'ACTIVE')
  AND s."supersededAt" IS NULL
  AND s."signedAt" IS NULL
  AND s."failedAt" IS NULL
  AND (
    s."deliveryOrderId" IS NULL
    OR (d."signedAt" IS NULL AND d."status" IN ('PACKED', 'SHIPPED'))
  );

CREATE TEMP TABLE "_moved_route" ON COMMIT DROP AS
SELECT "routeId"
FROM "_pending_stop"
GROUP BY "routeId"
HAVING MAX("sequence") FILTER (WHERE "high") > MIN("sequence") FILTER (WHERE NOT "high");

-- The nth stop in the new order takes the nth pending position on its route.
CREATE TEMP TABLE "_new_sequence" ON COMMIT DROP AS
SELECT wanted."id", place."sequence"
FROM (
  SELECT "id", "routeId",
    ROW_NUMBER() OVER (PARTITION BY "routeId" ORDER BY "high" DESC, "sequence") AS "n"
  FROM "_pending_stop"
  WHERE "routeId" IN (SELECT "routeId" FROM "_moved_route")
) wanted
JOIN (
  SELECT "routeId", "sequence",
    ROW_NUMBER() OVER (PARTITION BY "routeId" ORDER BY "sequence") AS "n"
  FROM "_pending_stop"
) place ON place."routeId" = wanted."routeId" AND place."n" = wanted."n";

-- Two steps: the unique index on (routeId, sequence) is checked row by row.
UPDATE "RouteStop" s SET "sequence" = -n."sequence" FROM "_new_sequence" n WHERE s."id" = n."id";

-- Legs and ETAs described the old order, and later ETAs are worked out from
-- them, so they go. Those routes show no ETAs until they're next optimized.
UPDATE "RouteStop" s SET
  "sequence" = n."sequence",
  "plannedEta" = NULL,
  "travelSecondsFromPrevious" = NULL,
  "travelMetersFromPrevious" = NULL,
  "atRiskNotifiedAt" = NULL,
  "lateNotifiedAt" = NULL
FROM "_new_sequence" n
WHERE s."id" = n."id";

UPDATE "Route" r SET "version" = r."version" + 1, "updatedAt" = NOW()
WHERE r."id" IN (SELECT "routeId" FROM "_moved_route");

INSERT INTO "RouteHistoryEvent" ("id", "routeId", "type", "metadata")
SELECT
  gen_random_uuid()::text,
  r."id",
  'STOPS_REORDERED',
  jsonb_build_object('version', r."version", 'priorityOrder', true, 'migrated', true)
FROM "Route" r
WHERE r."id" IN (SELECT "routeId" FROM "_moved_route");
