ALTER TABLE "deposit_packages" ADD COLUMN "methods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
