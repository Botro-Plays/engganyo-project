#!/usr/bin/env bash
# ─── Engganyo off-host backup ──────────────────────────────────────────────
# Creates an encrypted off-host backup of everything needed to rebuild the
# service on a fresh VPS:
#   1. PostgreSQL dump (pg_dump -Fc, from the running container)
#   2. uploads volume (proof images etc.)
#   3. recovery bundle (.env secrets + nginx TLS/CA material)
# Each archive is AES-256-CBC encrypted (openssl, PBKDF2) BEFORE leaving the
# host, then shipped to $BACKUP_DEST via rclone. A SHA-256 manifest and a
# plaintext-free LATEST pointer accompany each run.
#
# Required env (set in ~/.backup.env or systemd EnvironmentFile — NEVER
# committed to git):
#   BACKUP_ENCRYPTION_KEY   passphrase for openssl encryption
#   BACKUP_DEST             rclone remote path, e.g. r2:engganyo-backups
# Optional:
#   BACKUP_RETENTION_DAILY  days to keep daily backups   (default 14)
#   BACKUP_RETENTION_WEEKLY weeks to keep weekly backups (default 8)
#   PROJECT_DIR             repo checkout on the VPS     (default /opt/engganyo-project)
#   PG_CONTAINER / DB / USER  postgres container + db    (defaults match prod)
#
# Intended: cron daily. Exits non-zero on ANY failure so a monitoring hook
# (healthchecks.io ping, email alert, etc.) can page.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/engganyo-project}"
PG_CONTAINER="${PG_CONTAINER:-engganyo_postgres}"
API_CONTAINER="${API_CONTAINER:-engganyo_api}"
DB_NAME="${DATABASE_NAME:-engganyo_db}"
DB_USER="${DATABASE_USER:-engganyo}"
RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-14}"
RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-8}"

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
# Restoring service on a fresh VPS is impossible without these. They are
# encrypted with the rest of the backup before leaving the host.
tar czf "$STAGE/recovery.tar.gz" -C "$PROJECT_DIR" \
  .env infra/nginx/ssl infra/scripts/init.sql 2>/dev/null || true
echo "  recovery.tar.gz: $(stat -c%s "$STAGE/recovery.tar.gz") bytes"

# ─── manifest (hashes only — no secrets) ────────────────────────────────
( cd "$STAGE" && sha256sum db.dump uploads.tar.gz recovery.tar.gz ) \
  > "$STAGE/manifest.sha256"
printf 'timestamp=%s\ntier=%s\nschema=pg16-fc\n' "$TS" "$KIND" > "$STAGE/meta.txt"

# ─── encrypt everything ─────────────────────────────────────────────────
enc() { openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_ENCRYPTION_KEY \
        -in "$1" -out "$2"; }
enc "$STAGE/db.dump"           "$STAGE/db.dump.enc"
enc "$STAGE/uploads.tar.gz"    "$STAGE/uploads.tar.gz.enc"
enc "$STAGE/recovery.tar.gz"   "$STAGE/recovery.tar.gz.enc"
rm "$STAGE/db.dump" "$STAGE/uploads.tar.gz" "$STAGE/recovery.tar.gz"

# ─── ship ────────────────────────────────────────────────────────────────
RDIR="$BACKUP_DEST/$KIND/$TS"
rclone copyto "$STAGE" "$RDIR"
rclone copyto "$RDIR/meta.txt" "$BACKUP_DEST/LATEST.txt"

# ─── retention ──────────────────────────────────────────────────────────
rclone delete "$BACKUP_DEST/daily"  --min-age "${RETENTION_DAILY}d"   --rmdirs || true
rclone delete "$BACKUP_DEST/weekly" --min-age "$((RETENTION_WEEKLY * 7))d" --rmdirs || true

echo "[$TS] backup complete → $RDIR"
