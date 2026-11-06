-- 1v1 P2P challenges: dedicated offer model + optional challenge link on
-- task_completions. Exactly one of campaign_id / challenge_id must be set.

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'SPEND_CHALLENGE_CREATE';
ALTER TYPE "TransactionType" ADD VALUE 'REFUND_CHALLENGE_CLOSE';
ALTER TYPE "TransactionType" ADD VALUE 'PLATFORM_FEE_CHALLENGE';

-- CreateEnum
CREATE TYPE "ChallengeVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('OPEN', 'CLAIMED', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- AlterTable: task_completions gains an optional challenge link
ALTER TABLE "task_completions" ALTER COLUMN "campaign_id" DROP NOT NULL;
ALTER TABLE "task_completions" ADD COLUMN "challenge_id" TEXT;

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "action_text" TEXT NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "target_url" TEXT NOT NULL,
    "reward_credits" INTEGER NOT NULL,
    "requires_proof" BOOLEAN NOT NULL DEFAULT true,
    "proof_instructions" TEXT,
    "visibility" "ChallengeVisibility" NOT NULL DEFAULT 'PUBLIC',
    "password_hash" TEXT,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'OPEN',
    "fee_rate_snapshot" DOUBLE PRECISION NOT NULL,
    "fee_amount" INTEGER NOT NULL,
    "reserved_credits" INTEGER NOT NULL,
    "claimed_by_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_completions_challenge_id_key" ON "task_completions"("challenge_id");
CREATE INDEX "task_completions_challenge_id_idx" ON "task_completions"("challenge_id");
CREATE INDEX "challenges_creator_id_idx" ON "challenges"("creator_id");
CREATE INDEX "challenges_status_idx" ON "challenges"("status");
CREATE INDEX "challenges_visibility_idx" ON "challenges"("visibility");
CREATE INDEX "challenges_expires_at_idx" ON "challenges"("expires_at");
CREATE INDEX "challenges_claimed_by_id_idx" ON "challenges"("claimed_by_id");

-- AddForeignKey
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_revenue" ADD COLUMN "challenge_id" TEXT;
CREATE UNIQUE INDEX "platform_revenue_challenge_id_key" ON "platform_revenue"("challenge_id");
ALTER TABLE "platform_revenue" ADD CONSTRAINT "platform_revenue_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one offer link per completion: campaign XOR challenge.
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_single_offer"
  CHECK (num_nonnulls("campaign_id", "challenge_id") = 1);
