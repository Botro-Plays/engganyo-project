# Backup & Restore

Off-host, encrypted backups for full service recovery on a fresh VPS.
Activation is pending the backup-destination decision — the scripts below
are ready and take no effect until `BACKUP_DEST` is configured.

## Scope

| Asset | Contents | Why it matters |
|---|---|---|
| PostgreSQL dump | `pg_dump -Fc` of `engganyo_db` | users, wallets, ledger, campaigns, audit history |
| uploads volume | `engganyo_uploads` → `/app/apps/api/uploads` | proof images; DB rows reference these files |
| recovery bundle | `.env` + `infra/nginx/ssl` + `init.sql` | JWT/DB/SMTP/reCAPTCHA secrets, private CA + origin certs — without these a rebuild cannot serve or authenticate anything |

All three archives are AES-256-CBC encrypted on the host **before**
leaving it, via `BACKUP_ENCRYPTION_KEY`.

## Retention

- **Daily** tier: every run; kept `BACKUP_RETENTION_DAILY` days (default 14).
- **Weekly** tier: Sunday run additionally lands in `weekly/`; kept
  `BACKUP_RETENTION_WEEKLY` weeks (default 8).
- Pruning runs at the end of each backup (`rclone delete --min-age`).

## Encryption key — generation, escrow, recovery

```bash
# Generate (once):
openssl rand -base64 48        # store the output OUTSIDE the VPS
```

- Store the key in a password manager AND a second location (printed
  copy / second manager). **If the key is lost, every backup is
  unrecoverable** — the server does not keep a decryptable copy.
- The key lives on the VPS only as `BACKUP_ENCRYPTION_KEY` in a
  root-owned `0600` env file (`/home/engganyo/.backup.env`) used by cron.
- Rotating the key only affects future backups; keep the previous key
  until all backups made under it age out (14d daily / 8w weekly).
- Recovery: any machine with `openssl` + the key can decrypt:
  `openssl enc -d -aes-256-cbc -pbkdf2 -in db.dump.enc -out db.dump`

## Activation (blocked on destination decision)

1. Pick a destination — Cloudflare R2 or Backblaze B2 (S3-compatible),
   or a second SSH host (`sftp:` rclone remote).
2. Create a scoped access key (bucket-only, write+list, no delete-all if
   the provider supports retention locks).
3. On the VPS: `rclone config` → remote `bkp:`; add to
   `/home/engganyo/.backup.env`:
   `BACKUP_DEST=bkp:engganyo-backups` and `BACKUP_ENCRYPTION_KEY=…`
   (credentials go through the secrets flow — never in chat/git).
4. Cron: `15 3 * * * engganyo . /home/engganyo/.backup.env && /opt/engganyo-project/infra/scripts/backup-offsite.sh`
5. First-run checklist: run the script manually, confirm objects landed,
   then run the restore test below.

## Isolated restore test

```bash
./infra/scripts/restore-verify.sh          # newest daily backup
./infra/scripts/restore-verify.sh bkp:engganyo-backups/daily/<TS>
```

Verifies SHA-256 manifest → decrypts → restores into a scratch
`postgres:16-alpine` container on `127.0.0.1:55432` → asserts core table
counts → validates the uploads archive → removes all state. Run after
activation and after any schema/tooling change. Exit code ≠ 0 = alert.

## Rebuild-on-fresh-VPS procedure (summary)

1. Provision VPS + Docker, clone repo, checkout the SHA to deploy.
2. Fetch + decrypt `recovery.tar.gz` → restore `.env`, `infra/nginx/ssl`,
   `init.sql` into the checkout.
3. `docker compose up -d postgres` → `pg_restore` the decrypted `db.dump`.
4. Restore `uploads.tar.gz` into the `engganyo_uploads` volume.
5. Deploy normally (`deploy-release.sh`); verify Cloudflare/mTLS config
   matches the restored cert material.
