-- Immutable per-period mission terms: first qualifying event of the UTC
-- day freezes requirement/credit/xp; later edits apply to future periods.
CREATE TABLE "mission_period_terms" (
    "id" TEXT NOT NULL,
    "mission_id" TEXT NOT NULL,
    "period_date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "requirement" INTEGER NOT NULL,
    "credit_reward" INTEGER NOT NULL,
    "xp_reward" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mission_period_terms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mission_period_terms_mission_id_period_date_key" ON "mission_period_terms"("mission_id", "period_date");
