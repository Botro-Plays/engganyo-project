-- Telegram integration Phase 1: link challenges, link history, durable update inbox
--
-- Active-link uniqueness is expressed through partial unique indexes
-- (Prisma schema cannot express partial indexes; maintained here only,
-- same convention as social_accounts_verified_platform_identity_key).

CREATE TYPE "TelegramLinkChallengeStatus" AS ENUM ('PENDING', 'CLAIMED', 'CONFIRMED', 'DECLINED', 'EXPIRED');
CREATE TYPE "TelegramUpdateInboxStatus" AS ENUM ('PENDING', 'CLAIMED', 'DONE', 'DEAD');

CREATE TABLE "telegram_link_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "TelegramLinkChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "telegram_user_id" BIGINT,
    "telegram_username" TEXT,
    "telegram_first_name" TEXT,
    "claimed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_link_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_link_challenges_code_key" ON "telegram_link_challenges"("code");
CREATE INDEX "telegram_link_challenges_user_id_status_idx" ON "telegram_link_challenges"("user_id", "status");

ALTER TABLE "telegram_link_challenges"
    ADD CONSTRAINT "telegram_link_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "telegram_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "telegram_username" TEXT,
    "telegram_first_name" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- One active link per Telegram identity and per Engganyo user; history is
-- retained separately so re-linking after unlink is never blocked by it.
CREATE UNIQUE INDEX "telegram_links_active_telegram_user"
  ON "telegram_links" ("telegram_user_id")
  WHERE "unlinked_at" IS NULL;
CREATE UNIQUE INDEX "telegram_links_active_user"
  ON "telegram_links" ("user_id")
  WHERE "unlinked_at" IS NULL;
CREATE INDEX "telegram_links_user_id_idx" ON "telegram_links"("user_id");
CREATE INDEX "telegram_links_telegram_user_id_idx" ON "telegram_links"("telegram_user_id");

ALTER TABLE "telegram_links"
    ADD CONSTRAINT "telegram_links_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "telegram_update_inbox" (
    "id" TEXT NOT NULL,
    "bot_username" TEXT NOT NULL,
    "update_id" BIGINT NOT NULL,
    "status" "TelegramUpdateInboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "worker_id" TEXT,
    "lease_until" TIMESTAMP(3),
    "last_error" TEXT,
    "chat_id" BIGINT,
    "command" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_update_inbox_pkey" PRIMARY KEY ("id")
);

-- Unique per-bot update identity: a redelivered update always maps to the
-- same inbox row, so duplicates are claimed or replayed - never re-run.
CREATE UNIQUE INDEX "telegram_update_inbox_bot_username_update_id_key"
  ON "telegram_update_inbox" ("bot_username", "update_id");
CREATE INDEX "telegram_update_inbox_status_lease_until_idx"
  ON "telegram_update_inbox" ("status", "lease_until");
