-- CreateTable
CREATE TABLE "vp_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "reference_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vp_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vp_events_user_id_idx" ON "vp_events"("user_id");

-- CreateIndex
CREATE INDEX "vp_events_created_at_idx" ON "vp_events"("created_at");
