#!/usr/bin/env bash
# ─── Engganyo off-host backup ──────────────────────────────────────────────
# Creates an encrypted off-host backup of everything needed to rebuild the
# service on a fresh VPS:
#   1. PostgreSQL dump (pg_dump -Fc, from the running container)
#   2. uploads volume (proof images etc.)
#   3. recovery bundle (.env secrets + nginx TLS/CA material)
#
# Encryption: age (https://age-encryption.org) — AUTHENTICATED encryption
# (ChaCha20-Poly1305), asymmetric: backups encrypt TO a public recipient
# key, so the VPS never holds the decryption key. Tampering fails at
# decryption, not just at a hash check over an editable manifest.
#
# Required env (set in ~/.backup.env — NEVER committed to git):
#   BACKUP_AGE_RECIPIENT   age public key (age1...) — public, safe on VPS
#   BACKUP_DEST            rclone remote path, e.g. bkp:engganyo-backups
#                          (local paths also work for rehearsals)
# Optional:
#   BACKUP_RETENTION_DAILY_DAYS    days to keep daily backups    (default 14)
#   BACKUP_RETENTION_WEEKLY_DAYS   days to keep weekly backups   (default 56)
#   BACKUP_KEEP_DAILY              min daily snapshots to keep   (default 7)
#   BACKUP_KEEP_WEEKLY             min weekly snapshots to keep  (default 4)
#   PROJECT_DIR                    repo checkout on the VPS      (default /opt/engganyo-project)
#   PG_CONTAINER / API_CONTAINER / DATABASE_NAME / DATABASE_USER (defaults match prod)
#
# Retention keeps BOTH the newest KEEP snapshots AND anything newer than
# the age limit — a prolonged backup outage cannot prune the last copy.
# A LATEST pointer file records the last SUCCESSFUL run; restore-verify
# prefers it over listing-based resolution.
#
# Intended: cron daily. Exits non-zero on ANY failure so a monitoring hook
# can page.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/engganyo-project}"
PG_CONTAINER="${PG_CONTAINER:-engganyo_postgres}"
API_CONTAINER="${API_CONTAINER:-engganyo_api}"
DB_NAME="${DATABASE_NAME:-engganyo_db}"
DB_USER="${DATABASE_USER:-engganyo}"
RETENTION_DAILY="${BACKUP_RETENTION_DAILY_DAYS:-14}"
RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY_DAYS:-56}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"

: "${BACKUP_AGE_RECIPIENT:?Set BACKUP_AGE_RECIPIENT (age public key, age1...)}"
: "${BACKUP_DEST:?Set BACKUP_DEST (rclone remote:bucket/path)}"
command -v rclone >/dev/null || { echo "rclone not installed (https://rclone.org/install/)"; exit 1; }
command -v age >/dev/null || { echo "age not installed (https://github.com/FiloSottile/age#installation)"; exit 1; }

TS="$(date -u +%Y%m%dT%H%M%SZ)"
KIND="daily"; [ "$(date -u +%u)" = "7" ] && KIND="weekly"   # Sunday → weekly tier
STAGE="$(mktemp -d /tmp/engganyo-backup.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

echo "[$TS] backup start ($KIND tier)"

# ─── 1. PostgreSQL logical dump ─────────────────────────────────────────
docker exec "$PG_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc \
  > "$STAGE/db.dump"
echo "  db.dump: $(stat -c%s "$STAGE/db.dump") bytes"

# ─── 2. uploads volume ──────────────────────────────────────────────────
# MSYS2_ARG_CONV_EXCL: keep container paths literal when run under
# Git Bash on Windows; a no-op on Linux.
MSYS2_ARG_CONV_EXCL='*' docker exec "$API_CONTAINER" \
  tar czf - -C /app/apps/api/uploads . \
  > "$STAGE/uploads.tar.gz"
echo "  uploads.tar.gz: $(stat -c%s "$STAGE/uploads.tar.gz") bytes"

# ─── 3. recovery bundle: env secrets + TLS/CA material ──────────────────
# Restoring service on a fresh VPS is impossible without these — a missing
# input is a FATAL error, not a warning: a backup lacking recovery material
# is not a backup.
for required in "$PROJECT_DIR/.env" "$PROJECT_DIR/infra/nginx/ssl" "$PROJECT_DIR/infra/scripts/init.sql"; do
  if [ ! -e "$required" ]; then
    echo "FATAL: required recovery input missing: $required" >&2
    exit 1
  fi
done
tar czf "$STAGE/recovery.tar.gz" -C "$PROJECT_DIR" \
  .env infra/nginx/ssl infra/scripts/init.sql
echo "  recovery.tar.gz: $(stat -c%s "$STAGE/recovery.tar.gz") bytes"

# ─── encrypt everything (age, authenticated) ────────────────────────────
age -r "$BACKUP_AGE_RECIPIENT" -o "$STAGE/db.dump.age"         "$STAGE/db.dump"
age -r "$BACKUP_AGE_RECIPIENT" -o "$STAGE/uploads.tar.gz.age"  "$STAGE/uploads.tar.gz"
age -r "$BACKUP_AGE_RECIPIENT" -o "$STAGE/recovery.tar.gz.age" "$STAGE/recovery.tar.gz"
rm "$STAGE/db.dump" "$STAGE/uploads.tar.gz" "$STAGE/recovery.tar.gz"

# ─── manifest over the CIPHERTEXT (integrity + inventory; age provides
#     authentication at decrypt — the manifest is a fast pre-check) ──────
( cd "$STAGE" && sha256sum db.dump.age uploads.tar.gz.age recovery.tar.gz.age ) \
  > "$STAGE/manifest.sha256"
printf 'timestamp=%s\ntier=%s\nschema=pg16-fc\nencryption=age\n' "$TS" "$KIND" \
  > "$STAGE/meta.txt"

# ─── ship ────────────────────────────────────────────────────────────────
RDIR="$BACKUP_DEST/$KIND/$TS"
rclone copyto "$STAGE" "$RDIR"
# Pointer to the last SUCCESSFUL run, written only after upload succeeds.
echo "$KIND/$TS" | rclone rcat "$BACKUP_DEST/LATEST"

# ─── retention: age limit AND count floor ────────────────────────────────
# Keep the newest KEEP snapshots unconditionally (a backup outage must not
# prune the last copy), plus everything younger than the age limit.
# Directory names are UTC ISO timestamps and sort lexically.
prune_tier() {
  local tier="$1" max_age_days="$2" keep="$3"
  local dirs
  dirs="$(rclone lsf "$BACKUP_DEST/$tier" --dirs-only 2>/dev/null | tr -d '/' | sort -r)" || return 0
  local candidates
  candidates="$(echo "$dirs" | tail -n "+$((keep + 1))")"
  local d age epoch
  for d in $candidates; do
    epoch="$(date -ud "${d:0:4}-${d:4:2}-${d:6:2} ${d:9:2}:${d:11:2}:${d:13:2}" +%s 2>/dev/null)" \
      || { echo "  retention: skipping unparseable dir $tier/$d"; continue; }
    age=$(( ($(date -u +%s) - epoch) / 86400 ))
    if [ "$age" -gt "$max_age_days" ]; then
      echo "  retention: pruning $tier/$d (${age}d old)"
      rclone purge "$BACKUP_DEST/$tier/$d"
    fi
  done
}
prune_tier daily  "$RETENTION_DAILY"  "$KEEP_DAILY"
prune_tier weekly "$RETENTION_WEEKLY" "$KEEP_WEEKLY"

echo "[$TS] backup complete → $RDIR"
