-- Entitlement sweep backoff: unresolved/unsettled reward entitlements
-- carry a next_attempt_at so persistent unresolved cases cannot starve
-- newer eligible work at the head of the sweep queue.

ALTER TABLE "reward_entitlements"
  ADD COLUMN "next_attempt_at" TIMESTAMP(3);

CREATE INDEX "reward_entitlements_status_next_attempt_at_idx"
  ON "reward_entitlements"("status", "next_attempt_at");
