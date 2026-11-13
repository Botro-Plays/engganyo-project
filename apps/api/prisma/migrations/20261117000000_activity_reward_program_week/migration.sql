-- Weekly activity reward: grant identity is per user+program+week,
-- independent of the configured itemId. item_id is kept on the row as
-- the audit record of which item was actually awarded.
ALTER TABLE "activity_reward_entitlements"
  DROP CONSTRAINT "activity_reward_entitlements_user_id_item_id_iso_week_key";

ALTER TABLE "activity_reward_entitlements"
  ADD CONSTRAINT "activity_reward_entitlements_user_id_iso_week_key"
  UNIQUE ("user_id", "iso_week");
