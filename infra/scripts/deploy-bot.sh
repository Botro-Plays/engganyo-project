#!/usr/bin/env bash
# Replaces the engganyo_bot container with the release image for DEPLOY_SHA.
#
# Called by the deploy-bot job in .github/workflows/deploy.yml (envs exported
# there); also runnable manually on the VPS for a controlled rollback:
#   GHCR_TOKEN=... GITHUB_ACTOR=... DEPLOY_SHA=<40-hex> DEPLOY_BOT_FORCE=1 \
#     bash /opt/engganyo-project/infra/scripts/deploy-bot.sh
#
# Guarantees:
#   - pulls the new image BEFORE stopping the old poller
#   - exactly one update consumer for the token at all times
#   - writes DEPLOYED_SHA only after every verification passes
#   - never touches or restores guardbot.db; a failed start rolls back to the
#     previous image, never to previous data
set -euo pipefail

BOT_DIR=/home/engganyo/engganyo-bot
BOT_CONTAINER=engganyo_bot
BOT_IMAGE=ghcr.io/botro-plays/engganyo-project/telegram-bot
LOCAL_IMAGE=engganyo-bot              # legacy locally-built tag engganyo-bot:<sha7>
GIT_DIR=/opt/engganyo-project

: "${DEPLOY_SHA:?DEPLOY_SHA is required}"
: "${GHCR_TOKEN:?GHCR_TOKEN is required}"
: "${GITHUB_ACTOR:?GITHUB_ACTOR is required}"
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA'; exit 1; }
SHA7="${DEPLOY_SHA:0:7}"

# Serialize with any other bot deployment on this host.
exec 9>"$BOT_DIR/.deploy-bot.lock"
flock -n 9 || { echo 'Another bot deployment is running'; exit 1; }

fail() { echo "ERROR: $*" >&2; exit 1; }

# ─── Configuration presence (names only, never values) ────────────────────
test -s "$BOT_DIR/.env" || fail "missing $BOT_DIR/.env"
for k in BOT_TOKEN ENGGANYO_API_BASE ENGGANYO_BOT_SERVICE_KEY ENGGANYO_BOT_USERNAME; do
  grep -q "^${k}=." "$BOT_DIR/.env" || fail "required key $k missing or empty in .env"
done

# ─── Stale-run guard ──────────────────────────────────────────────────────
# A queued older run must not overwrite a newer deployment. DEPLOY_BOT_FORCE=1
# (manual dispatch with an exact approved revision) is the only override.
CURRENT="$(awk '{print $1}' "$BOT_DIR/DEPLOYED_SHA" 2>/dev/null || true)"
if [ -n "$CURRENT" ] && [ "$CURRENT" != "$DEPLOY_SHA" ] && [ "${DEPLOY_BOT_FORCE:-0}" != "1" ]; then
  git -C "$GIT_DIR" fetch -q origin main 2>/dev/null || true
  if git -C "$GIT_DIR" merge-base --is-ancestor "$DEPLOY_SHA" "$CURRENT" 2>/dev/null; then
    fail "currently deployed $CURRENT is newer than $DEPLOY_SHA; refusing stale release"
  fi
fi

printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin >/dev/null

# ─── Pull the new image BEFORE stopping the old poller ────────────────────
NEW_REF="$BOT_IMAGE:$DEPLOY_SHA"
if ! docker pull "$NEW_REF"; then
  # Pre-automation revisions only exist as VPS-local tags.
  if docker image inspect "$LOCAL_IMAGE:$SHA7" >/dev/null 2>&1; then
    NEW_REF="$LOCAL_IMAGE:$SHA7"
    echo "GHCR tag unavailable; using local image $NEW_REF"
  else
    fail "no image found for $DEPLOY_SHA"
  fi
fi

# ─── Consistent DB backup + read-only compatibility check ─────────────────
if [ -f "$BOT_DIR/data/guardbot.db" ]; then
  docker exec "$BOT_CONTAINER" python -c \
    "import sqlite3; s=sqlite3.connect('/app/data/guardbot.db'); d=sqlite3.connect('/app/data/guardbot-pre-${SHA7}.db'); s.backup(d)" \
    && echo "backup: data/guardbot-pre-${SHA7}.db" \
    || echo "WARN: pre-deploy DB backup skipped (container not running)"
  docker run --rm -v "$BOT_DIR/data:/app/data:ro" "$NEW_REF" python -c \
    "import sqlite3; c=sqlite3.connect('file:/app/data/guardbot.db?immutable=1', uri=True); r=c.execute('PRAGMA quick_check').fetchone(); assert r==('ok',), r" \
    || fail "guardbot.db failed quick_check against new image"
