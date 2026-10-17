-- The original name was over Postgres's 63-character limit, so Postgres
-- truncated it differently from the name Prisma expects; without this,
-- every `prisma migrate dev` would generate a rename.
ALTER INDEX "PartWorkshopEvidence_carBrand_model_item_kind_valueNormalized_k" RENAME TO "PartWorkshopEvidence_carBrand_model_item_kind_valueNormaliz_key";
