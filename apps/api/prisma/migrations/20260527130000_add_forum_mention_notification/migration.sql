-- Add FORUM_MENTION value to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FORUM_MENTION';
