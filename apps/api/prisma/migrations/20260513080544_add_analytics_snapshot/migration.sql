-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "total_users" INTEGER NOT NULL DEFAULT 0,
    "new_users" INTEGER NOT NULL DEFAULT 0,
    "daily_active" INTEGER NOT NULL DEFAULT 0,
    "monthly_active" INTEGER NOT NULL DEFAULT 0,
    "tasks_assigned" INTEGER NOT NULL DEFAULT 0,
    "tasks_submitted" INTEGER NOT NULL DEFAULT 0,
    "tasks_verified" INTEGER NOT NULL DEFAULT 0,
    "tasks_rejected" INTEGER NOT NULL DEFAULT 0,
    "campaigns_created" INTEGER NOT NULL DEFAULT 0,
    "campaigns_completed" INTEGER NOT NULL DEFAULT 0,
    "credits_issued" INTEGER NOT NULL DEFAULT 0,
    "credits_spent" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_snapshots_date_key" ON "analytics_snapshots"("date");

-- CreateIndex
CREATE INDEX "analytics_snapshots_date_idx" ON "analytics_snapshots"("date");
