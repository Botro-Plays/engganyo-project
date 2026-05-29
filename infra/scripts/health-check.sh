#!/bin/bash
# Engganyo Health Check & Auto-Recovery Script
# Run this via cron every minute for automatic recovery from outages.
#
# Setup:
#   sudo crontab -e
#   * * * * * /opt/engganyo-project/infra/scripts/health-check.sh >> /opt/engganyo-project/infra/scripts/health-check.log 2>&1

set -e

PROJECT_DIR="/opt/engganyo-project"
LOG_FILE="/opt/engganyo-project/infra/scripts/health-check.log"
HEALTH_URL="http://localhost:3001/api/health"
NGINX_URL="https://localhost/"

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

log() {
    echo "[$(timestamp)] $1" | tee -a "$LOG_FILE"
}

# Check API health
check_api() {
    curl -sf --max-time 10 "$HEALTH_URL" > /dev/null 2>&1
}

# Check nginx (TLS + HTTP response)
check_nginx() {
    curl -sf --max-time 10 -k "$NGINX_URL" > /dev/null 2>&1
}

# Check if host nginx is interfering
check_host_nginx() {
    sudo ss -tlnp | grep ':80 ' | grep -qv 'docker-proxy' || true
}

# Main recovery logic
recover() {
    log "RECOVERY: Attempting to restore services..."
    cd "$PROJECT_DIR" || exit 1

    # Kill any rogue host-level nginx
    if check_host_nginx; then
        log "RECOVERY: Host nginx detected on port 80, stopping..."
        sudo systemctl stop nginx 2>/dev/null || true
        sudo systemctl disable nginx 2>/dev/null || true
        sudo pkill -f "nginx: master" 2>/dev/null || true
    fi

    # Restart nginx container first (most common fix)
    if docker ps | grep -q engganyo_nginx; then
        log "RECOVERY: Restarting nginx container..."
        docker compose restart nginx
        sleep 3
        if check_nginx; then
            log "RECOVERY: Nginx restart succeeded."
            return 0
        fi
    fi

    # Full stack restart if nginx restart didn't work
    log "RECOVERY: Full stack restart required..."
    docker compose down
    docker network rm engganyo_network 2>/dev/null || true
    docker compose up -d
    sleep 10

    if check_nginx && check_api; then
        log "RECOVERY: Full stack restart succeeded."
    else
        log "RECOVERY: CRITICAL — Full stack restart FAILED. Manual intervention required."
    fi
}

# Rotate log if too large
if [ -f "$LOG_FILE" ] && [ $(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt 10485760 ]; then
    mv "$LOG_FILE" "$LOG_FILE.old"
    touch "$LOG_FILE"
fi

# Run checks
API_OK=false
NGINX_OK=false

if check_api; then
    API_OK=true
fi

if check_nginx; then
    NGINX_OK=true
fi

if [ "$API_OK" = true ] && [ "$NGINX_OK" = true ]; then
    # All good — log only once per hour to avoid noise
    if [ "$(date +%M)" = "00" ]; then
        log "OK: API and nginx healthy."
    fi
    exit 0
fi

if [ "$API_OK" = false ]; then
    log "ALERT: API health check FAILED ($HEALTH_URL)"
fi

if [ "$NGINX_OK" = false ]; then
    log "ALERT: Nginx health check FAILED ($NGINX_URL)"
fi

recover
