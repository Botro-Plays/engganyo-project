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
git pull origin main

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

# Run database seed only if no users exist yet
log "Checking if database needs seeding..."
USER_COUNT=$(docker-compose exec -T api npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "0")
if [ "$USER_COUNT" -eq 0 ]; then
  log "Running database seed..."
  docker-compose exec -T api npx prisma db seed || log "Seed failed (may be non-critical)"
else
  log "Database already has users, skipping seed"
fi

log "Auto-deploy completed successfully!"
