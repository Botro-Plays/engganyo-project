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

## Encryption — age (authenticated, asymmetric)

- [age](https://age-encryption.org) provides ChaCha20-Poly1305
  authenticated encryption: bit-flips or truncation fail at decryption,
  not merely at a hash comparison.
- **Asymmetric**: the VPS holds only `BACKUP_AGE_RECIPIENT` — a public
  key (`age1...`). Encrypting backups requires it; decrypting them does
  NOT work with it. Even a fully compromised VPS cannot decrypt stored
  backups.
- `manifest.sha256` hashes the ciphertext — a fast corruption check and
  inventory, not the authentication mechanism.

### Key generation, escrow, recovery

```bash
# Once, on a trusted machine (NOT necessarily the VPS):
age-keygen -o backup-identity.txt
# prints: Public key: age1xxxxxxxx...
```

- `backup-identity.txt` = the secret. Store it in a password manager AND
  a second location. **If lost, every backup is unrecoverable** — the
  VPS never holds it.
- `BACKUP_AGE_RECIPIENT` (the `age1...` public key) lives in
  `/home/engganyo/.backup.env` on the VPS — safe to expose.
- The identity file reaches the VPS only transiently, for a restore or
  restore-test run (`BACKUP_AGE_IDENTITY=/path/to/backup-identity.txt`),
  and is removed afterward.
- Rotating: generate a new identity, update `BACKUP_AGE_RECIPIENT`.
  Old backups still need the OLD identity — escrow both until aged out.
- Manual decrypt (any machine with age + the identity file):
  `age -d -i backup-identity.txt -o db.dump db.dump.age`

## Retention

- **Daily** tier: every run; age limit `BACKUP_RETENTION_DAILY_DAYS` (14).
- **Weekly** tier: Sunday runs; age limit `BACKUP_RETENTION_WEEKLY_DAYS` (56).
- **Count floor**: the newest `BACKUP_KEEP_DAILY` (7) and
  `BACKUP_KEEP_WEEKLY` (4) snapshots are always kept regardless of age —
  a prolonged backup outage cannot prune the last copy.

## Restore selection

`restore-verify.sh` (no argument) reads the `LATEST` pointer, which the
backup writes **only after a successful upload** — it always resolves to
a complete run. If `LATEST` is absent, it falls back to the newest
snapshot across both tiers compared by embedded timestamp (never by
tier-prefixed path).

## Activation (blocked on destination decision)

1. Generate the age keypair above; escrow the identity; put the
   **public** key in `/home/engganyo/.backup.env` as `BACKUP_AGE_RECIPIENT`.
2. Pick a destination — Cloudflare R2 or Backblaze B2 (S3-compatible,
   enable object-lock/versioning if available), or a second SSH host
   (`sftp:` rclone remote).
3. Create a scoped access key (bucket-only; write+list; ideally no
   delete or retention-locked deletes) → `rclone config` remote `bkp:`;
   set `BACKUP_DEST=bkp:engganyo-backups` in `.backup.env`.
   Credentials go through the secrets flow — never in chat/git.
4. Cron: `15 3 * * * engganyo . /home/engganyo/.backup.env && /opt/engganyo-project/infra/scripts/backup-offsite.sh`
5. First-run checklist: manual run → objects landed → restore test below.

## Isolated restore test

```bash
BACKUP_AGE_IDENTITY=~/backup-identity.txt ./infra/scripts/restore-verify.sh
BACKUP_AGE_IDENTITY=~/backup-identity.txt ./infra/scripts/restore-verify.sh bkp:engganyo-backups/daily/<TS>
BACKUP_AGE_IDENTITY=~/backup-identity.txt ./infra/scripts/restore-verify.sh ./local-backup-dir
```

Every check is fatal — `PASSED` is printed only after: manifest
verification, age decryption, uploads archive validity, recovery-bundle
content (`.env` + TLS material present), restore into a scratch
`postgres:16` container on `127.0.0.1:55432`, core table counts,
`wallets.balance` = signed `COMPLETED` ledger sum, and
`users.credit_balance` = `wallets.balance` mirror. Cleanup removes only
the container ID this run created — a pre-existing container is never
touched. `RESTORE_MIN_USERS` (default 1) asserts the backup is not empty.

Run after activation and after any schema/tooling change. A nonzero exit
means the backup pipeline is broken — treat as an alert.

## Rebuild-on-fresh-VPS procedure (summary)

1. Provision VPS + Docker, clone repo, checkout the SHA to deploy.
2. Fetch + decrypt `recovery.tar.gz.age` → restore `.env`,
   `infra/nginx/ssl`, `init.sql` into the checkout.
3. `docker compose up -d postgres` → `pg_restore` the decrypted `db.dump`.
4. Restore `uploads.tar.gz` into the `engganyo_uploads` volume.
5. Deploy normally (`deploy-release.sh`); verify Cloudflare/mTLS config
   matches the restored cert material.
