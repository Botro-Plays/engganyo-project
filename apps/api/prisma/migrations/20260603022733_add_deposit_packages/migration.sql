-- AlterTable
ALTER TABLE "deposits" ADD COLUMN     "bonus_credits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "package_id" TEXT,
ADD COLUMN     "user_wallet_address" TEXT;

-- CreateTable
CREATE TABLE "deposit_packages" (
    "id" TEXT NOT NULL,
    "usd_amount" DOUBLE PRECISION NOT NULL,
    "bonus_credits" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deposits_package_id_idx" ON "deposits"("package_id");

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "deposit_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
