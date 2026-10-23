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

All three archives are encrypted on the host **before** leaving it.
The recovery bundle is required — `backup-offsite.sh` aborts if `.env` or
the TLS material is missing rather than shipping an unrestorable backup.

## Integrity & encryption

- AES-256-CBC via `openssl enc`, PBKDF2 with **600,000 iterations**
  (recorded in `meta.txt`; `openssl enc` does not store the count — the
  same `-iter` value is required to decrypt).
- `manifest.sha256` hashes the **ciphertext** — the exact bytes that leave
  the host — so tampering or transfer corruption is caught before
  decryption. `openssl enc` is not authenticated encryption; the manifest
  provides integrity for at-rest objects.
- For tamper-evidence against an attacker who can rewrite both objects
  and manifest, use bucket object-lock/versioning (R2/B2 support it) or
  a second verification channel.

## Retention

- **Daily** tier: every run; age limit `BACKUP_RETENTION_DAILY_DAYS` (14).
- **Weekly** tier: Sunday runs; age limit `BACKUP_RETENTION_WEEKLY_DAYS` (56).
- **Count floor**: the newest `BACKUP_KEEP_DAILY` (7) and
  `BACKUP_KEEP_WEEKLY` (4) snapshots are always kept regardless of age —
  a prolonged backup outage cannot prune the last copy.
- Pruning runs at the end of each backup and is age+count based, not
  pure age, so it never empties a tier.

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
  until all backups made under it age out (respecting the count floor).
- Recovery on any machine with openssl + the key + the iteration count
  from `meta.txt`:
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in db.dump.enc -out db.dump`

## Activation (blocked on destination decision)

1. Pick a destination — Cloudflare R2 or Backblaze B2 (S3-compatible,
   enable object-lock/versioning if available), or a second SSH host
   (`sftp:` rclone remote).
2. Create a scoped access key (bucket-only; write+list; ideally no
   delete or retention-locked deletes).
3. On the VPS: `rclone config` → remote `bkp:`; add to
   `/home/engganyo/.backup.env`:
   `BACKUP_DEST=bkp:engganyo-backups` and `BACKUP_ENCRYPTION_KEY=…`
   (credentials go through the secrets flow — never in chat/git).
4. Cron: `15 3 * * * engganyo . /home/engganyo/.backup.env && /opt/engganyo-project/infra/scripts/backup-offsite.sh`
5. First-run checklist: run the script manually, confirm objects landed,
   then run the restore test below.

## Isolated restore test

```bash
./infra/scripts/restore-verify.sh          # newest backup across daily + weekly
./infra/scripts/restore-verify.sh bkp:engganyo-backups/daily/<TS>
./infra/scripts/restore-verify.sh ./local-backup-dir
```

Every check is fatal — `PASSED` is printed only after: manifest
verification, decryption, uploads archive validity, recovery-bundle
content (`.env` + TLS material present), restore into a uniquely-named
scratch `postgres:16` container on `127.0.0.1:55432`, core table counts,
`wallets.balance` = signed `COMPLETED` ledger sum, and
`users.credit_balance` = `wallets.balance` mirror. The scratch container
is uniquely named per run and only that container is removed.
`RESTORE_MIN_USERS` (default 1) asserts the backup is not empty.

Run after activation and after any schema/tooling change. A nonzero exit
means the backup pipeline is broken — treat as an alert.

## Rebuild-on-fresh-VPS procedure (summary)

1. Provision VPS + Docker, clone repo, checkout the SHA to deploy.
2. Fetch + decrypt `recovery.tar.gz` → restore `.env`, `infra/nginx/ssl`,
   `init.sql` into the checkout.
3. `docker compose up -d postgres` → `pg_restore` the decrypted `db.dump`.
4. Restore `uploads.tar.gz` into the `engganyo_uploads` volume.
5. Deploy normally (`deploy-release.sh`); verify Cloudflare/mTLS config
   matches the restored cert material.
