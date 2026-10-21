# SSH and reformatted-host recovery

## Follow-up: server reboot and local data inspection

The user successfully reconnected after reboot. The server now reports kernel `6.8.0-147-generic`, no failed systemd units, and no reboot-required marker. Earlier server output showed empty `/opt` and `/srv`, no Docker command, and only SSH listening publicly. The user reports the prior backup was lost.

Local inspection on 2026-10-21 found:

- Running PostgreSQL container `engganyo_postgres_dev`, using `postgres:16-alpine` and volume `engganyo_pgdata_dev`.
- The cluster lists only `postgres` and `engganyo_db` besides templates. `engganyo_db` has no tables outside system schemas and no `_prisma_migrations` table. It cannot currently supply the former application's records.
- Both the root `.env` and `apps/api/.env` point to `localhost:5432/engganyo_db`. Secret values were not printed. The frontend environment file also exists.
- The project contains Prisma migration SQL files, including the initial schema and later additions through active-effect persistence. These describe schema changes; they do not back up accounts, balances, transactions, or uploads.
- No database dump/archive was found by the targeted project-folder filename search. The expected `apps/api/uploads` directory was not found. This was not a whole-PC or provider-snapshot search.
- No database reset, migration, seed, or restore was performed during inspection.

If no other snapshot or data copy can be located, plan an explicitly fresh installation and recreate application configuration. Preserve existing local environment files securely, but validate their settings rather than assuming they are the lost production configuration. Do not infer account balances from seed data.

The warning means the host key remembered on this PC differs from the key now presented by 134.255.225.158. Reinstallation commonly generates new host keys, but the warning alone does not authenticate the new server or diagnose the old corruption.

## 1. Verify through the hosting provider console

Open the provider's web/VNC/serial console for this exact VPS. Run on the VPS:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

The fingerprint must exactly match what PowerShell reports:

```text
SHA256:FpRke85Jh9Qw1/TbDjL7ThghyOciePFRiPCeN8f7++I
```

This fingerprint was supplied in the chat and has NOT been independently verified by the audit. If the console shows a different value, do not accept the SSH key; resolve the host/IP/key discrepancy with the provider. An ssh-keyscan result alone would not provide independent verification.

## 2. After the fingerprint matches, update this PC's saved entry

Run in PowerShell:

```powershell
Copy-Item -LiteralPath "$env:USERPROFILE\.ssh\known_hosts" -Destination "$env:USERPROFILE\.ssh\known_hosts.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
ssh-keygen -R 134.255.225.158 -f "$env:USERPROFILE\.ssh\known_hosts"
ssh root@134.255.225.158
```

Compare the reconnect prompt's fingerprint again, then type `yes` only if it matches. Removal is limited to this IP's saved host keys; other hosts remain. OpenSSH documents the fingerprint and removal options in [ssh-keygen(1)](https://man.openbsd.org/man1/ssh-keygen.1).

This does not disable strict checking. A subsequent password/key rejection is a separate authentication issue: a reformat may have removed users and authorized_keys. Recover those through the provider console, using the provider's supported login account. Never share the private SSH key or root password in chat.

## 3. Inventory recovery assets before redeploying

- PostgreSQL backup/snapshot and its timestamp; determine whether the old database is recoverable.
- Uploaded avatars/proofs, usually in the Docker volume named engganyo_uploads.
- Production environment settings and original encryption keys; the database alone cannot decrypt encrypted secrets without the matching keys.
- Domain/DNS and Cloudflare origin certificate/private key.
- Deployment user's authorized public key and GitHub Actions VPS settings.
- Payment/OAuth credentials and webhook registrations, including whether restored data references old callback URLs or gateway objects.

Repository code and container images do not restore balances, accounts, transactions, or uploads. If there is no recoverable database, a seed operation creates a new system; it does not reconstruct the old one.

## 4. Prepare a private deployment after the audit blockers are fixed

Use an intentionally selected release commit and matching immutable API/web image tags. Set the real JWT_ACCESS_SECRET and JWT_REFRESH_SECRET, not JWT_SECRET. Use the correct production template and preserve restored encryption material. Remove public database/Redis/API port mappings or restrict them appropriately before starting the stack. Configure the provider firewall and verify the actual Docker port exposure.

For a new/verified-restored database, the correct migration pattern uses a one-off API container after infrastructure is healthy. Example from the project directory, once images and environment settings are prepared:

```sh
docker compose up -d postgres redis
docker compose run --rm --no-deps --entrypoint node api node_modules/prisma/build/index.js migrate deploy
```

This is an example recovery step, not a command executed by this audit. Use it only after confirming the intended database target and backup/restore state. It avoids the old guide's attempt to exec into an API container that has not started. The regular API entrypoint also runs migrations on startup.

Seed only an intentional fresh installation, with a strong ADMIN_PASSWORD and after verifying the production image includes the configured seed runner. Do not run a reset or seed as a database-recovery shortcut. Configure certificates, then start API/web/nginx and require successful health checks, private user-journey tests, and payment sandbox tests before reopening access.

Jhing's current workflow requires manual dispatch to publish images and deploy; a push alone runs checks. Re-establish the deployment user's SSH access and GitHub secrets before invoking it. This audit has not logged into or changed the VPS, local known_hosts, or GitHub secrets.
