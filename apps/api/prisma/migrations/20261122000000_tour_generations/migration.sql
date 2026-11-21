-- Replay-generation fencing for tour state: one row per (user, tour)
-- acts as both the write mutex (locked inside every mutating tour
-- transaction so writers serialize) and the replay-generation counter
-- (incremented on each reset; stale-generation writes are rejected).

CREATE TABLE "tour_generations" (
    "user_id" TEXT NOT NULL,
    "tour_key" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "last_reset_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_generations_pkey" PRIMARY KEY ("user_id", "tour_key")
);

ALTER TABLE "tour_generations"
    ADD CONSTRAINT "tour_generations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
