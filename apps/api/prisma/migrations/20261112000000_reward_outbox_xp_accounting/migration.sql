-- Reward outbox: durable post-commit delivery for reward notifications
-- and socket events, plus XP event accounting fields (applied delta,
-- base amount, boost multiplier).

ALTER TABLE "xp_events"
  ADD COLUMN "base_amount" INTEGER,
  ADD COLUMN "boost_multiplier" DOUBLE PRECISION;

CREATE TABLE "reward_outbox_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "notification_type" TEXT,
  "title" TEXT,
  "body" TEXT,
  "data" JSONB,
  "socket_event" TEXT,
  "socket_payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "processing_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered_at" TIMESTAMP(3),

  CONSTRAINT "reward_outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reward_outbox_events_status_created_at_idx"
  ON "reward_outbox_events"("status", "created_at");

-- Replay-protection lookups for awardXp/awardVp dedupe checks.
CREATE INDEX "xp_events_user_id_source_reference_id_idx"
  ON "xp_events"("user_id", "source", "reference_id");
CREATE INDEX "vp_events_user_id_source_reference_id_idx"
  ON "vp_events"("user_id", "source", "reference_id");
