#!/bin/bash
# Auto-deploy script for Engganyo project (manual fallback)
#
# Normal deploys are handled automatically by .github/workflows/deploy.yml
# (GitHub Actions builds images → pushes to GHCR → SSHes here to pull & restart).
#
# Use this script only for manual deploys when GitHub Actions is unavailable:
#   sudo systemctl start auto-deploy
#
# Prerequisites in /opt/engganyo-project/.env:
#   GHCR_TOKEN=<GitHub PAT with read:packages scope>
#   GHCR_USER=<your GitHub username>

set -e

PROJECT_DIR="/opt/engganyo-project"
LOG_FILE="/opt/engganyo-project/auto-deploy.log"
API_IMAGE="ghcr.io/botro-plays/engganyo-project/api:latest"
WEB_IMAGE="ghcr.io/botro-plays/engganyo-project/web:latest"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting manual deploy..."

cd "$PROJECT_DIR" || exit 1

# Sync config files (nginx.conf, docker-compose.yml, .env additions, etc.)
log "Pulling latest config from git..."
git pull origin main

# Authenticate to GHCR using token from .env
if [ -f ".env" ]; then
    set -a; source .env; set +a
fi

if [ -n "$GHCR_TOKEN" ] && [ -n "$GHCR_USER" ]; then
    log "Authenticating to GHCR..."
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
else
    log "WARNING: GHCR_TOKEN or GHCR_USER not set in .env — image pull may fail for private packages"
fi

# Pull pre-built images from GHCR (no building on VPS)
log "Pulling pre-built images from GHCR..."
docker pull "$API_IMAGE"
docker pull "$WEB_IMAGE"

# Stop and remove old containers to avoid name conflicts
log "Stopping and removing old containers..."
docker compose down

# Start containers using pulled images
log "Starting containers..."
docker compose up -d

# Wait for API to be ready
log "Waiting for containers to be healthy..."
sleep 10

# Run Prisma migrations
log "Running Prisma migrations..."
docker compose exec -T api npx prisma migrate deploy

# Seed database on first-ever deploy only
SEED_SENTINEL="/opt/engganyo-project/.seeded"
if [ ! -f "$SEED_SENTINEL" ]; then
    log "Running database seed (first deploy)..."
    if docker compose exec -T api npx prisma db seed; then
        touch "$SEED_SENTINEL"
        log "Seed completed successfully"
    else
        log "Seed failed — run manually: docker compose exec api npx prisma db seed"
    fi
else
    log "Seed already ran, skipping"
fi

log "Deploy completed successfully!"
