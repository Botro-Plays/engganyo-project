-- Sender-scoped idempotency keys for chat credit transfers (tip / rain).
-- The (sender_id, key) unique index serializes duplicate submissions:
-- a losing request's whole settlement transaction rolls back, then the
-- committed row is replayed (same params) or rejected 409 (mismatch).
CREATE TABLE "chat_request_keys" (
  "id"          TEXT NOT NULL,
  "sender_id"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "params_hash" TEXT NOT NULL,
  "result"      JSONB NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_request_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_request_keys_sender_id_key_key" ON "chat_request_keys"("sender_id", "key");
CREATE INDEX "chat_request_keys_sender_id_created_at_idx" ON "chat_request_keys"("sender_id", "created_at");
