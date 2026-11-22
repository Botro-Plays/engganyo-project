#!/bin/sh
set -e

# Fix ownership of directories that may be mounted as Docker volumes (root-owned)
# so the non-root app user can read/write them.
chown -R nestjs:nodejs ./uploads 2>/dev/null || true
chown -R nestjs:nodejs ./logs    2>/dev/null || true

# Apply pending migrations before starting the app
su-exec nestjs:nodejs npx --no-install prisma migrate deploy

# First-boot blog import: seeds the canonical posts only when the
# blog_posts table is empty, so admin edits and deletions survive
# redeploys. A failure must not block the API from starting - the blog
# would render empty and the next deploy retries the import.
su-exec nestjs:nodejs npx --no-install ts-node --project tsconfig.seed.json prisma/seed-blog.ts || \
  echo "warning: blog seed failed; continuing without it"

# Drop to non-root user and run the app
exec su-exec nestjs:nodejs dumb-init -- node dist/main
