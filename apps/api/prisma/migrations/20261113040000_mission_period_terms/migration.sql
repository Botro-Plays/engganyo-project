-- Immutable per-period mission catalog: first touch of the UTC period
-- freezes every active mission's display/eligibility/settlement terms;
-- admin mutations schedule changes into the next period.
CREATE TABLE "mission_period_terms" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "period_date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "icon" TEXT,
    "requirement" INTEGER NOT NULL,
    "credit_reward" INTEGER NOT NULL,
    "xp_reward" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mission_period_terms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mission_period_terms_mission_id_period_date_key" ON "mission_period_terms"("mission_id", "period_date");
CREATE INDEX "mission_period_terms_period_date_type_idx" ON "mission_period_terms"("period_date", "type");
