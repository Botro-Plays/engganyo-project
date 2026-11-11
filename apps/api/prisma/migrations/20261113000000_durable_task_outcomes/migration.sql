-- Durable task-completion outcomes + mission event dedupe +
-- idempotent notification delivery.

CREATE TABLE "task_completion_outcomes" (
  "id" TEXT NOT NULL,
  "completion_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "xp_settled" BOOLEAN NOT NULL DEFAULT false,
  "vp_settled" BOOLEAN NOT NULL DEFAULT false,
  "mission_settled" BOOLEAN NOT NULL DEFAULT false,
  "achievements_settled" BOOLEAN NOT NULL DEFAULT false,
  "referral_settled" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),

  CONSTRAINT "task_completion_outcomes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "task_completion_outcomes_completion_id_key"
  ON "task_completion_outcomes"("completion_id");
CREATE INDEX "task_completion_outcomes_status_created_at_idx"
  ON "task_completion_outcomes"("status", "created_at");

CREATE TABLE "mission_progress_events" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "mission_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mission_progress_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mission_progress_events_mission_id_source_type_source_id_key"
  ON "mission_progress_events"("mission_id", "source_type", "source_id");
CREATE INDEX "mission_progress_events_user_id_date_idx"
  ON "mission_progress_events"("user_id", "date");

ALTER TABLE "notifications"
  ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "notifications_dedupe_key_key"
  ON "notifications"("dedupe_key");
