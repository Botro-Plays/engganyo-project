-- Social identity uniqueness + 24h unlink reservation
--
-- 1) Partial unique index: a VERIFIED social identity (platform + stable
--    platform user id) may be linked by at most one Engganyo user.
--    Unverified manual declarations are intentionally excluded — they
--    never reserve an identity.
--    NOTE: Prisma schema cannot express partial indexes; this index is
--    maintained here only. Do not drop it via `migrate dev` drift.
CREATE UNIQUE INDEX "social_accounts_verified_platform_identity_key"
  ON "social_accounts" ("platform", "platform_user_id")
  WHERE "is_verified" = true;

-- 2) Reservation table for released verified identities (24h cooldown).
CREATE TABLE "social_identity_reservations" (
    "id" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "identity_key" TEXT NOT NULL,
    "released_by_user_id" TEXT NOT NULL,
    "reserved_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_identity_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_identity_reservations_platform_identity_key"
  ON "social_identity_reservations" ("platform", "identity_key");

CREATE INDEX "social_identity_reservations_reserved_until_idx"
  ON "social_identity_reservations" ("reserved_until");
