-- Draft-snapshot columns: admins edit draft_* fields; only an explicit
-- publish promotes them into the public columns.
ALTER TABLE "blog_posts"
  ADD COLUMN "draft_title" TEXT,
  ADD COLUMN "draft_excerpt" TEXT,
  ADD COLUMN "draft_body" TEXT,
  ADD COLUMN "draft_cover_image_url" TEXT,
  ADD COLUMN "draft_cover_image_alt" TEXT,
  ADD COLUMN "draft_author_name" TEXT,
  ADD COLUMN "draft_seo_title" TEXT,
  ADD COLUMN "draft_seo_description" TEXT,
  ADD COLUMN "draft_og_image_url" TEXT,
  ADD COLUMN "content_modified_at" TIMESTAMP(3);

-- Existing rows become their own first draft so the editor loads the
-- current content; contentModifiedAt starts at the publish time.
UPDATE "blog_posts" SET
  "draft_title" = "title",
  "draft_excerpt" = "excerpt",
  "draft_body" = "body",
  "draft_cover_image_url" = "cover_image_url",
  "draft_cover_image_alt" = "cover_image_alt",
  "draft_author_name" = "author_name",
  "draft_seo_title" = "seo_title",
  "draft_seo_description" = "seo_description",
  "draft_og_image_url" = "og_image_url",
  "content_modified_at" = COALESCE("published_at", "updated_at");

-- Per-slug seed markers for crash-recoverable imports.
CREATE TABLE "blog_seed_markers" (
  "slug" TEXT NOT NULL,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blog_seed_markers_pkey" PRIMARY KEY ("slug")
);

-- Posts that already exist are treated as imported so a redeploy never
-- resurrects one an admin intentionally deleted.
INSERT INTO "blog_seed_markers" ("slug")
SELECT "slug" FROM "blog_posts";
