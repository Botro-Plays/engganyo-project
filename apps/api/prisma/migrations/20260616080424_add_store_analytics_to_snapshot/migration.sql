-- AlterTable
ALTER TABLE "analytics_snapshots" ADD COLUMN     "store_credits_spent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "store_purchases" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "store_top_item_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "store_top_item_id" TEXT,
ADD COLUMN     "store_top_item_name" TEXT;
