-- CreateTable
CREATE TABLE "wheel_spins" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "is_free" BOOLEAN NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wheel_spins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reward_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "streak_day" INTEGER NOT NULL,
    "credit_reward" INTEGER NOT NULL,
    "xp_reward" INTEGER NOT NULL,
    "bonus_loot_box" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_reward_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wheel_spins_user_id_idx" ON "wheel_spins"("user_id");

-- CreateIndex
CREATE INDEX "wheel_spins_created_at_idx" ON "wheel_spins"("created_at");

-- CreateIndex
CREATE INDEX "daily_reward_logs_user_id_idx" ON "daily_reward_logs"("user_id");

-- CreateIndex
CREATE INDEX "daily_reward_logs_user_id_created_at_idx" ON "daily_reward_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "wheel_spins" ADD CONSTRAINT "wheel_spins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reward_logs" ADD CONSTRAINT "daily_reward_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
