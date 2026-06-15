-- Add CHANNEL_MENTION to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CHANNEL_MENTION';

-- Add message_id to reports table (for chat message reports)
ALTER TABLE "reports" ADD COLUMN "message_id" TEXT;

-- Add unique index for message_id on reports
CREATE UNIQUE INDEX "reports_message_id_key" ON "reports"("message_id");

-- Add foreign key from reports to channel_messages
ALTER TABLE "reports" ADD CONSTRAINT "reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "channel_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create channel_message_mentions table (for @mention tracking)
CREATE TABLE "channel_message_mentions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_message_mentions_pkey" PRIMARY KEY ("id")
);

-- Unique index to prevent duplicate mentions per message
CREATE UNIQUE INDEX "channel_message_mentions_message_id_user_id_key" ON "channel_message_mentions"("message_id", "user_id");

-- Index for fast lookup of mentions by user
CREATE INDEX "channel_message_mentions_user_id_created_at_idx" ON "channel_message_mentions"("user_id", "created_at");

-- Foreign keys for channel_message_mentions
ALTER TABLE "channel_message_mentions" ADD CONSTRAINT "channel_message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "channel_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_message_mentions" ADD CONSTRAINT "channel_message_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
