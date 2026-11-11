-- Processing lease for durable task outcomes: serializes workers so a
-- stale pass can never overwrite a completed/cancelled outcome or
-- acknowledge another worker's claim. NULL claim = unclaimed.
ALTER TABLE "task_completion_outcomes"
  ADD COLUMN "claimed_at" TIMESTAMP(3),
  ADD COLUMN "claim_token" TEXT;
