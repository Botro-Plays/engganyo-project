-- AlterTable
ALTER TABLE "users" ADD COLUMN     "vip_tier_id" TEXT,
ADD COLUMN     "vp" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "vip_tiers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "requirement_vp" INTEGER NOT NULL,
    "perks" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vip_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vip_tiers_name_key" ON "vip_tiers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vip_tiers_level_key" ON "vip_tiers"("level");

-- CreateIndex
CREATE INDEX "users_vip_tier_id_idx" ON "users"("vip_tier_id");

-- CreateIndex
CREATE INDEX "users_vp_idx" ON "users"("vp");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_vip_tier_id_fkey" FOREIGN KEY ("vip_tier_id") REFERENCES "vip_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
