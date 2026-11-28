-- Reverse admin bridge for the Telegram moderation bot. Results are
-- sanitized application data only; secret material never belongs in rows.
CREATE TABLE "telegram_bot_admin_commands" (
    "id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "params" JSONB,
    "result" JSONB,
    "error" TEXT,
    "admin_user_id" TEXT,
    "bot_username" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "worker_id" TEXT,
    "claim_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "telegram_bot_admin_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_bot_admin_commands_request_key_key" ON "telegram_bot_admin_commands"("request_key");
CREATE INDEX "telegram_bot_admin_commands_status_lease_until_idx" ON "telegram_bot_admin_commands"("status", "lease_until");
CREATE INDEX "telegram_bot_admin_commands_admin_user_id_created_at_idx" ON "telegram_bot_admin_commands"("admin_user_id", "created_at");
CREATE INDEX "telegram_bot_admin_commands_type_created_at_idx" ON "telegram_bot_admin_commands"("type", "created_at");

ALTER TABLE "telegram_bot_admin_commands"
    ADD CONSTRAINT "telegram_bot_admin_commands_admin_user_id_fkey"
    FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
