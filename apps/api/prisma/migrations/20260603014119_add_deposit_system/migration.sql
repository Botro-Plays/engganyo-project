-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DepositMethod" AS ENUM ('PAYMONGO', 'PAYPAL', 'USDT_BEP20', 'USDT_BASE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'DEPOSIT_PAYMONGO';
ALTER TYPE "TransactionType" ADD VALUE 'DEPOSIT_PAYPAL';
ALTER TYPE "TransactionType" ADD VALUE 'DEPOSIT_CRYPTO';

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method" "DepositMethod" NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "amount_fiat" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "credits_to_award" INTEGER NOT NULL,
    "credits_awarded" INTEGER NOT NULL DEFAULT 0,
    "payment_ref" TEXT,
    "gateway_data" JSONB,
    "admin_notes" TEXT,
    "reviewed_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deposits_payment_ref_key" ON "deposits"("payment_ref");

-- CreateIndex
CREATE INDEX "deposits_user_id_idx" ON "deposits"("user_id");

-- CreateIndex
CREATE INDEX "deposits_method_idx" ON "deposits"("method");

-- CreateIndex
CREATE INDEX "deposits_status_idx" ON "deposits"("status");

-- CreateIndex
CREATE INDEX "deposits_created_at_idx" ON "deposits"("created_at");

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
