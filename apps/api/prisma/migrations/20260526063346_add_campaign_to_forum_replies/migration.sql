-- AlterTable
ALTER TABLE "forum_replies" ADD COLUMN     "campaign_id" TEXT;

-- CreateIndex
CREATE INDEX "forum_replies_campaign_id_idx" ON "forum_replies"("campaign_id");

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
