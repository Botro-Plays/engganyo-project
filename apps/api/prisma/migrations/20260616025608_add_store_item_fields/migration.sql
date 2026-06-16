-- AlterTable
ALTER TABLE "store_items" ADD COLUMN     "is_consumable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "max_owned_per_user" INTEGER;
