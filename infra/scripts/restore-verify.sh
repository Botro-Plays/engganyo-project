#!/usr/bin/env bash
# ─── Engganyo isolated restore test ──────────────────────────────────────
# Verifies a backup ACTUALLY restores — run on the VPS or any docker host.
# Spins a uniquely-named scratch postgres container on a private port,
# restores the dump, asserts table counts + ledger/mirror consistency,
# validates the uploads and recovery archives, and removes only the
# container it created.
#
# Any failed check is FATAL — PASSED is printed only after every check.
#
# Usage:
#   ./restore-verify.sh                          # newest backup in $BACKUP_DEST (daily or weekly)
#   ./restore-verify.sh $BACKUP_DEST/daily/20261023T030000Z
#   ./restore-verify.sh /path/to/local/backup-dir
#
# Required env:
#   BACKUP_ENCRYPTION_KEY   passphrase used by backup-offsite.sh
#   BACKUP_DEST             rclone remote path (when fetching remotely)
# Optional:
#   RESTORE_MIN_USERS       assert at least N users (default 1)
#   RESTORE_PORT            scratch postgres port (default 55432)
set -euo pipefail

: "${BACKUP_ENCRYPTION_KEY:?Set BACKUP_ENCRYPTION_KEY}"

RESTORE_DB="${DATABASE_NAME:-engganyo_db}_restoretest"
RESTORE_USER="${DATABASE_USER:-engganyo}"
RESTORE_PW="restore-test-$(head -c8 /dev/urandom | od -An -tx1 | tr -d ' ')"
RESTORE_PORT="${RESTORE_PORT:-55432}"
MIN_USERS="${RESTORE_MIN_USERS:-1}"

# Unique scratch container name — can never collide with a pre-existing
# container, so cleanup only ever removes what this run created.
SCRATCH_CTN="engganyo_restore_test_$(date -u +%s)_$$"

WORK="$(mktemp -d /tmp/engganyo-restore.XXXXXX)"
cleanup() {
  docker rm -f "$SCRATCH_CTN" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ─── fetch or copy the backup set ───────────────────────────────────────
SRC="${1:-}"
if [ -z "$SRC" ]; then
  : "${BACKUP_DEST:?Set BACKUP_DEST, or pass a backup directory}"
  # Newest snapshot across BOTH tiers (Sunday runs live under weekly/).
  latest="$({
    rclone lsf "$BACKUP_DEST/daily"  --dirs-only 2>/dev/null | sed 's|^|daily/|'
    rclone lsf "$BACKUP_DEST/weekly" --dirs-only 2>/dev/null | sed 's|^|weekly/|'
  } | sort | tail -1)"
  [ -n "$latest" ] || { echo "FATAL: no backups found under $BACKUP_DEST"; exit 1; }
  SRC="$BACKUP_DEST/${latest%/}"
  echo "testing newest: $SRC"
fi
if [ -d "$SRC" ]; then
  cp "$SRC"/{db.dump.enc,uploads.tar.gz.enc,recovery.tar.gz.enc,manifest.sha256,meta.txt} "$WORK/"
else
  rclone copyto "$SRC" "$WORK"
fi
cat "$WORK/meta.txt"
PBKDF2_ITER="$(sed -n 's/^pbkdf2_iter=//p' "$WORK/meta.txt")"
PBKDF2_ITER="${PBKDF2_ITER:-600000}"

# ─── integrity of the ciphertext BEFORE decryption ──────────────────────
( cd "$WORK" && sha256sum -c manifest.sha256 )   # aborts on tampering

# ─── decrypt (same PBKDF2 iteration count used at backup time) ──────────
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter "$PBKDF2_ITER" \
        -pass env:BACKUP_ENCRYPTION_KEY -in "$1" -out "$2"; }
dec "$WORK/db.dump.enc"         "$WORK/db.dump"
dec "$WORK/uploads.tar.gz.enc"  "$WORK/uploads.tar.gz"
dec "$WORK/recovery.tar.gz.enc" "$WORK/recovery.tar.gz"

