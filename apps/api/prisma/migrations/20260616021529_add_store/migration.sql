-- CreateEnum
CREATE TYPE "StoreCategory" AS ENUM ('BOOST', 'COSMETIC', 'CONVENIENCE', 'CREDIT_PACK', 'GUILD_PERK');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'SPEND_STORE_PURCHASE';

-- CreateTable
CREATE TABLE "store_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "StoreCategory" NOT NULL,
    "credit_cost" INTEGER NOT NULL,
    "is_limited" BOOLEAN NOT NULL DEFAULT false,
    "limited_qty" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_inventory" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "consumed_at" TIMESTAMP(3),
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_purchases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "credit_cost_at_purchase" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_items_category_is_active_idx" ON "store_items"("category", "is_active");

-- CreateIndex
CREATE INDEX "store_items_is_active_idx" ON "store_items"("is_active");

-- CreateIndex
CREATE INDEX "user_inventory_user_id_idx" ON "user_inventory"("user_id");

-- CreateIndex
CREATE INDEX "user_inventory_item_id_idx" ON "user_inventory"("item_id");

-- CreateIndex
CREATE INDEX "user_inventory_user_id_item_id_idx" ON "user_inventory"("user_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_purchases_transaction_id_key" ON "store_purchases"("transaction_id");

-- CreateIndex
CREATE INDEX "store_purchases_user_id_idx" ON "store_purchases"("user_id");

-- CreateIndex
CREATE INDEX "store_purchases_item_id_idx" ON "store_purchases"("item_id");

-- CreateIndex
CREATE INDEX "store_purchases_transaction_id_idx" ON "store_purchases"("transaction_id");

-- AddForeignKey
ALTER TABLE "user_inventory" ADD CONSTRAINT "user_inventory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_inventory" ADD CONSTRAINT "user_inventory_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "store_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "store_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
