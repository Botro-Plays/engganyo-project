#!/usr/bin/env bash
# ─── Engganyo off-host backup ──────────────────────────────────────────────
# Creates an encrypted off-host backup of everything needed to rebuild the
# service on a fresh VPS:
#   1. PostgreSQL dump (pg_dump -Fc, from the running container)
#   2. uploads volume (proof images etc.)
#   3. recovery bundle (.env secrets + nginx TLS/CA material)
# Each archive is AES-256-CBC encrypted (openssl, PBKDF2, 600k iterations)
# BEFORE leaving the host, then shipped to $BACKUP_DEST via rclone. The
# manifest hashes the ENCRYPTED blobs — the exact bytes that leave the host —
# so tampering/corruption is detectable before decryption.
#
# Required env (set in ~/.backup.env or systemd EnvironmentFile — NEVER
# committed to git):
#   BACKUP_ENCRYPTION_KEY   passphrase for openssl encryption
#   BACKUP_DEST             rclone remote path, e.g. r2:engganyo-backups
# Optional:
#   BACKUP_RETENTION_DAILY_DAYS    days to keep daily backups    (default 14)
#   BACKUP_RETENTION_WEEKLY_DAYS   days to keep weekly backups   (default 56)
#   BACKUP_KEEP_DAILY              min daily snapshots to keep   (default 7)
#   BACKUP_KEEP_WEEKLY             min weekly snapshots to keep  (default 4)
#   PROJECT_DIR                    repo checkout on the VPS      (default /opt/engganyo-project)
#   PG_CONTAINER / DATABASE_NAME / DATABASE_USER                 (defaults match prod)
#
# Retention keeps BOTH the newest KEEP snapshots AND anything newer than
# the age limit — a prolonged backup outage cannot prune the last copy.
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
PBKDF2_ITER="${BACKUP_PBKDF2_ITER:-600000}"

: "${BACKUP_ENCRYPTION_KEY:?Set BACKUP_ENCRYPTION_KEY (passphrase for backup encryption)}"
: "${BACKUP_DEST:?Set BACKUP_DEST (rclone remote:bucket/path)}"
command -v rclone >/dev/null || { echo "rclone not installed"; exit 1; }
command -v openssl >/dev/null || { echo "openssl not installed"; exit 1; }

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
docker exec "$API_CONTAINER" \
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

# ─── encrypt everything ─────────────────────────────────────────────────
# -pbkdf2 -iter: strengthens the passphrase KDF. The SAME -iter value is
# required to decrypt — it is recorded in meta.txt, not guessed.
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITER" -salt \
        -pass env:BACKUP_ENCRYPTION_KEY -in "$1" -out "$2"; }
enc "$STAGE/db.dump"           "$STAGE/db.dump.enc"
enc "$STAGE/uploads.tar.gz"    "$STAGE/uploads.tar.gz.enc"
enc "$STAGE/recovery.tar.gz"   "$STAGE/recovery.tar.gz.enc"
rm "$STAGE/db.dump" "$STAGE/uploads.tar.gz" "$STAGE/recovery.tar.gz"

# ─── manifest over the CIPHERTEXT (integrity of what leaves the host) ───
( cd "$STAGE" && sha256sum db.dump.enc uploads.tar.gz.enc recovery.tar.gz.enc ) \
  > "$STAGE/manifest.sha256"
printf 'timestamp=%s\ntier=%s\nschema=pg16-fc\npbkdf2_iter=%s\n' \
  "$TS" "$KIND" "$PBKDF2_ITER" > "$STAGE/meta.txt"

# ─── ship ────────────────────────────────────────────────────────────────
RDIR="$BACKUP_DEST/$KIND/$TS"
rclone copyto "$STAGE" "$RDIR"
rclone copyto "$RDIR/meta.txt" "$BACKUP_DEST/LATEST.txt"

# ─── retention: age limit AND count floor ────────────────────────────────
# Keep the newest KEEP snapshots unconditionally (a backup outage must not
# prune the last copy), plus everything younger than the age limit.
# Directory names are UTC ISO timestamps and sort lexically.
prune_tier() {
  local tier="$1" max_age_days="$2" keep="$3"
  local dirs
  dirs="$(rclone lsf "$BACKUP_DEST/$tier" --dirs-only 2>/dev/null | tr -d '/' | sort -r)" || return 0
  # candidates = everything except the newest $keep
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
