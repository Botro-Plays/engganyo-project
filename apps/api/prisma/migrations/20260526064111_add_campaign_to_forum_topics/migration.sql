-- AlterTable
ALTER TABLE "forum_topics" ADD COLUMN     "campaign_id" TEXT;

-- CreateIndex
CREATE INDEX "forum_topics_campaign_id_idx" ON "forum_topics"("campaign_id");

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
