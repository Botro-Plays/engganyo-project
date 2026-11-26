-- Telegram Phase 1 hardening: per-claim fencing token + immutable command
-- input persisted at ingest so recovery never depends on redelivery.
ALTER TABLE "telegram_update_inbox"
  ADD COLUMN "claim_token" TEXT,
  ADD COLUMN "command_args" TEXT,
  ADD COLUMN "telegram_user_id" BIGINT,
  ADD COLUMN "telegram_username" TEXT,
  ADD COLUMN "telegram_first_name" TEXT;
