#!/usr/bin/env bash
# Called by GitHub Actions after checking out the commit that passed all checks.
set -euo pipefail

cd /opt/engganyo-project
: "${DEPLOY_SHA:?DEPLOY_SHA is required}"
: "${GHCR_TOKEN:?GHCR_TOKEN is required}"
: "${GITHUB_ACTOR:?GITHUB_ACTOR is required}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA'; exit 1; }
[[ "$(git rev-parse HEAD)" == "$DEPLOY_SHA" ]] || { echo 'Checkout does not match release'; exit 1; }

# Also serializes manual invocations on this server.
exec 9>.deploy.lock
flock -n 9 || { echo 'Another deployment is running'; exit 1; }

for required_file in .env infra/nginx/ssl/cert.pem infra/nginx/ssl/key.pem infra/nginx/ssl/origin-pull-ca.pem; do
  test -s "$required_file" || { echo "Missing VPS setup file: $required_file"; exit 1; }
done

export API_IMAGE="ghcr.io/botro-plays/engganyo-project/api:$DEPLOY_SHA"
export WEB_IMAGE="ghcr.io/botro-plays/engganyo-project/web:$DEPLOY_SHA"

# Use a temporary registry credential directory; never persist the Actions token.
DOCKER_CONFIG=$(mktemp -d)
export DOCKER_CONFIG
trap 'rm -rf -- "$DOCKER_CONFIG"' EXIT

docker info >/dev/null
docker compose config --quiet
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
docker compose pull api web

# Start infrastructure on a freshly prepared host as well as on later updates.
docker compose up -d --wait --wait-timeout 120 postgres redis

# The API entrypoint applies migrations before serving traffic. A failure or
# degraded API response causes the health check / deploy to fail.
docker compose up -d --no-build --wait --wait-timeout 240 api web
docker compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 90 nginx
docker compose exec -T nginx nginx -t

# Retain the selected tags for subsequent compose restarts. --env-file .env
# --env-file .release.env can be used by an operator without printing secrets.
printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' "$API_IMAGE" "$WEB_IMAGE" > .release.env
printf '%s\n' "$DEPLOY_SHA" > .deployed-sha
echo "Deployment healthy: $DEPLOY_SHA"
