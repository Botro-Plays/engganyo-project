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

for required_file in .env infra/nginx/ssl/cert.pem infra/nginx/ssl/key.pem infra/nginx/ssl/aop-root-ca.pem; do
  test -s "$required_file" || { echo "Missing VPS setup file: $required_file"; exit 1; }
done

# ─── Release image storage management ─────────────────────────────
# Incident 2026-10: ~71 accumulated release images filled the 25GB VPS disk
# mid-deploy. This section makes storage a first-class deploy gate:
#
#  - Preflight: refuse to pull when free space is below MIN_FREE_KB —
#    after one safe prune pass — and fail BEFORE any release metadata is
#    written. A full disk can therefore never report a successful deploy.
#  - Retention: only ghcr release tags for THIS repo are ever removed.
#    Protected = images referenced by any container (running or stopped)
#    + the current DEPLOY_SHA + the last KEEP_RELEASES entries of
#    .release-history (the rollback set). Base images (postgres, redis,
#    nginx), containers, volumes, database data, uploads, and backups are
#    never touched — `docker image prune -f` removes dangling layers only.
#  - Recording: every prune run appends to .deploy-storage.log and stdout
#    (captured by the Actions log).
KEEP_RELEASES="${DEPLOY_KEEP_RELEASES:-2}"
MIN_FREE_KB="${DEPLOY_DISK_MIN_FREE_KB:-4194304}"   # 4 GiB — ~2 release pairs fit with margin
RELEASE_IMAGE_RE='^ghcr\.io/botro-plays/engganyo-project/(api|web):[0-9a-f]{40}$'
HISTORY_FILE=.release-history
STORAGE_LOG=.deploy-storage.log

# Seed the rollback history from the live sentinel on the first run of this
# script version, so the currently deployed release is never pruned.
if [ ! -s "$HISTORY_FILE" ] && [ -s .deployed-sha ]; then
  cp .deployed-sha "$HISTORY_FILE"
fi

docker_fs_free_kb() {
  df -Pk /var/lib/docker | awk 'NR==2 {print $4}'
}

# SHAs that must never be pruned: every image reference held by a container
# (compose may reference by tag or resolved ID — inspect covers both), plus
# the rollback history, plus the SHA being deployed.
protected_shas() {
  {
    docker ps -aq | xargs -r docker inspect --format '{{.Config.Image}}' 2>/dev/null \
      | grep -oE '[0-9a-f]{40}$' || true
    tail -n "$KEEP_RELEASES" "$HISTORY_FILE" 2>/dev/null || true
    printf '%s\n' "$DEPLOY_SHA"
  } | grep -E '^[0-9a-f]{40}$' | sort -u
}

# Remove only unprotected engganyo release tags + dangling layers.
# Per-image failures are warnings — a stuck image must not fail a healthy
# deploy — but the docker daemon itself failing propagates via set -e.
prune_release_images() {
  local keep ref sha sz_kb removed=0 freed_kb=0
  keep=$(protected_shas)
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    sha="${ref##*:}"
    if printf '%s\n' "$keep" | grep -qx "$sha"; then
      continue
    fi
    sz_kb=$(docker image inspect "$ref" --format '{{.Size}}' 2>/dev/null | awk '{printf "%d", $1/1024}')
    if docker rmi "$ref" >/dev/null 2>&1; then
      echo "storage: pruned $ref (~${sz_kb}KB)"
      removed=$((removed + 1))
      freed_kb=$((freed_kb + ${sz_kb:-0}))
    else
      echo "storage: WARN could not prune $ref" >&2
    fi
  done < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "$RELEASE_IMAGE_RE" || true)
  docker image prune -f >/dev/null 2>&1 || true
  echo "storage: pruned ${removed} release images, freed ~${freed_kb}KB; ${KEEP_RELEASES} rollback releases retained"
}

storage_preflight() {
  local free_kb
  free_kb=$(docker_fs_free_kb)
  echo "storage preflight: ${free_kb}KB free on docker fs (minimum ${MIN_FREE_KB}KB)"
  if [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
    echo "storage: below minimum — pruning unprotected release images before pull"
    prune_release_images | tee -a "$STORAGE_LOG"
    free_kb=$(docker_fs_free_kb)
    echo "storage preflight after prune: ${free_kb}KB free"
    if [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
      echo "ERROR: insufficient disk for release $DEPLOY_SHA (${free_kb}KB < ${MIN_FREE_KB}KB)." >&2
      echo "Deployment aborted BEFORE pulling images; no release metadata written." >&2
      exit 1
    fi
  fi
}

# Runs after containers are healthy, BEFORE .release.env/.deployed-sha are
# written — a storage failure here fails the deploy with metadata untouched.
record_release_and_prune() {
  # Dedup + append, keep last KEEP_RELEASES+1 SHAs (current + rollback set).
  { grep -vxF "$DEPLOY_SHA" "$HISTORY_FILE" 2>/dev/null || true; printf '%s\n' "$DEPLOY_SHA"; } \
    | tail -n "$((KEEP_RELEASES + 1))" > "$HISTORY_FILE.tmp"
  mv "$HISTORY_FILE.tmp" "$HISTORY_FILE"

  {
    echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) deploy $DEPLOY_SHA ==="
    echo "free_before_prune_kb=$(docker_fs_free_kb)"
    prune_release_images
    echo "free_after_prune_kb=$(docker_fs_free_kb)"
  } | tee -a "$STORAGE_LOG"

  local free_kb
  free_kb=$(docker_fs_free_kb)
  if [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
    echo "ERROR: deploy $DEPLOY_SHA is healthy but only ${free_kb}KB free (< ${MIN_FREE_KB}KB)." >&2
    echo "Refusing to mark release metadata successful on a nearly-full disk." >&2
    exit 1
  fi
}

storage_preflight

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
record_release_and_prune
printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' "$API_IMAGE" "$WEB_IMAGE" > .release.env
printf '%s\n' "$DEPLOY_SHA" > .deployed-sha
echo "Deployment healthy: $DEPLOY_SHA"
