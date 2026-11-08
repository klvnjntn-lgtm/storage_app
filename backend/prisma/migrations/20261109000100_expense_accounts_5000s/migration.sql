-- Expense accounts all live in the 5000s now (5000 COGS, 5100 salary, 5110 depreciation,
-- 5200-5899 operating, 5900+ other). Moves every expense account still on a 6000s code:
-- the built-in ones to their new homes, any other 6xyz to 5xyz, sub-accounts (6200.1) with
-- their parent. Postings reference account ids, so no booked figure changes.
-- A target code that's already in use is left alone (that account keeps its 6000s code).
WITH src AS (
  SELECT id,
         "organizationId" AS org,
         code,
         split_part(code, '.', 1) AS base,
         substr(code, length(split_part(code, '.', 1)) + 1) AS rest
  FROM "ChartOfAccount"
  WHERE type = 'EXPENSE' AND code ~ '^6[0-9]{3}(\.|$)'
),
mapped AS (
  SELECT id, org, code,
         (CASE base
            WHEN '6000' THEN '5100'
            WHEN '6100' THEN '5110'
            WHEN '6900' THEN '5990'
            WHEN '6910' THEN '5910'
            ELSE '5' || substr(base, 2)
          END) || rest AS target
  FROM src
),
ranked AS (
  SELECT m.*,
         row_number() OVER (
           PARTITION BY org, target
           ORDER BY (split_part(code, '.', 1) IN ('6000', '6100', '6900', '6910')) DESC, code
         ) AS rn
  FROM mapped m
  WHERE NOT EXISTS (
    SELECT 1 FROM "ChartOfAccount" c WHERE c."organizationId" = m.org AND c.code = m.target
  )
)
UPDATE "ChartOfAccount" a
SET code = r.target
FROM ranked r
WHERE a.id = r.id AND r.rn = 1;
