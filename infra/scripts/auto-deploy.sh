#!/bin/bash
# Auto-deploy script for Engganyo project
# This script pulls the latest changes from git and rebuilds Docker containers

set -e

PROJECT_DIR="/opt/engganyo-project"
LOG_FILE="/var/log/engganyo-auto-deploy.log"

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

# Run database seed if needed
log "Running database seed..."
docker-compose exec -T api npx prisma db seed

log "Auto-deploy completed successfully!"
