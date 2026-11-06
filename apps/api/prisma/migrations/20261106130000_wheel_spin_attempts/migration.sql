-- Idempotent wheel spins: user-scoped attempt key + recoverable result,
-- unique at the database level inside the settlement transaction.

-- CreateEnum
CREATE TYPE "WheelSpinAttemptStatus" AS ENUM ('PENDING', 'COMMITTED');

-- CreateTable
CREATE TABLE "wheel_spin_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "WheelSpinAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wheel_spin_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wheel_spin_attempts_user_id_key_key" ON "wheel_spin_attempts"("user_id", "key");
CREATE INDEX "wheel_spin_attempts_user_id_idx" ON "wheel_spin_attempts"("user_id");

-- AddForeignKey
ALTER TABLE "wheel_spin_attempts" ADD CONSTRAINT "wheel_spin_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
