-- Durable reward entitlements: a reward obligation is recorded inside
-- the settlement transaction so a crash between settlement and reward
-- processing cannot lose it. UNRESOLVED rows keep the entitlement until
-- the missing input is backfilled and the row is re-settled idempotently.

CREATE TABLE "reward_entitlements" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" INTEGER,
  "source" TEXT NOT NULL,
  "reference_id" TEXT NOT NULL,
  "reference_type" TEXT,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "unresolved_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "settled_at" TIMESTAMP(3),

  CONSTRAINT "reward_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reward_entitlements_source_reference_id_key"
  ON "reward_entitlements"("source", "reference_id");
CREATE INDEX "reward_entitlements_status_idx"
  ON "reward_entitlements"("status");
