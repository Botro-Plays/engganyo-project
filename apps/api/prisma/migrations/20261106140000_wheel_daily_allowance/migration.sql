-- Authoritative per-user, per-UTC-day wheel spin allowance. Mutated only
-- inside the spin settlement transaction via conditional updateMany.

-- CreateTable
CREATE TABLE "wheel_daily_allowances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "free_used" BOOLEAN NOT NULL DEFAULT false,
    "paid_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wheel_daily_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wheel_daily_allowances_user_id_day_key" ON "wheel_daily_allowances"("user_id", "day");
CREATE INDEX "wheel_daily_allowances_user_id_idx" ON "wheel_daily_allowances"("user_id");

-- AddForeignKey
ALTER TABLE "wheel_daily_allowances" ADD CONSTRAINT "wheel_daily_allowances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
