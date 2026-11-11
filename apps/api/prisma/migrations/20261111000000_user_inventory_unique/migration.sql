-- One inventory row per (user, item). All writers upsert on this key so
-- grants, purchases, loot boxes, and marketplace transfers can never
-- fragment a stack into duplicate rows.
--
-- Pre-flight verified on production (11 Nov 2026): zero duplicate
-- (user_id, item_id) pairs exist, so this index applies cleanly.

-- DropIndex (non-unique lookup index superseded by the unique index)
DROP INDEX IF EXISTS "user_inventory_user_id_item_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "user_inventory_user_id_item_id_key" ON "user_inventory"("user_id", "item_id");
