/*
  Warnings:

  - A unique constraint covering the columns `[topic_id]` on the table `reports` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[reply_id]` on the table `reports` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ForumTopicStatus" AS ENUM ('OPEN', 'LOCKED', 'PINNED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ForumReactionType" AS ENUM ('LIKE', 'DISLIKE', 'LOVE', 'LAUGH', 'ANGRY');

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "reply_id" TEXT,
ADD COLUMN     "topic_id" TEXT;

-- CreateTable
CREATE TABLE "forum_topics" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ForumTopicStatus" NOT NULL DEFAULT 'OPEN',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_replies" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "edited_at" TIMESTAMP(3),
    "topic_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "parent_reply_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_reactions" (
    "id" TEXT NOT NULL,
    "type" "ForumReactionType" NOT NULL,
    "topic_id" TEXT,
    "reply_id" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forum_topics_author_id_idx" ON "forum_topics"("author_id");

-- CreateIndex
CREATE INDEX "forum_topics_status_idx" ON "forum_topics"("status");

-- CreateIndex
CREATE INDEX "forum_topics_is_pinned_idx" ON "forum_topics"("is_pinned");

-- CreateIndex
CREATE INDEX "forum_topics_created_at_idx" ON "forum_topics"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "forum_replies_parent_reply_id_key" ON "forum_replies"("parent_reply_id");

-- CreateIndex
CREATE INDEX "forum_replies_topic_id_idx" ON "forum_replies"("topic_id");

-- CreateIndex
CREATE INDEX "forum_replies_author_id_idx" ON "forum_replies"("author_id");

-- CreateIndex
CREATE INDEX "forum_replies_parent_reply_id_idx" ON "forum_replies"("parent_reply_id");

-- CreateIndex
CREATE INDEX "forum_replies_created_at_idx" ON "forum_replies"("created_at");

-- CreateIndex
CREATE INDEX "forum_reactions_user_id_idx" ON "forum_reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_reactions_topic_id_user_id_key" ON "forum_reactions"("topic_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_reactions_reply_id_user_id_key" ON "forum_reactions"("reply_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_topic_id_key" ON "reports"("topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reply_id_key" ON "reports"("reply_id");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "forum_replies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_parent_reply_id_fkey" FOREIGN KEY ("parent_reply_id") REFERENCES "forum_replies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_reactions" ADD CONSTRAINT "forum_reactions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_reactions" ADD CONSTRAINT "forum_reactions_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "forum_replies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_reactions" ADD CONSTRAINT "forum_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
