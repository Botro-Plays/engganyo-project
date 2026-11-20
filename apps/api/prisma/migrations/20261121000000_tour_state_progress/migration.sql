-- Server-authoritative tour state: in-progress step resume, automatic-
-- tour preference, and the beginner tour joining the same per-user,
-- per-tour, per-version model as milestone tours.
--
-- IN_PROGRESS rows are resumable UI state only — they never prove task
-- completion and grant nothing. Terminal statuses (COMPLETED, DISMISSED)
-- remain first-write-wins per (user, tour, version).

ALTER TYPE "TourCompletionStatus" ADD VALUE 'IN_PROGRESS';

ALTER TABLE "tour_completions"
    ADD COLUMN "step_index" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users"
    ADD COLUMN "auto_tours_enabled" BOOLEAN NOT NULL DEFAULT true;
