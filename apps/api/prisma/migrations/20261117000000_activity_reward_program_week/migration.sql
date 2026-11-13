-- Weekly activity reward: grant identity is per user+program+week,
-- independent of the configured itemId. item_id is kept on the row as
-- the audit record of which item was actually awarded.
DROP INDEX "activity_reward_entitlements_user_id_item_id_iso_week_key";

CREATE UNIQUE INDEX "activity_reward_entitlements_user_id_iso_week_key"
    ON "activity_reward_entitlements"("user_id", "iso_week");
