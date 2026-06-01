-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'PLATFORM_FEE_CAMPAIGN';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "fee_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fee_rate_at_create" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
ADD COLUMN     "fee_tier" TEXT NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "platform_revenue" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "campaign_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_revenue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_revenue_campaign_id_key" ON "platform_revenue"("campaign_id");

-- CreateIndex
CREATE INDEX "platform_revenue_date_idx" ON "platform_revenue"("date");

-- CreateIndex
CREATE INDEX "platform_revenue_source_idx" ON "platform_revenue"("source");

-- AddForeignKey
ALTER TABLE "platform_revenue" ADD CONSTRAINT "platform_revenue_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
