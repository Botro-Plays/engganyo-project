-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('OPEN', 'NEGOTIATING', 'AGREED', 'IN_PROGRESS', 'SUBMITTED', 'DISPUTED', 'COMPLETED', 'CLOSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RoomOfferStatus" AS ENUM ('PROPOSED', 'APPROVED', 'LOCKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RoomSubmissionStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "RoomRole" AS ENUM ('CREATOR', 'CLAIMER');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'SPEND_ROOM_CREATE';
ALTER TYPE "TransactionType" ADD VALUE 'SPEND_ROOM_CLAIM';
ALTER TYPE "TransactionType" ADD VALUE 'REFUND_ROOM_CLOSE';
ALTER TYPE "TransactionType" ADD VALUE 'REFUND_ROOM_RESOLUTION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ROOM_NUDGE';
ALTER TYPE "NotificationType" ADD VALUE 'ROOM_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'FRIEND_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'FRIEND_ACCEPTED';

-- AlterTable
ALTER TABLE "platform_revenue" ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "room_id" TEXT;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "rating_id" TEXT,
ADD COLUMN     "room_id" TEXT;

-- CreateTable
CREATE TABLE "challenge_rooms" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "claimer_id" TEXT,
    "contribution_credits" INTEGER NOT NULL,
    "room_charge" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "visibility" "ChallengeVisibility" NOT NULL DEFAULT 'PUBLIC',
    "password_hash" TEXT,
    "status" "RoomStatus" NOT NULL DEFAULT 'OPEN',
    "channel_id" TEXT,
    "creator_approval" JSONB,
    "claimer_approval" JSONB,
    "claim_expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "creator_tx_id" TEXT,
    "claimer_tx_id" TEXT,
    "charge_collected_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "close_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenge_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_offers" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "proposer_id" TEXT NOT NULL,
    "proposer_role" "RoomRole" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "action_text" TEXT NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "target_url" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "requires_proof" BOOLEAN NOT NULL DEFAULT true,
    "proof_instructions" TEXT,
    "status" "RoomOfferStatus" NOT NULL DEFAULT 'PROPOSED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_submissions" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "submitted_by_id" TEXT NOT NULL,
    "proof_url" TEXT,
    "proof_hash" TEXT,
    "note" TEXT,
    "status" "RoomSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_participations" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "RoomRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "room_participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_nudges" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "ping_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_ratings" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "rater_id" TEXT NOT NULL,
    "ratee_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "review" TEXT,
    "hidden_at" TIMESTAMP(3),
    "hidden_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_disputes" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "opened_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "p2p_point_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "role" "RoomRole" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "p2p_point_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "addressee_id" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "challenge_rooms_channel_id_key" ON "challenge_rooms"("channel_id");

-- CreateIndex
CREATE INDEX "challenge_rooms_status_visibility_created_at_idx" ON "challenge_rooms"("status", "visibility", "created_at");

-- CreateIndex
CREATE INDEX "challenge_rooms_creator_id_idx" ON "challenge_rooms"("creator_id");

-- CreateIndex
CREATE INDEX "challenge_rooms_claimer_id_idx" ON "challenge_rooms"("claimer_id");

-- CreateIndex
CREATE INDEX "challenge_rooms_expires_at_idx" ON "challenge_rooms"("expires_at");

-- CreateIndex
CREATE INDEX "room_offers_room_id_status_idx" ON "room_offers"("room_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "room_offers_room_id_proposer_role_key" ON "room_offers"("room_id", "proposer_role");

-- CreateIndex
CREATE INDEX "room_submissions_room_id_status_idx" ON "room_submissions"("room_id", "status");

-- CreateIndex
CREATE INDEX "room_submissions_offer_id_status_idx" ON "room_submissions"("offer_id", "status");

-- CreateIndex
CREATE INDEX "room_participations_user_id_released_at_idx" ON "room_participations"("user_id", "released_at");

-- CreateIndex
CREATE INDEX "room_participations_room_id_idx" ON "room_participations"("room_id");

-- CreateIndex
CREATE INDEX "room_nudges_room_id_created_at_idx" ON "room_nudges"("room_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "room_nudges_room_id_ping_id_key" ON "room_nudges"("room_id", "ping_id");

-- CreateIndex
CREATE INDEX "room_ratings_ratee_id_hidden_at_idx" ON "room_ratings"("ratee_id", "hidden_at");

-- CreateIndex
CREATE UNIQUE INDEX "room_ratings_room_id_rater_id_key" ON "room_ratings"("room_id", "rater_id");

-- CreateIndex
CREATE INDEX "room_disputes_status_created_at_idx" ON "room_disputes"("status", "created_at");

-- CreateIndex
CREATE INDEX "room_disputes_room_id_idx" ON "room_disputes"("room_id");

-- CreateIndex
CREATE INDEX "p2p_point_events_user_id_reversed_at_idx" ON "p2p_point_events"("user_id", "reversed_at");

-- CreateIndex
CREATE UNIQUE INDEX "p2p_point_events_user_id_room_id_key" ON "p2p_point_events"("user_id", "room_id");

-- CreateIndex
CREATE INDEX "friendships_addressee_id_status_idx" ON "friendships"("addressee_id", "status");

-- CreateIndex
CREATE INDEX "friendships_requester_id_status_idx" ON "friendships"("requester_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "friendships_requester_id_addressee_id_key" ON "friendships"("requester_id", "addressee_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_revenue_room_id_key" ON "platform_revenue"("room_id");

-- AddForeignKey
ALTER TABLE "platform_revenue" ADD CONSTRAINT "platform_revenue_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "challenge_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "challenge_rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_rooms" ADD CONSTRAINT "challenge_rooms_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_rooms" ADD CONSTRAINT "challenge_rooms_claimer_id_fkey" FOREIGN KEY ("claimer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_rooms" ADD CONSTRAINT "challenge_rooms_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_offers" ADD CONSTRAINT "room_offers_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "challenge_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_offers" ADD CONSTRAINT "room_offers_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_submissions" ADD CONSTRAINT "room_submissions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "challenge_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_submissions" ADD CONSTRAINT "room_submissions_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "room_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_submissions" ADD CONSTRAINT "room_submissions_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_participations" ADD CONSTRAINT "room_participations_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "challenge_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_participations" ADD CONSTRAINT "room_participations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_nudges" ADD CONSTRAINT "room_nudges_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "challenge_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_nudges" ADD CONSTRAINT "room_nudges_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_ratings" ADD CONSTRAINT "room_ratings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "challenge_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_ratings" ADD CONSTRAINT "room_ratings_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_ratings" ADD CONSTRAINT "room_ratings_ratee_id_fkey" FOREIGN KEY ("ratee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_disputes" ADD CONSTRAINT "room_disputes_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "challenge_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_disputes" ADD CONSTRAINT "room_disputes_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "p2p_point_events" ADD CONSTRAINT "p2p_point_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "p2p_point_events" ADD CONSTRAINT "p2p_point_events_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "challenge_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One active (non-terminal) room per user across both roles.
-- Partial unique index: at most one participation row with released_at NULL.
CREATE UNIQUE INDEX "room_participations_one_active_per_user"
  ON "room_participations" ("user_id")
  WHERE "released_at" IS NULL;