# ─── archive content assertions (all fatal) ─────────────────────────────
uploads_count="$(tar tzf "$WORK/uploads.tar.gz" | grep -c .)"
echo "uploads archive: OK ($uploads_count entries)"

# A backup without .env or TLS material cannot rebuild the service —
# treat its absence as a failed backup, not a partial success.
for required in '.env' 'nginx/ssl'; do
  tar tzf "$WORK/recovery.tar.gz" | grep -q "$required" \
    || { echo "FATAL: recovery bundle missing $required"; exit 1; }
done
echo "recovery bundle: OK (.env + TLS material present)"

# ─── restore into a scratch container ───────────────────────────────────
docker run -d --name "$SCRATCH_CTN" \
  -e POSTGRES_DB="$RESTORE_DB" -e POSTGRES_USER="$RESTORE_USER" \
  -e POSTGRES_PASSWORD="$RESTORE_PW" \
  -p "127.0.0.1:${SCRATCH_PORT}:5432" postgres:16-alpine >/dev/null

for i in $(seq 1 30); do
  docker exec "$SCRATCH_CTN" pg_isready -U "$RESTORE_USER" -d "$RESTORE_DB" >/dev/null 2>&1 && break
  sleep 2
done

docker exec -i "$SCRATCH_CTN" \
  pg_restore -U "$RESTORE_USER" -d "$RESTORE_DB" --no-owner --no-privileges \
  < "$WORK/db.dump"

echo "── restore verification (any failure aborts) ────────"
docker exec "$SCRATCH_CTN" psql -U "$RESTORE_USER" -d "$RESTORE_DB" -c "
SELECT 'users' AS t, COUNT(*) FROM users
UNION ALL SELECT 'wallets',       COUNT(*) FROM wallets
UNION ALL SELECT 'transactions',  COUNT(*) FROM transactions
UNION ALL SELECT 'campaigns',     COUNT(*) FROM campaigns
UNION ALL SELECT 'audit_logs',    COUNT(*) FROM audit_logs
ORDER BY t;"

user_count="$(docker exec "$SCRATCH_CTN" psql -U "$RESTORE_USER" -d "$RESTORE_DB" \
  -tAc 'SELECT COUNT(*) FROM users')"
if [ "$user_count" -lt "$MIN_USERS" ]; then
  echo "FATAL: restored DB has $user_count users (< $MIN_USERS)"; exit 1
fi

# Ledger consistency (schema: wallets.balance, transactions.wallet_id /
# amount / status, users.credit_balance mirror). Fatal on ANY mismatch —
# the report must not claim success on inconsistent accounting.
docker exec "$SCRATCH_CTN" psql -U "$RESTORE_USER" -d "$RESTORE_DB" -c "
SELECT COUNT(*) AS inconsistent_wallets FROM (
  SELECT w.id
  FROM wallets w
  LEFT JOIN transactions t
    ON t.wallet_id = w.id AND t.status = 'COMPLETED'
  GROUP BY w.id
  HAVING w.balance <> COALESCE(SUM(t.amount), 0)
) bad;"

mismatch="$(docker exec "$SCRATCH_CTN" psql -U "$RESTORE_USER" -d "$RESTORE_DB" -tAc "
SELECT COUNT(*) FROM (
  SELECT w.id
  FROM wallets w
  LEFT JOIN transactions t
    ON t.wallet_id = w.id AND t.status = 'COMPLETED'
  GROUP BY w.id
  HAVING w.balance <> COALESCE(SUM(t.amount), 0)
) bad")"
[ "$mismatch" = "0" ] || { echo "FATAL: $mismatch wallets disagree with their ledger"; exit 1; }

mirror="$(docker exec "$SCRATCH_CTN" psql -U "$RESTORE_USER" -d "$RESTORE_DB" -tAc "
SELECT COUNT(*) FROM users u
JOIN wallets w ON w.user_id = u.id
WHERE u.credit_balance <> w.balance")"
[ "$mirror" = "0" ] || { echo "FATAL: $mirror users have credit_balance != wallet balance"; exit 1; }

echo "── restore test PASSED ($user_count users, ledger + mirror consistent) ──"
