#!/bin/bash
# Auto-deploy script for Engganyo project
# This script pulls the latest changes from git and rebuilds Docker containers

set -e

PROJECT_DIR="/opt/engganyo-project"
LOG_FILE="/opt/engganyo-project/auto-deploy.log"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting auto-deploy..."

# Change to project directory
cd "$PROJECT_DIR" || exit 1

# Pull latest changes from git
log "Pulling latest changes from git..."
# Reset local branch to origin/main to handle any divergence from force pushes
git fetch origin main
git reset --hard origin/main

# Stop existing containers
log "Stopping Docker containers..."
docker-compose down

# Rebuild and start containers
log "Rebuilding and starting Docker containers..."
docker-compose up -d --build

# Wait for containers to be healthy
log "Waiting for containers to be healthy..."
sleep 10

# Run Prisma migrations
log "Running Prisma migrations..."
docker-compose exec -T api npx prisma migrate deploy

# Run database seed only on first deploy (tracked by a local sentinel file)
SEED_SENTINEL="/opt/engganyo-project/.seeded"
if [ ! -f "$SEED_SENTINEL" ]; then
  log "Running database seed (first deploy)..."
  if docker-compose exec -T api npx prisma db seed; then
    touch "$SEED_SENTINEL"
    log "Seed completed successfully"
  else
    log "Seed failed — check logs. Re-run manually: docker-compose exec api npx prisma db seed"
  fi
else
  log "Seed already ran, skipping"
fi

log "Auto-deploy completed successfully!"
