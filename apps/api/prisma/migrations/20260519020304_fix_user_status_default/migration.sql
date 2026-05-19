-- AlterTable
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- Data migration: Mark all existing PENDING_VERIFICATION users as ACTIVE
-- This ensures existing users are not locked out when email verification is enabled
UPDATE "users" SET "status" = 'ACTIVE' WHERE "status" = 'PENDING_VERIFICATION';
