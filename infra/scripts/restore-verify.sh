#!/usr/bin/env bash
# ─── Engganyo isolated restore test ──────────────────────────────────────
# Verifies a backup ACTUALLY restores — run on the VPS or any docker host.
# Spins a scratch postgres container on a private port, restores the dump,
# asserts table counts + ledger/mirror consistency, validates the uploads
# and recovery archives, and removes ONLY the container ID it created.
#
# Any failed check is FATAL — PASSED is printed only after every check.
#
# Usage:
#   ./restore-verify.sh                          # LATEST pointer, else newest by timestamp
#   ./restore-verify.sh $BACKUP_DEST/daily/20261023T030000Z
#   ./restore-verify.sh /path/to/local/backup-dir
#
# Required env:
#   BACKUP_AGE_IDENTITY   path to the age identity (secret key) file —
#                        needed ONLY for restore; escrowed off-host
#   BACKUP_DEST           rclone remote path (when fetching remotely)
# Optional:
#   RESTORE_MIN_USERS     assert at least N users (default 1)
#   RESTORE_PORT          scratch postgres port (default 55432)
set -euo pipefail

: "${BACKUP_AGE_IDENTITY:?Set BACKUP_AGE_IDENTITY (path to the age secret key file)}"
command -v age >/dev/null || { echo "age not installed"; exit 1; }
[ -f "$BACKUP_AGE_IDENTITY" ] || { echo "age identity file not found: $BACKUP_AGE_IDENTITY"; exit 1; }

RESTORE_DB="${DATABASE_NAME:-engganyo_db}_restoretest"
RESTORE_USER="${DATABASE_USER:-engganyo}"
RESTORE_PW="restore-test-$(head -c8 /dev/urandom | od -An -tx1 | tr -d ' ')"
RESTORE_PORT="${RESTORE_PORT:-55432}"
MIN_USERS="${RESTORE_MIN_USERS:-1}"

SCRATCH_CID=""   # set only after WE create a container — cleanup removes
                 # exactly this ID, never a pre-existing container
WORK="$(mktemp -d /tmp/engganyo-restore.XXXXXX)"
cleanup() {
  [ -n "$SCRATCH_CID" ] && docker rm -f "$SCRATCH_CID" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# ─── fetch or copy the backup set ───────────────────────────────────────
SRC="${1:-}"
if [ -z "$SRC" ]; then
  : "${BACKUP_DEST:?Set BACKUP_DEST, or pass a backup directory}"
  # Prefer the pointer written only after a successful upload — but a
  # missing pointer must not abort under `set -e`; fall through to the
  # timestamp sort instead.
  SRC="$(rclone cat "$BACKUP_DEST/LATEST" 2>/dev/null || true)"
  SRC="$(echo "$SRC" | tr -d '[:space:]')"
  if [ -n "$SRC" ]; then
    SRC="$BACKUP_DEST/$SRC"
    echo "testing LATEST pointer: $SRC"
  else
    # Fallback: newest snapshot across both tiers, compared by TIMESTAMP —
    # never by tier-prefixed path ('weekly/' would always sort after
    # 'daily/' regardless of date).
    latest_ts="$({
      rclone lsf "$BACKUP_DEST/daily"  --dirs-only 2>/dev/null | tr -d '/' || true
      rclone lsf "$BACKUP_DEST/weekly" --dirs-only 2>/dev/null | tr -d '/' || true
    } | sort -r | head -1)"
    [ -n "$latest_ts" ] || { echo "FATAL: no backups found under $BACKUP_DEST"; exit 1; }
    SRC=""
    for tier in daily weekly; do
      if rclone lsf "$BACKUP_DEST/$tier/$latest_ts/" >/dev/null 2>&1; then
        SRC="$BACKUP_DEST/$tier/$latest_ts"; break
      fi
    done
    [ -n "$SRC" ] || { echo "FATAL: no tier contains $latest_ts"; exit 1; }
    echo "testing newest by timestamp: $SRC"
  fi
fi
if [ -d "$SRC" ]; then
  cp "$SRC"/{db.dump.age,uploads.tar.gz.age,recovery.tar.gz.age,manifest.sha256,meta.txt} "$WORK/"
else
  rclone copyto "$SRC" "$WORK"
fi
cat "$WORK/meta.txt"

