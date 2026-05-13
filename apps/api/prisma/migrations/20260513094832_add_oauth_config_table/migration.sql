-- CreateTable
CREATE TABLE "oauth_configs" (
    "platform" "SocialPlatform" NOT NULL,
    "client_id" TEXT,
    "client_secret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "oauth_configs_pkey" PRIMARY KEY ("platform")
);
