-- Fix is_consumable = false for all cosmetic items
-- (migration 20260616025608 added the column with DEFAULT true, overriding seed intent)
UPDATE "store_items" SET "is_consumable" = false WHERE "category" = 'COSMETIC';

-- Add equipped column to user_inventory (for cosmetic equip/unequip)
ALTER TABLE "user_inventory" ADD COLUMN "equipped" BOOLEAN NOT NULL DEFAULT false;

-- Repair cosmetic inventory rows that were erroneously consumed
-- (due to is_consumable being true when it should have been false)
UPDATE "user_inventory"
SET "consumed_at" = NULL, "quantity" = 1
WHERE "consumed_at" IS NOT NULL
  AND "item_id" IN (SELECT "id" FROM "store_items" WHERE "category" = 'COSMETIC');

-- Auto-equip all existing unconsumed cosmetic inventory rows
UPDATE "user_inventory"
SET "equipped" = true
WHERE "item_id" IN (SELECT "id" FROM "store_items" WHERE "category" = 'COSMETIC')
  AND "consumed_at" IS NULL
  AND "quantity" > 0;
