-- Fix: Remove @unique constraint from forum_replies.parent_reply_id
-- A parent reply must be able to have multiple child replies for threading to work.
DROP INDEX IF EXISTS "forum_replies_parent_reply_id_key";
