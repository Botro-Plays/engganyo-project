-- Weekly verified-activity reward entitlement + outcome settle flag.
-- One entitlement row per (user, item, ISO week) is the replay identity
-- for exactly-once grant settlement.

ALTER TABLE "task_completion_outcomes"
  ADD COLUMN "activity_reward_settled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "activity_reward_entitlements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "iso_week" TEXT NOT NULL,
    "source_completion_id" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_reward_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_reward_entitlements_user_id_item_id_iso_week_key"
    ON "activity_reward_entitlements"("user_id", "item_id", "iso_week");

CREATE INDEX "activity_reward_entitlements_user_id_iso_week_idx"
    ON "activity_reward_entitlements"("user_id", "iso_week");

ALTER TABLE "activity_reward_entitlements"
    ADD CONSTRAINT "activity_reward_entitlements_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "activity_reward_entitlements"
    ADD CONSTRAINT "activity_reward_entitlements_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "store_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
