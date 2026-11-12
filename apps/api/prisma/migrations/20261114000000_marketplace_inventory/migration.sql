-- Player item marketplace: provenance-segregated inventory, movement audit,
-- listings and orders. Existing inventory rows default to LEGACY provenance
-- (bound until classified by the read-only inventory audit).

-- CreateEnum
CREATE TYPE "InventoryProvenance" AS ENUM ('LEGACY', 'PURCHASE', 'ADMIN_GRANT', 'REWARD', 'MARKETPLACE');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'SPEND_MARKETPLACE_PURCHASE';
ALTER TYPE "TransactionType" ADD VALUE 'EARN_MARKETPLACE_SALE';

-- CreateEnum
CREATE TYPE "MarketplaceListingStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SOLD_OUT', 'CANCELLED', 'EXPIRED', 'REMOVED');

-- AlterTable: provenance-segregated stacks. Bound and tradable units can
-- never merge because the stack key now includes provenance.
ALTER TABLE "user_inventory" ADD COLUMN "provenance" "InventoryProvenance" NOT NULL DEFAULT 'LEGACY';
DROP INDEX IF EXISTS "user_inventory_user_id_item_id_key";
CREATE UNIQUE INDEX "user_inventory_user_id_item_id_provenance_key" ON "user_inventory"("user_id", "item_id", "provenance");

-- CreateTable: append-only inventory movement audit
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "inventory_id" TEXT,
    "delta" INTEGER NOT NULL,
    "quantity_after" INTEGER,
    "reason" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "provenance" "InventoryProvenance",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable: marketplace listings (escrow model, never deleted)
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "inventory_id" TEXT NOT NULL,
    "provenance" "InventoryProvenance" NOT NULL,
    "item_snapshot" JSONB NOT NULL,
    "original_quantity" INTEGER NOT NULL,
    "remaining_quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "status" "MarketplaceListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "removed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: marketplace orders (one per completed purchase, idempotent)
CREATE TABLE "marketplace_orders" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "total_price" INTEGER NOT NULL,
    "fee_amount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "purchase_key" TEXT NOT NULL,
    "buyer_transaction_id" TEXT,
    "seller_transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_movements_user_id_created_at_idx" ON "inventory_movements"("user_id", "created_at");
CREATE INDEX "inventory_movements_item_id_idx" ON "inventory_movements"("item_id");
CREATE INDEX "inventory_movements_reason_idx" ON "inventory_movements"("reason");
CREATE INDEX "marketplace_listings_status_expires_at_idx" ON "marketplace_listings"("status", "expires_at");
CREATE INDEX "marketplace_listings_seller_id_status_idx" ON "marketplace_listings"("seller_id", "status");
CREATE INDEX "marketplace_listings_item_id_idx" ON "marketplace_listings"("item_id");
CREATE UNIQUE INDEX "marketplace_orders_buyer_id_purchase_key_key" ON "marketplace_orders"("buyer_id", "purchase_key");
CREATE INDEX "marketplace_orders_listing_id_idx" ON "marketplace_orders"("listing_id");
CREATE INDEX "marketplace_orders_seller_id_created_at_idx" ON "marketplace_orders"("seller_id", "created_at");
CREATE INDEX "marketplace_orders_buyer_id_created_at_idx" ON "marketplace_orders"("buyer_id", "created_at");

-- AddForeignKey
ALTER TABLE "marketplace_orders" ADD CONSTRAINT "marketplace_orders_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "store_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
