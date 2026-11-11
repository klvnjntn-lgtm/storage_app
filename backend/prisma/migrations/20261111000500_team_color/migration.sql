-- Each team keeps one map color for good (see Team.colorIndex).
ALTER TABLE "Team" ADD COLUMN "colorIndex" INTEGER NOT NULL DEFAULT 0;

-- Existing teams: in the order they were made, per business, cycling
-- through the 8 colors.
UPDATE "Team" t
SET "colorIndex" = n.idx
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id") - 1) % 8 AS idx
  FROM "Team"
) n
WHERE t."id" = n."id";
