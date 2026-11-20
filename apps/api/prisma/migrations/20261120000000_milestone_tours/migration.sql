-- Milestone onboarding tours: per-user, per-tour, per-version completion
-- state persisted server-side so tours follow the account across devices.
-- Rows carry no rewards — completion is UI state only and can never
-- prove task completion or trigger payouts.

CREATE TYPE "TourCompletionStatus" AS ENUM ('COMPLETED', 'DISMISSED');

CREATE TABLE "tour_completions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tour_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "TourCompletionStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_completions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tour_completions_user_id_tour_key_version_key"
    ON "tour_completions"("user_id", "tour_key", "version");

CREATE INDEX "tour_completions_user_id_idx"
    ON "tour_completions"("user_id");

ALTER TABLE "tour_completions"
    ADD CONSTRAINT "tour_completions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
