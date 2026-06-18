-- Add streak_freeze_charges to users table
ALTER TABLE "users" ADD COLUMN "streak_freeze_charges" INTEGER NOT NULL DEFAULT 0;

-- Create user_active_effects table for persistent time-limited boosts
CREATE TABLE "user_active_effects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_active_effects_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "user_active_effects_user_id_idx" ON "user_active_effects"("user_id");
CREATE INDEX "user_active_effects_expires_at_idx" ON "user_active_effects"("expires_at");
CREATE INDEX "user_active_effects_user_id_type_idx" ON "user_active_effects"("user_id", "type");

-- Add foreign key
ALTER TABLE "user_active_effects" ADD CONSTRAINT "user_active_effects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
