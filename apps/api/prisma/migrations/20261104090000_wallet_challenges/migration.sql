ALTER TABLE "deposits" ADD COLUMN "wallet_verified" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "wallet_challenges" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "chain" TEXT NOT NULL,
  "deposit_id" TEXT,
  "nonce" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_challenges_nonce_key" ON "wallet_challenges"("nonce");
CREATE INDEX "wallet_challenges_user_id_idx" ON "wallet_challenges"("user_id");