fi

PREV_IMAGE="$(docker inspect "$BOT_CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || true)"
echo "previous image: ${PREV_IMAGE:-none}  new image: $NEW_REF"

# ─── Controlled single-instance replacement ───────────────────────────────
docker stop "$BOT_CONTAINER" 2>/dev/null || true
docker rm "$BOT_CONTAINER" 2>/dev/null || true
docker run -d --name "$BOT_CONTAINER" --restart unless-stopped \
  -v "$BOT_DIR/.env:/app/.env:ro" \
  -v "$BOT_DIR/data:/app/data" \
  -v "$BOT_DIR/logs:/app/logs" \
  "$NEW_REF" >/dev/null

verify() {
  local i
  for i in $(seq 1 12); do
    docker logs "$BOT_CONTAINER" 2>&1 | grep -q 'Application started' && break
    sleep 5
  done
  docker logs "$BOT_CONTAINER" 2>&1 | grep -q 'Application started' \
    || { echo 'verify: no Application started'; return 1; }
  docker logs "$BOT_CONTAINER" 2>&1 | grep -q 'verified bot identity' \
    || { echo 'verify: platform identity check missing'; return 1; }
  if docker logs "$BOT_CONTAINER" 2>&1 | grep -qE 'Conflict: terminated by other|Traceback|CRITICAL'; then
    echo 'verify: error/polling conflict in logs'; return 1
  fi
  sleep 15  # sustained startup, not a momentary boot
  [ "$(docker inspect "$BOT_CONTAINER" --format '{{.State.Running}}')" = 'true' ] \
    || { echo 'verify: container not running'; return 1; }
  [ "$(docker inspect "$BOT_CONTAINER" --format '{{.RestartCount}}')" = '0' ] \
    || { echo 'verify: container restarted'; return 1; }
  [ "$(docker ps --format '{{.Names}}' | grep -cx "$BOT_CONTAINER")" = '1' ] \
    || { echo 'verify: not exactly one consumer'; return 1; }
  docker exec "$BOT_CONTAINER" python - <<'PYEOF' || { echo 'verify: identity/health probe failed'; return 1; }
from dotenv import load_dotenv
load_dotenv('/app/.env')
import json, os, sys, urllib.request
import httpx
tok = os.environ['BOT_TOKEN']
me = json.load(urllib.request.urlopen(f'https://api.telegram.org/bot{tok}/getMe', timeout=15))
exp = os.environ['ENGGANYO_BOT_USERNAME'].lstrip('@')
assert me['result']['is_bot'] and me['result']['username'] == exp, me
wh = json.load(urllib.request.urlopen(f'https://api.telegram.org/bot{tok}/getWebhookInfo', timeout=15))
assert wh['result']['url'] == '', 'unexpected webhook configured'
base = os.environ['ENGGANYO_API_BASE'].rstrip('/')
key = os.environ['ENGGANYO_BOT_SERVICE_KEY']
r = httpx.get(base + '/telegram/bot/inbox/health', headers={'X-Telegram-Bot-Key': key}, timeout=15)
assert r.status_code == 200, r.status_code
print(f"verify: getMe=@{me['result']['username']} inbox_health=200")
PYEOF
}

if verify; then
  printf '%s monorepo apps/telegram-bot (gha %s)\n' "$DEPLOY_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$BOT_DIR/DEPLOYED_SHA"
  echo "Bot deployment healthy: $DEPLOY_SHA ($NEW_REF)"
  exit 0
fi

# ─── Failed start: restore the previous image, never the database ─────────
echo 'ERROR: new bot failed verification; rolling back to previous image' >&2
docker rm -f "$BOT_CONTAINER" >/dev/null 2>&1 || true
if [ -n "$PREV_IMAGE" ]; then
  docker run -d --name "$BOT_CONTAINER" --restart unless-stopped \
    -v "$BOT_DIR/.env:/app/.env:ro" \
    -v "$BOT_DIR/data:/app/data" \
    -v "$BOT_DIR/logs:/app/logs" \
    "$PREV_IMAGE" >/dev/null
  sleep 10
  if docker logs "$BOT_CONTAINER" 2>&1 | grep -q 'Application started'; then
    echo "rollback: previous image $PREV_IMAGE restored and started"
  else
    echo 'ERROR: rollback image also failed to start - manual intervention required' >&2
  fi
else
  echo 'ERROR: no previous image to roll back to - bot is STOPPED' >&2
fi
exit 1
