#!/bin/sh
set -e

# Fix ownership of directories that may be mounted as Docker volumes (root-owned)
# so the non-root app user can read/write them.
chown -R nestjs:nodejs ./uploads 2>/dev/null || true
chown -R nestjs:nodejs ./logs    2>/dev/null || true

# Apply pending migrations before starting the app
su-exec nestjs:nodejs npx --no-install prisma migrate deploy

# Drop to non-root user and run the app
exec su-exec nestjs:nodejs dumb-init -- node dist/main
