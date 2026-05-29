#!/bin/sh
set -e

# Fix ownership of directories that may be mounted as Docker volumes (root-owned)
# so the non-root app user can read/write them.
chown -R nestjs:nodejs /app/uploads 2>/dev/null || true
chown -R nestjs:nodejs /app/logs    2>/dev/null || true

# Drop to non-root user and run the app
exec su-exec nestjs:nodejs dumb-init -- node dist/main
