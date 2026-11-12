-- Reward terms frozen at the qualifying VERIFIED event (mission
-- eligibility + terms, XP boost multiplier). NULL on pre-existing rows
-- keeps the documented live-config fallback for legacy outcomes.
ALTER TABLE "task_completion_outcomes" ADD COLUMN "reward_snapshot" JSONB;
