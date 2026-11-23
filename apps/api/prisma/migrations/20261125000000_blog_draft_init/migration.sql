-- Explicit draft initialization: once set, null in an optional draft
-- column means "cleared" instead of "fall back to the published value".
ALTER TABLE "blog_posts"
  ADD COLUMN "draft_initialized_at" TIMESTAMP(3);

-- The previous migration populated draft columns from the published
-- row for every existing post, so every current draft is real and is
-- marked initialized. Only rows predating the snapshot feature would
-- stay uninitialized, where the fallback semantics still apply.
UPDATE "blog_posts" SET "draft_initialized_at" = "updated_at";