# ─── integrity of the ciphertext BEFORE decryption ──────────────────────
( cd "$WORK" && sha256sum -c manifest.sha256 )

# ─── decrypt (age — authenticated: tampering fails here regardless) ─────
dec() { age -d -i "$BACKUP_AGE_IDENTITY" -o "$2" "$1"; }
dec "$WORK/db.dump.age"         "$WORK/db.dump"
dec "$WORK/uploads.tar.gz.age"  "$WORK/uploads.tar.gz"
dec "$WORK/recovery.tar.gz.age" "$WORK/recovery.tar.gz"

# ─── archive content assertions (all fatal) ─────────────────────────────
uploads_count="$(tar tzf "$WORK/uploads.tar.gz" | grep -c .)"
echo "uploads archive: OK ($uploads_count entries)"

for required in '.env' 'nginx/ssl'; do
  tar tzf "$WORK/recovery.tar.gz" | grep -q "$required" \
    || { echo "FATAL: recovery bundle missing $required"; exit 1; }
done
echo "recovery bundle: OK (.env + TLS material present)"

# ─── restore into a scratch container ───────────────────────────────────
# Capture the container ID docker returns; cleanup removes only that ID.
SCRATCH_CID="$(docker run -d --name "engganyo_restore_test_$$" \
  -e POSTGRES_DB="$RESTORE_DB" -e POSTGRES_USER="$RESTORE_USER" \
  -e POSTGRES_PASSWORD="$RESTORE_PW" \
  -p "127.0.0.1:${RESTORE_PORT}:5432" postgres:16-alpine)"
echo "scratch container: ${SCRATCH_CID:0:12}"

# pg_isready can report ready during initdb, before the entrypoint
# restarts the server — wait until a real query succeeds.
ready=0
for i in $(seq 1 30); do
  if docker exec "$SCRATCH_CID" psql -U "$RESTORE_USER" -d "$RESTORE_DB" \
      -tAc 'SELECT 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = "1" ] || { echo "FATAL: scratch postgres never became ready"; exit 1; }

docker exec -i "$SCRATCH_CID" \
  pg_restore -U "$RESTORE_USER" -d "$RESTORE_DB" --no-owner --no-privileges \
  < "$WORK/db.dump"

echo "── restore verification (any failure aborts) ────────"
docker exec "$SCRATCH_CID" psql -U "$RESTORE_USER" -d "$RESTORE_DB" -c "
SELECT 'users' AS t, COUNT(*) FROM users
UNION ALL SELECT 'wallets',       COUNT(*) FROM wallets
UNION ALL SELECT 'transactions',  COUNT(*) FROM transactions
UNION ALL SELECT 'campaigns',     COUNT(*) FROM campaigns
UNION ALL SELECT 'audit_logs',    COUNT(*) FROM audit_logs
ORDER BY t;"

user_count="$(docker exec "$SCRATCH_CID" psql -U "$RESTORE_USER" -d "$RESTORE_DB" \
  -tAc 'SELECT COUNT(*) FROM users')"
if [ "$user_count" -lt "$MIN_USERS" ]; then
  echo "FATAL: restored DB has $user_count users (< $MIN_USERS)"; exit 1
fi

# Ledger consistency (schema: wallets.balance, transactions.wallet_id /
# amount / status, users.credit_balance mirror). Fatal on ANY mismatch.
mismatch="$(docker exec "$SCRATCH_CID" psql -U "$RESTORE_USER" -d "$RESTORE_DB" -tAc "
SELECT COUNT(*) FROM (
  SELECT w.id
  FROM wallets w
  LEFT JOIN transactions t
    ON t.wallet_id = w.id AND t.status = 'COMPLETED'
  GROUP BY w.id
  HAVING w.balance <> COALESCE(SUM(t.amount), 0)
) bad")"
[ "$mismatch" = "0" ] || { echo "FATAL: $mismatch wallets disagree with their ledger"; exit 1; }

mirror="$(docker exec "$SCRATCH_CID" psql -U "$RESTORE_USER" -d "$RESTORE_DB" -tAc "
SELECT COUNT(*) FROM users u
JOIN wallets w ON w.user_id = u.id
WHERE u.credit_balance <> w.balance")"
[ "$mirror" = "0" ] || { echo "FATAL: $mirror users have credit_balance != wallet balance"; exit 1; }

echo "── restore test PASSED ($user_count users, ledger + mirror consistent) ──"
