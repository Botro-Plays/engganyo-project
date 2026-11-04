ALTER TABLE "deposits" ADD COLUMN "provider_fee" DOUBLE PRECISION,
ADD COLUMN "provider_fee_currency" TEXT,
ADD COLUMN "provider_net" DOUBLE PRECISION,
ADD COLUMN "provider_net_currency" TEXT,
ADD COLUMN "provider_converted" DOUBLE PRECISION,
ADD COLUMN "provider_converted_cur" TEXT;
