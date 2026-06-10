-- DropForeignKey
ALTER TABLE "platform_revenue" DROP CONSTRAINT "platform_revenue_campaign_id_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "weekly_digest_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "platform_revenue" ADD CONSTRAINT "platform_revenue_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
