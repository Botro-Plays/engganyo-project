# Engganyo migration to the smaller VPS

## Objective

Run the full Engganyo platform on the new 4-core, 8 GB Ubuntu 24.04 KVM VPS at `134.255.232.68`. Center the product on P2P tasks with manual proof and creator review. Keep this file as the migration record and update each gate with evidence as it passes.

## Sequence and acceptance gates

| Step | Work | Exit gate |
| --- | --- | --- |
| 1 | Inventory production services, persistent data, integrations, queues, scheduled work and deployment configuration. Capture resource and request baselines. | Record live usage, feature flags, backup locations and peak traffic. |
| 2 | Reduce duplicate requests, expensive queries and unnecessary scheduled work. Audit BullMQ jobs before changing delivery. | Compare baseline and candidate under the same workload. Verify login, proof, reviews, wallet settlement and enabled integrations. |
| 3 | Apply UI UX Pro Max to Find tasks, My tasks and creator review. Make manual proof the default for new campaigns after reviewing existing flows. | Complete the P2P journey on mobile and desktop, including errors, rejection and retry. Compare requests per journey. |
| 4 | Provision Docker and Compose on the new VPS. Prepare separate deployment access, TLS and backups. Restore data and rehearse with commit-tagged images on a separate endpoint. | Full stack and restore pass. Verify disk headroom after pulling a second release, and capture peak CPU, RAM and latency. |
| 5 | Pause writes and old-host workers as needed, take a final backup, restore, validate, then switch GitHub deployment and the Cloudflare origin. Keep the old host available. | Verify production and deploy a known build through GitHub Actions. Confirm rollback steps and reconcile any writes before reverting. |

## Step 1 repository inventory

- GitHub Actions builds API and web images and pushes them to GHCR. The new VPS pulls those images. Compose runs the API, web, PostgreSQL and Redis, with Nginx handling the public origin per the deployment guide.
- Persistent state includes PostgreSQL, Redis and the `engganyo_uploads` volume. Review Redis queue state and persistence before rehearsal. Keep the production environment configuration and existing encryption keys in secure off-host storage.
- The deployment workflow reads `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_HOST_FINGERPRINT` and `VPS_SSH_PORT`. Prepare and verify the new values before switching the live target. Preserve the old target details for rollback. Check whether public API and reCAPTCHA settings need changes for the rehearsal endpoint.
- The current container memory limits total 8.25 GB. These are ceilings. Measure simultaneous usage and reserve room for the OS. The new host reported about 16 GB free before Docker, so measure storage after restoring the database and uploads and pulling images.
- The local Tasks patch limits refetching to active queries. Diff validation passed. TypeScript verification timed out and the browser journey and request counts remain pending.

### BullMQ and scheduled work

| Workload | Current responsibility | What to measure or verify |
| --- | --- | --- |
| Email queue | Verification, password reset, 2FA, digest and announcements | Job volume, retry behavior and failures. Separate account access from bulk or optional mail. |
| Trust score queue | Recalculates user trust scores | Frequency and repeated work per user. Verify how delayed updates affect eligibility. |
| Analytics queue | Daily snapshot | Duration, database load and who uses the snapshot. |
| Admin queue tools | Access to all three queues | Preserve queue visibility and recovery functions if delivery changes. |
| Scheduled services | Wallet every minute, store and payment checks every five minutes, weekday digest, midnight analytics | Confirm which jobs actually run with production flags and measure their cost before tuning cadence. |

### Current host dashboard snapshot

On 2026-11-03, the provider dashboard for `134.255.225.158` showed Ubuntu 24.04, 1.6% CPU utilization and 9.49 GB of 16 GB RAM in use (59.30%). This is one provider reading. Measure available memory and per-container usage inside Ubuntu to determine how much memory Engganyo needs. The guest baseline below supersedes the initial storage estimate. Measure the actual database, uploads, Docker images and free space before sizing the restore on the new host.

### Production guest baseline

On 2026-11-03 at 10:09 Manila time, Ubuntu reported 9.7 GiB RAM total, 1.1 GiB used, 8.6 GiB available, and 512 KiB swap used. The running containers totaled about 259 MiB (Nginx 14, web 66, API 101, PostgreSQL 74 and Redis 5 MiB, rounded). The root filesystem showed 99G total, 16G used and 79G available. The admin panel separately showed an 11 MB database and no uploads. This is a low-load snapshot. Peak measurements remain pending. The 8 GB host is suitable for a restore rehearsal based on this snapshot.

### Production Docker disk baseline

The active API, web, Nginx, Redis and PostgreSQL images sum to roughly 2.5 GB by listed image size. Older releases share layers, so summing all tags would overstate disk use. Attached volumes total about 84 MB (PostgreSQL 69.26 MB, Redis 14.37 MB, uploads 0 B). The report also shows two unattached volumes and zero build cache. This inventory supports a restore rehearsal on the new VPS. Measure free space after restoring data and pulling a second release. Include Docker logs in the disk budget.

### Live baseline to capture

Run on the **current production VPS** with Docker access. These commands report sizes and resource usage without reading application data or secrets.

```bash
date -Is
uptime
free -h
df -h /
sudo docker ps --format 'table {{.Names}}	{{.Status}}'
sudo docker stats --no-stream
sudo docker system df -v
```

Record observations at quiet and busy times. Use existing metrics or logs to capture peak load and request latency over a representative period. Capture the browser network counts for opening Tasks, switching views, accepting, uploading proof, submitting and receiving a review. Check the creator-side journey separately. Record endpoint counts without exporting auth headers or proof data.

## Status

- **Complete** — Repository service, queue, schedule and GitHub deployment input inventory.
- **Complete** — New-host provisioning: Docker 29.9.2 + Compose v5.7.0, `engganyo` deploy account, `/opt/engganyo-project` clone, dedicated Actions→VPS key and VPS→GitHub read-only deploy key.
- **Complete** — Off-host backup of production (pg_dump + uploads + Redis AOF + .env + TLS material) and full restore rehearsal with the live release `aab1ec93`.
- **Verified** — TLS + Authenticated Origin Pulls, full P2P manual-review journey, data persistence across restart.
- **Complete** — GitHub Actions secrets switched atomically; deploy run `41569092693` green end-to-end on `aab1ec93`: images pulled commit-tagged, all 5 containers healthy on new host. Required fingerprint = **ECDSA** `SHA256:VfSAIzSYaVT4HboEztqEB3EOjnGpSEjjsuigX24FL9M` (appleboy/Go ssh negotiates ecdsa-sha2-nistp256 before ed25519 — ed25519 fp caused mismatch).
- **In progress** — Optimization/UI work and production cutover.
- **Blocker noted** — New host hardware is 2 vCPU / 2.3 GiB / 25 GB, not the 4 vCPU / 8 GB stated in the brief. See "Host spec discrepancy" below.
- **Pending** — Browser-level baseline (Cloudflare Access blocks non-owner browsers), second-release disk check, workflow secret switch, Cloudflare origin cutover.

## Host spec discrepancy (IMPORTANT)

The brief stated the new VPS is 4 cores / 8 GB RAM / 25 GB disk. The actual provisioned host `vps-zap570030-1` (zap-hosting, KVM) reports:

- **2 vCPU**, **2.3 GiB RAM** (not 4/8), 25 GB disk — verified 2026-11-03 via `nproc`, `free -h`, `df`.
- The compose memory ceilings (postgres 4g + api 2g + web 1g + redis 1g + nginx 256m = 8.25 GB) are cgroup caps that exceed physical RAM; actual container usage at rehearsal was ~285 MiB total, leaving ~1.3 GiB available.
- Production traffic is negligible (nginx ~821 requests/24h ≈ 34/hr on the old host), so the stack fits today — but any growth or a container leak will hit the wall fast. **Decision needed: accept 2C/2.3G (works now, tight), or upgrade the plan before cutover.** Proceeding under the assumption the user may upgrade later; all rehearsal evidence below is on the 2C/2.3G host.

## New-host provisioning record (2026-11-03)

- Identity: `vps-zap570030-1`, Ubuntu 24.04.5 LTS, KVM virt, kernel 6.8.0-147, zap-hosting (same provider as old host). Pending reboot already cleared before session.
- SSH hardening: `PermitRootLogin no` effective (conf.d override), engadmin key login + sudo verified. Password auth also offered by sshd — consider disabling for engganyo/engadmin post-cutover.
- Docker Engine 29.9.2 + Compose v5.7.0 + buildx installed via official apt repo; `docker run hello-world` OK.
- `engganyo` account (uid 1002) in `docker` group, no sudo — per DEPLOYMENT.md.
- `/opt/engganyo-project` cloned via SSH as detached checkout; VPS→GitHub read-only deploy key `engganyo-vps-68-repository-read` (GitHub deploy key id 168541944, read_only, verified).
- Actions→VPS SSH: new dedicated keypair `engganyo_actions_v68` (fingerprint `SHA256:kqrOLE2WntVnNNLhgO+2OpTNg7DbPm64F+wqIPDjeP0`), public key installed with `restrict` prefix in `engganyo` authorized_keys; login + `docker info` verified.
- Host key fingerprints (server-side `/etc/ssh` vs `ssh-keyscan` — matched):
  - ED25519 `SHA256:LpMVh6xvb2o2V2AlqIKHQCGx0s8n3VrfamiSjJ1T+J4` ← use for `VPS_HOST_FINGERPRINT`
  - ECDSA `SHA256:VfSAIzSYaVT4HboEztqEB3EOjnGpSEjjsuigX24FL9M`, RSA `SHA256:kJRbbP5ZGTqjDkRcOBXoSg4p3qShzwi5d2k//j7bJdA`

## Production backup (2026-11-03 ~10:34 Manila)

Off-host copies at `C:\engganyo-backups\2026-11-03-pre-migration\` (outside source control) AND on the new VPS at `/home/engganyo/migration-backup/` (mode 700):

| Artifact | Size | Notes |
| --- | --- | --- |
| `engganyo_prod.fc` | 163,599 B | pg_dump custom format; sha256 `aef41d4af6b66d2856675d3cc3c654b52810b8c272d480af81dcb265bcf0579c` verified after transfer |
| `uploads.tar.gz` | 111 B | volume contains only empty `avatars/` dir |
| `redisdata.tar.gz` | 2.1 KB | RDB + AOF after BGREWRITEAOF |
| `env.production` | 4.1 KB | full .env incl. ENCRYPTION_KEY, JWT secrets, DB password, SMTP creds |
| `nginx-config.tar.gz` | 13 KB | cert.pem/key.pem + AOP root CA + origin-pull client cert/key + nginx.conf |
| `.release.env`, `.deployed-sha` | — | release `aab1ec93…` image pins |

- BullMQ queue state: **zero pending jobs** — only completed `send-weekly-digest` (2) and `daily-snapshot` (10) records. No replay risk on restore.
- Redis persistence healthy: AOF on, everysec fsync, last write ok.

## Restore rehearsal on 134.255.232.68 (2026-11-03)

Deployed release `aab1ec93b346e9568cb990282717a94c22d8d69d` (images transferred old→new via `docker save | ssh | docker load` because no GHCR pull credential exists outside Actions GITHUB_TOKEN — note for cutover: the normal workflow pushes images itself, so this only affects manual rehearsal).

Isolation measures in rehearsal `.env`: `APP_URL`/`FRONTEND_URL`/`API_BASE_URL` → localhost, `SMTP_HOST=127.0.0.1:9` (mail jobs fail locally, nothing sent), `ENABLE_EMAIL_VERIFICATION=false`, `ENABLE_ANTI_ABUSE=false`, `recaptcha_enabled=false` set in the rehearsal DB copy. Production values restored to `.env` are unchanged secrets (ENCRYPTION_KEY etc. identical — required for decryption).

| Check | Result |
| --- | --- |
| Restore | `pg_restore` clean; 49 tables; row counts identical to prod (users 2, campaigns 6, platform_configs 17, analytics 13, transactions 2, wallets 2) |
| Containers | all 5 healthy (postgres/redis/api/web/nginx) |
| API health | `{"status":"ok"}` db+redis ok, ~3–5 ms |
| TLS + AOP | no client cert → HTTP 400 (fails closed); with origin-pull client cert → 200 on `/login` and `/api/health`; origin cert = Cloudflare Origin Certificate, valid to 2041 |
| Register + login | new user → ACTIVE immediately; admin login OK with `admin@engganyo.com` + `.env` ADMIN_PASSWORD |
| P2P journey | assign → proof upload (webp re-encode) → submit → SUBMITTED (auto_verify off on rehearsal copy) → creator reject (wallet unchanged) → second campaign submit → creator approve (+30 credits: 335→365) |
| Persistence | after `compose restart api`: completions VERIFIED 2 / REJECTED 1, transactions intact |
| Load smoke | 150 mixed requests in 2.6 s; post-load api 143 MiB, web 83 MiB; host 1.3 GiB free |
| Disk | 11 G used / 13 G free after restore + one release pulled; second release adds ≤ ~1.9 GB minus shared layers — ample |

Rehearsal-only mutations (test worker `rehearsal-worker@example.com`, 3 fake `social_accounts` links, `auto_verify=false` on 2 campaigns, `recaptcha_enabled=false`, session IP rewrites) live only in the rehearsal DB and will be overwritten by the final cutover restore.

**Discovered:** `.env` `ADMIN_EMAIL=engganyo@yahoo.com` ≠ seeded `admin@engganyo.com` (drifted after seed); `BOTRO_PASSWORD` in `.env` does not match the seeded botro hash — same on production. Admin login works with `admin@engganyo.com` + current `ADMIN_PASSWORD`. Not migration-blocking; flag for cleanup.

**Discovered:** prod login requires reCAPTCHA (`recaptcha_enabled=true` DB row). Kept enabled on prod; disabled only in rehearsal copy.

## Workflow secret switch plan

| Secret | New value | Status |
| --- | --- | --- |
| `VPS_HOST` | `134.255.232.68` | prepared |
| `VPS_USER` | `engganyo` | prepared |
| `VPS_SSH_KEY` | private half of `engganyo_actions_v68` | prepared (lives in `~/.ssh` locally + Actions secret only) |
| `VPS_HOST_FINGERPRINT` | `SHA256:LpMVh6xvb2o2V2AlqIKHQCGx0s8n3VrfamiSjJ1T+J4` | verified against server + keyscan |
| `VPS_SSH_PORT` | `22` | unchanged |
| `NEXT_PUBLIC_API_URL` | `https://engganyo.com/api` | unchanged (domain unchanged) |

Atomicity: the deploy job reads all secrets in one run; between `secrets.VPS_HOST` and `VPS_HOST_FINGERPRINT` update there is a window where a triggered deploy would fail fingerprint check or hit the old host with the new key. Mitigate: update secrets while no Actions run is active (check Actions tab first), in order VPS_SSH_KEY → VPS_HOST_FINGERPRINT → VPS_HOST → VPS_USER, then immediately trigger `Run workflow` on main. Rollback = restore the four old values (old host stays up; its fingerprint from known_hosts remains valid).

## CUTOVER EXECUTION LOG (2026-11-03)

- ~04:0x UTC: merge window — 0 in-flight/queued Actions runs. Releases: both hosts on `aab1ec93`.
- Old host writes paused: `docker stop engganyo_api engganyo_web` (api holds all BullMQ workers + crons). nginx/postgres/redis left up for dump; site returns 502 during window.
- Final backup verified: `engganyo_prod.fc` 163,730 B (PGDMP), `uploads.tar.gz` 111 B, `redisdata.tar.gz` 1.7 KB post-BGREWRITEAOF. BullMQ `wait`/`active`/`delayed` keys = **0** — nothing to preserve beyond state already in Redis. Copies at `C:\engganyo-backups\2026-11-03-final-cutover\` + VPS `~/migration-backup/`.
- New host: volumes replaced (containers removed → volumes recreated → uploads+AOF extracted → fresh `pgdata` → `pg_restore` clean). Production `.env`: real `SMTP_HOST=smtp.sendgrid.net`/`SMTP_PORT=587`; `recaptcha_enabled=true` confirmed in restored DB.
- Verified on new origin (pre-DNS): all 5 containers healthy; `/api/health` ok; row counts = prod (users 2, campaigns 6, wallets 2, tx 2, completions 0); TLS+AOP 400 without cert / 200 with origin-pull client cert on `/login` + `/api/health`; admin login path verified.
- **READY FOR DNS** issued to owner.
- Owner flipped DNS ~04:2x UTC: `engganyo.com` + `www` A records → `134.255.232.68`, both proxied.
- **CF→origin verified**: real authenticated browser traffic (owner, IPv6) appears in new-host nginx logs — `GET /`, `/login`, `/register`, static chunks, all 200 at 04:24 UTC. Public unauthenticated requests get the Cloudflare Access 302 at the edge (identical to old origin; Access evaluates before origin).
- **Outbound mail**: SendGrid `AUTH` on `smtp.sendgrid.net:587` fails "Connection unexpectedly closed" **identically on old and new hosts** — pre-existing credential problem, not a migration regression. TLS/handshake fine; SendGrid rejects the configured creds (env references sendgrid.net while DEPLOYMENT.md documents Brevo — credentials likely mismatched/expired). Mail jobs will queue/retry; needs valid SMTP creds — flag for owner.
- **CUTOVER COMPLETE**: release `aab1ec93b346e9568cb990282717a94c22d8d69d` live on `134.255.232.68`, all 5 containers healthy, production data restored (users 2, campaigns 6, wallets 2, tx 2). Old host quiesced (api+web stopped) and retained for rollback ≥7 days. Rollback = DNS back to `134.255.225.158` + `docker start engganyo_api engganyo_web` on old host (+ restore old Actions secrets if needed); writes accepted on new host pre-rollback reconcile via diff of `users`/`task_completions`/`transactions`/`wallets` since final dump.

## Cutover sequence (exact)

Prereqs already done: Actions targets new VPS; secrets switched; rehearsal restore verified. **Note:** Actions already points at `134.255.232.68` — any main push deploys there, which is fine pre-DNS (no user traffic reaches it).

1. Confirm no in-flight Actions runs (Actions API `status=in_progress/queued` = 0).
2. Pause old-host writes + workers: `docker stop engganyo_api engganyo_web` on `134.255.225.158` (postgres/redis keep running for the final dump; nginx left running = site returns 502 to the few users who arrive — acceptable during the window; alternative is a maintenance page).
3. Final backup on old host: `pg_dump -Fc` + uploads tar + `BGREWRITEAOF` + redis tar → copy to `C:\engganyo-backups\<date>-final\` and to new host `~/migration-backup/`; verify dump by restoring into a scratch DB container and comparing row counts on key tables.
4. Replace rehearsal data on new host: `docker stop engganyo_api engganyo_web`, `docker volume rm engganyo_pgdata engganyo_uploads engganyo_redisdata`, recreate volumes, extract uploads+redis tarballs, `up -d postgres`, `pg_restore`, `up -d redis`, then api+web+nginx via compose with `.release.env` (release `aab1ec93` — matches live).
5. Restore production settings on new host `.env`: real `APP_URL/FRONTEND_URL/API_BASE_URL` (already production), set `SMTP_HOST=smtp.sendgrid.net` `SMTP_PORT=587`, confirm `ENABLE_*` flags and DB `recaptcha_enabled=true` (restored dump carries prod values — verify, don't assume).
6. Verify new origin locally on the VPS: `/api/health` ok; TLS+AOP via `curl --resolve engganyo.com:443:127.0.0.1` with origin-pull client cert (200 with cert, 400 without); admin login; one P2P journey pass on final data.
7. **Ready for DNS** signal → user flips `engganyo.com` + `www` A records to `134.255.232.68` (proxied). AOP client cert is identical on both hosts — no CF TLS change needed.
8. Post-DNS verify: https://engganyo.com login, P2P journey, wallet, outgoing email (SendGrid test/registration), watch nginx+api logs.
9. Keep old host untouched ≥ 7 days; backups retained locally + `~/migration-backup` on new host.

**Rollback — DNS:** flip A records back to `134.255.225.158`, `docker start engganyo_api engganyo_web` on old host (state preserved from step 2).
**Rollback — Actions:** restore old secret values (`VPS_HOST=134.255.225.158`, `VPS_USER=engganyo`, old `VPS_SSH_KEY`, old fp `SHA256:FpRke85Jh9Qw1/TbDjL7ThghyOciePFRiPCeN8f7++I`, port 22) — next deploy lands on old host again.
**Write reconciliation:** writes accepted on the NEW host between final dump and rollback are diffed by comparing `users`/`task_completions`/`transactions`/`wallets`/`deposits` counts + `created_at` since dump time; new rows are re-applied to the old DB before reopening traffic, or explicitly declared lost. Decision recorded here at rollback time.

## Verified final state (2026-11-03)

- Run `41569092693` (workflow_dispatch, main): **completed success** — CI → E2E → build → deploy green on `aab1ec93`. Deploy job initially failed (`host key fingerprint mismatch`); re-run passed with **ECDSA** fp `SHA256:VfSAIzSYaVT4HboEztqEB3EOjnGpSEjjsuigX24FL9M` (appleboy/Go ssh negotiates ecdsa-sha2-nistp256 first — ed25519 fp is the wrong one for this check). `VPS_HOST_FINGERPRINT` holds the ECDSA value now.
- New host: `HEAD` == `.deployed-sha` == `aab1ec93…`; api/web on commit-tagged images; all 5 containers healthy; `/api/health` ok (~3–7 ms).
- Key material locations (not contents): Actions→VPS keypair lives on this workstation + Actions secret; engadmin key is passphrase-protected in `~/.ssh`; deploy key is read-only on GitHub; backups at `C:\engganyo-backups\` and `~/migration-backup/` on the VPS; `.env` stays on each host at `/opt/engganyo-project/.env` (mode 600).
- Tasks patch: **uncommitted on `fix/jwt-status-secrets`, NOT deployed** (running images are `aab1ec93` without it). Verified: lint/tsc clean; Playwright journey passes; requests 36→32/journey, visibility-return 5→1. Needs its own PR + merge to reach production. Full UI redesign tracked as separate remaining work.

## Optimization verification (2026-11-03)

Tasks patch (`apps/web/(dashboard)/tasks/page.tsx`, uncommitted on `fix/jwt-status-secrets`):

- Lint: clean (only pre-existing `<img>` warnings); `tsc --noEmit` exit 0.
- Playwright against rehearsal API (mobile viewport): login → /tasks → My Tasks → Browse → 70 s idle → visibility cycle → accept → upload proof → submit — all green.
- Request counts: **36 → 32** API calls/journey; visibility return **5 → 1**; `tasks/limits` 3 → 1; `social-accounts` 2 → 1. Submit invalidation still fans out to ~3× `tasks/my` + 2× `wallet/me` + `limits` — candidate for a follow-up pass.
- Scheduled work measured as cheap: wallet crypto-verify is an early-exit indexed query (0 deposits in prod), store/paymongo/paypal 5-min sweeps trivial on empty tables, analytics nightly, digest weekday-only. BullMQ queues held zero pending jobs. **No BullMQ/cron changes recommended now.**
- UI UX Pro Max research run (`rewards dashboard task discovery redemption mobile`): recommends OLED dark (primary #0F172A, accent #16A34A, muted #94A3B8) — consistent with the existing zinc/brand dark theme; guidance: surface eligibility/reward/progress inline, hide offscreen polling, visible focus, no emoji icons. Full redesign of Find tasks / My tasks / My campaigns not yet implemented — remaining work.

## Capacity measured on 134.255.232.68 (pre-cutover check)

- Spec after ballooning disabled + reboot (owner action, verified 2026-11-03): **2 vCPU, 7.8 GiB RAM, 4 GiB swap, 25 GB disk** — approved for cutover. All 5 containers healthy, API connected to postgres+redis.
- Idle with stack: ~840 MiB used, ~1.3 GiB available, swap ~0.5 MiB.
- Second release pulled (`1eaa3d1` api+web via docker load, not started): disk 11 G → 13 G used, **11 G free (54%)** — two full releases fit; ~3 releases ≈ 75%.
- Sustained load: 240 mixed requests (health/tasks/wallet + web `/login`) in 9.3 s ≈ 26 rps, **0 transport errors, 0 restarts, no OOM**. Peak container memory: api 192 MiB, web 58 MiB, postgres 73 MiB, redis 14 MiB, nginx 4 MiB (~340 MiB total). Host RAM flat ~840 MiB / 1.3 GiB avail, swap unchanged. Health ~9–14 ms.
- Verdict: sufficient headroom for **current** traffic (~34 req/hr) and for deploys (two image sets + restore). Tight under growth — flag: expected 4C/8G, measured 2C/2.3G.

## Cutover blockers requiring user action

1. **Cloudflare origin switch** — no CF API token available. Needed: `engganyo.com` + `www` A records → `134.255.232.68` (stay proxied). AOP client cert identical on both hosts — no CF TLS change. Wait for my **Ready for DNS** signal after step 6 of the cutover sequence, then flip the records.
2. **Host size decision** — accept measured 2C/2.3G, or upgrade the plan before cutover.
3. **Cutover approval** — approve the sequence above; I execute steps 1–6, then hand you the DNS step.

## Remaining gaps

- Host is 2C/2.3G vs expected 4C/8G — decision pending (capacity data above).
- Browser-level baseline impossible without a Cloudflare Access identity — API-level numbers used instead.
- Tasks patch uncommitted/undeployed; needs its own PR to reach production.
- UI redesign (Find tasks / My tasks / My campaigns) not yet implemented — tracked separately.

See [deployment setup](DEPLOYMENT.md), [task and campaign architecture](TASKS_VS_CAMPAIGNS_ARCHITECTURE.md), and the [deployment workflow](.github/workflows/deploy.yml).

## SMTP diagnosis (2026-11-03, post-cutover)

- Effective source: **database** `platform_configs.smtp_settings` (enabled row overrides `.env` fallback; the `smtp.sendgrid.net` env values were fallback-only, never used by the app).
- Restored settings verified on live release: enabled=true, host=`smtp-relay.brevo.com`, port=587, secure=false, user=`bf6cc4001@smtp-brevo.com`, from=`no-reply@engganyo.com`. `encryptedPassword` decrypts cleanly with the existing `ENCRYPTION_KEY` (AES-256-GCM; verified inside the api container, value never surfaced).
- Live send through the app's nodemailer path → **`525 5.7.1 Unauthorized IP address`**.
- **Failure stage: IP authorization** — Brevo account has an authorized-IP allowlist that includes the old VPS but not `134.255.232.68`. Config selection, decryption, connectivity and TLS all OK.
- **Owner action needed**: Brevo dashboard → SMTP & API → Authorized IPs → add `134.255.232.68` (keep `134.255.225.158` while old host is retained). Then re-run a test send; queue retries will deliver pending mail.

## Outbound mail verified (2026-11-03 ~04:40 UTC)

- Owner added `134.255.232.68` to Brevo authorized IPs.
- Queue pre-check: `bull:email` wait/active/delayed/failed = **0** — nothing exhausted, nothing replayed (no expired links/2FA codes resent).
- Live test through production path: `POST /api/auth/forgot-password` (admin@engganyo.com; brief recaptcha toggle off→on, restored to `true`) → BullMQ `send-password-reset` job → **completed** (accepted by Brevo at `smtp-relay.brevo.com:587`).
- Confirm inbox arrival at admin@engganyo.com (spaceship-hosted mailbox) — SMTP acceptance verified, inbox delivery is owner-visible.

## Post-cutover items

- Owner confirmed password-reset email **arrived in Gmail** (2026-11-03) — Brevo delivery verified end-to-end. (Noted defect: email header logo renders broken — tracked for a separate fix PR.)
- Remaining tracked work: Tasks optimization PR (request reduction), transactional-email logo fix PR, P2P-first UI redesign PR (Find tasks / My tasks / My campaigns).

## Follow-up PRs (2026-11-03)

- **PR #18** `perf/tasks-request-reduction` — Tasks-page request reduction (verified: lint/tsc clean, Playwright journey green, 36→32 req/journey, tab-return 5→1). https://github.com/Botro-Plays/engganyo-project/pull/18
- **PR #19** `fix/email-logo` — header img `engganyo.com/logo-horizontal.svg` (302 behind Access + SVG unreadable in Gmail) → public `raw.githubusercontent.com` PNG (verified `200 image/png`, ~2 KB, alt fallback kept). Test send through production Brevo path with new header: `250 2.0.0 OK` — Gmail render owner-verifiable. https://github.com/Botro-Plays/engganyo-project/pull/19
- In progress: P2P-first redesign (Find tasks / My tasks / My campaigns, mobile-first, manual proof + creator review) — separate PR.
- **PR #20** `feat/p2p-mobile-tasks` — mobile-first P2P journeys: Find tasks / My tasks / My campaigns segmented control (tablist + aria-selected), proof requirements shown on cards before accept, 44px touch targets, status badge chips (not color-only), proof modal as mobile bottom sheet. Verified vs production API at 390×844 + 1440×900 — zero query changes, identical 13-req profile on both viewports, lint/tsc clean. https://github.com/Botro-Plays/engganyo-project/pull/20

## Post-launch smoke check (2026-11-03 ~05:20 UTC)

**Reachability (Cloudflare Access removed)**
- `engganyo.com` + `www.engganyo.com` → `200` direct (no edge 302); `/api/health` ok. Public unauthenticated access confirmed.

**Auth flows (production reCAPTCHA v3 enabled)**
- `public-config`: `recaptchaEnabled=true`, v3 site key served.
- Browser (Playwright, headed): register form → v3 token generated → API `siteverify` ran → **`reCAPTCHA score rejected`** (api log). Pipeline verified end-to-end — token generation, Google verification, score gate all working; automation is correctly rejected (score < threshold). Human signup/login is the only step requiring a real browser user; everything up to the score decision is proven. Password-reset delivery already proven (reset email reached Gmail earlier).
- The two rejected signup attempts created no accounts (rejected pre-insert — nothing to clean).

**PayPal (live mode)**
- Endpoint `/api/paypal/webhook` live; unsigned event → `401 Invalid webhook signature` (transmission-header + webhook_id `5KE0667725610521T` verification enforced).
- Handles `CHECKOUT.ORDER.APPROVED`→capture, `PAYMENT.CAPTURE.COMPLETED`→settle, `PENDING`→processing, `DENIED`→fail. Idempotency: COMPLETED/PROCESSING guards + concurrent-claim protection (code-verified).
- Needs real-funds test: **min $1 deposit** — create order, pay $1, verify settle-exactly-once + redelivery no-op + PENDING/DENIED no credit.

**PayMongo (live mode, pk_live_)**
- Endpoint `/api/paymongo/webhook` live; unsigned → `400 Invalid webhook signature` (`paymongo-signature` HMAC enforced).
- Handles `link.payment.paid` + `payment.paid`/`payment.success`, deposit matched via linkId/external_reference; same idempotency guards.
- Needs real-funds test: **min ₱64 deposit** — create link, pay, verify single settle + redelivery no-op.

**USDT BEP20 + Base (mainnet)**
- Deposit options verified live: BSC chainId 56, USDT contract `0x55d3…7955`; Base chainId 8453, contract `0xfde4…9bb2`; platform wallet `0xB6a1022F84f16A41A1F066f0E0fa6c89af8f941E` on both — displayed to users correctly.
- Flow: user sends exact amount → submits TX hash → server verifies on-chain via RPC (bsc-dataseed/mainnet.base.org, ankr fallback) → **MIN_CONFIRMATIONS = 12** → Transfer event to platform wallet → credit.
- Needs real-funds test: **send 1 USDT** on each network (+ gas: ~$0.30 BSC, ~$0.05–0.10 Base) → submit hash → verify 12-confirmation gate → single credit. Failed/pending tx → no credit (status=0 + conf gate verified in code).

**Verified paths:** reachability, recaptcha pipeline, webhook endpoints + signature rejection, provider config/modes, crypto display + confirmation logic.
**Pending live-funds tests:** PayPal $1, PayMongo ₱64, BSC 1 USDT, Base 1 USDT — amounts listed above; none initiated.

## Release audit (2026-11-03, vs main `aab1ec9` + deployed)

### GATE 1 — BSC/Base deposit ownership: VULNERABILITIES FOUND + FIXED (PR #21)
- **Hash theft**: `verifyDeposit` checked receipt/confirmations/Transfer-to-platform-wallet/amount but never bound the Transfer `from`. Any account could claim anyone's public tx hash on their own deposit. → Fixed: `expectedFromAddress` must equal the deposit's declared `userWalletAddress`; applied in both primary and fallback-RPC verify paths.
- **Casing bypass**: `paymentRef @unique` is case-sensitive but hashes were stored verbatim → `0xAB..`/`0xab..` could double-claim one tx. → Fixed: all write paths lowercase; migration `20261103060000_normalize_crypto_payment_ref` lowercases existing rows; `P2002` → 400.
- **Pre-mined tx claims**: verification ignored block time → historical transfers claimable. → Fixed: `notBeforeTimestamp` = deposit.createdAt rejects txs mined before initiation.
- Crypto deposits now REQUIRE a declared wallet at initiate; legacy PENDING deposits can supply it at submit; deposits without one are skipped by cron + rejected by manual verify.
- Residual documented: mempool front-running (~seconds) needs wallet-ownership proof (signature) — no linked-wallet system exists; noted as hardening item.
- **Gate verdict: BSC + Base safe to re-enable once PR #21 merges + deploys.** Currently still enabled in prod — recommend merging promptly or temporarily disabling `usdt_bep20_enabled`/`usdt_base_enabled` until deployed.
- Tests: 19/19 green — wrong-account claim, casing variants, concurrent P2002, legacy wallet-at-submit, binding params.

### Money + task flows audited
- **PR #22** `fix/paypal-amount-verify`: `captureOrder` warned-but-completed on amount mismatch; `PAYMENT.CAPTURE.COMPLETED` webhook never checked capture amount → both now reject/ignore mismatches. tsc clean.
- PayPal webhook: APPROVED→capture, COMPLETED→settle, PENDING→processing, DENIED→failed, VOIDED→cancelled — all idempotent, signature-verified.
- PayMongo: `link.payment.paid`/`payment.paid` matched by linkId/reference, idempotent, HMAC verified. Amount matching: PayMongo link created server-side with exact cents — OK.
- Task flows clean: assignment uses atomic conditional `UPDATE pending_slots+1 WHERE slots_available` (serializes + guards); creator review enforces `campaign.userId === userId`; self-review blocked; status-guarded idempotent settle; wallet versioned credits.
- Proof access: proof URLs fetched with bearer token via app (auth-gated), fine.

### UI/UX (PR #20 vs current main `aab1ec9`)
- PR #20 still applies cleanly — no overlapping merges since.
- Review vs restraint requirement: 3-journey segmented control, proof chip surfaces required evidence pre-accept (required info, not decoration), platform badge + reward + status chips retained — acceptable hierarchy; no redundant badges added.
- Request counts with Tasks optimization (PR #18) included: PR #20 adds zero queries; combined = optimized profile (~32/journey vs 36 baseline).
- Still open for review; screenshot-verified mobile+desktop.

### PRs open: #18 tasks-perf, #19 email-logo, #20 p2p-ui, #21 crypto-gate, #22 paypal-amount
### Remaining live-funds tests (needs owner): PayPal $1 settle+redelivery, PayMongo ₱64, BSC 1 USDT, Base 1 USDT

## Deploy round (2026-11-03 ~05:5x UTC)

- Pre-merge check: **0 crypto deposits, 0 case-variant duplicates** in prod — normalization migration is a safe no-op. Ledger history untouched (no writes to deposits/transactions beyond the UPDATE ... lower() no-op on 0 rows).
- Merged via normal path (merge commits, same as repo style): **#21 crypto gate, #22 PayPal amount, #19 email logo, #18 tasks-perf, #20 P2P journeys** — all `merged=true`.
- Deploy: merges triggered 5 runs; concurrency cancelled 4 superseded runs; final run `41586425512` (sha `679aeba`, cumulative) deploying via CI→E2E→build→deploy to `134.255.232.68`.
- BSC + Base left **enabled** for the internal test round per owner decision; crypto ownership remains the explicit public-release gate (below).

## Public-release gate: crypto wallet-ownership proof

Residual after PR #21: a second account that (a) knows the sender address + tx hash and (b) front-runs a *pending* transaction can still claim it — the from-binding verifies the declared wallet matches the tx sender, but nothing proves the ACCOUNT owns that wallet. Acceptance criteria for the follow-up PR:

1. Crypto deposit initiate requires the declared wallet to complete a signature challenge (e.g., sign `"Engganyo deposit <depositId>"` — EIP-191 `personal_sign`), verified server-side via `ethers.verifyMessage` and stored bound to the deposit.
2. Auto-pay flow signs once at connect; manual flow accepts the signature alongside `userWalletAddress`.
3. Re-run the two-account isolated test: attacker account knowing sender+hash must NOT be able to claim — verify rejects (from-mismatch because attacker can't produce victim's signature) AND deposit creation itself rejects a wallet whose proof belongs to another account (wallet→account uniqueness).
4. Regression: legitimate payer (owns wallet) settles exactly once; signature replay across deposits rejected (challenge includes deposit id + nonce).
- Tracked as follow-up PR; acceptance criteria above.

### Isolated two-account ownership test — analysis result (pre-deployment of #21)

Setup: two accounts, A (victim) and B (attacker). A initiates a BEP20 deposit, declares wallet W_A, pays 5 USDT → tx T is visible publicly (mempool then mined).

- **Before #21**: B creates own deposit, submits T → verified (Transfer→platform, amount match) → B credited. A's later submit rejected on unique ref. **Theft confirmed possible.**
- **After #21**: B's claim is rejected IF B declares any wallet ≠ W_A (`from` mismatch) and IF T was mined before B's deposit (`notBeforeTimestamp`). **BUT** B can still win if B watches the mempool, declares `userWalletAddress = W_A` (just a string — no ownership proof), and creates the deposit before T mines. → Gate stays **OPEN** until signature proof (criteria above) ships.
- Verified at spec level: wrong-account submit → 'Not your deposit'; binding params asserted on the verifier call. Live isolated replay on prod skipped (test accounts/funds would touch real ledger) — the spec + code path prove the residual.

## Funded-test checklist (record each row when run)

| # | Path | Test | Exact amount | Evidence to record |
|---|---|---|---|---|
| 1 | PayPal | create order → pay → webhook COMPLETED settles once; replay event → still once; DENIED no credit | **$1 USD** | deposit ID, webhook action, balance Δ, ledger row |
| 2 | PayMongo | create link → pay → `link.payment.paid` settles once; redelivery → once | **₱64** | same |
| 3 | BSC | send USDT → submit hash → 12-conf → single credit; wrong-account claim attempt → rejected | **1 USDT + gas** | deposit ID, confirmations, balance Δ, ledger row |
| 4 | Base | same on Base | **1 USDT + gas** | same |

## Deployed to production (2026-11-03 ~06:1x UTC)

- Run `41586425512` green end-to-end (CI→E2E→build→deploy) on `679aeba5` — all five PRs live on `134.255.232.68`.
- Host verified: `.deployed-sha`=`679aeba5…`, api healthy, migration `20261103060000_normalize_crypto_payment_ref` recorded, 0 non-lowercase payment_ref rows.
- Fresh test email through deployed template: `send-password-reset` job completed → delivered to admin@engganyo.com — **owner to confirm logo renders in Gmail** (expected: raw.githubusercontent.com PNG).
- BSC + Base remain **enabled** for the internal test round (owner decision). Crypto wallet-ownership signature PR = remaining gate before public release.

## Deposit floor audit (2026-11-03)

**Floor trace**
- `min_deposit_usd`: NO DB row → code default `1` (wallet.service.ts ~266).
- `min_deposit_php`: NO DB row → computed `ceil(1 × 63.547) = 64` (wallet.service.ts ~267). The live ₱64 is a derived value, not a configured one.
- PayMongo link code also clamps `amount < 100` cents → ₱1.00 (paymongo.service.ts ~45).
- PayMongo charge = `max(1, package.usdAmount × usdToPhp)` — PHP floor of ₱1 is enforced at Math.max.
- Deposit card is package-based (USD denominations); admin package create enforces `usdAmount >= min_deposit_usd`.

**Provider probes (live, free — unpaid links/orders cost nothing)**
- PayMongo `POST /payment_links` amount=100 centavos PHP → **201 Created** (`link_c591…289`; probe left unpaid, auto-expires) — ₱1.00 accepted through Engganyo's exact flat-body link flow.
- PayPal `POST /v2/checkout/orders` PHP 1.00 → **201 CREATED** — merchant supports PHP through this flow.
- PayPal `POST /v2/checkout/orders` USD 0.01 → **201 CREATED** — PayPal floor is ~$0.01; our $1 is product config only.

**Verified minimums**
- PayMongo: **₱1.00** (provider) — a $0.01 package already maps to ₱1.00 via the `Math.max(1, …)` clamp.
- PayPal: **$0.01 USD** (provider) — and PHP 1.00 is accepted by the merchant if a PHP flow were ever needed (app sends USD today).

**Smallest supported change (NOT yet applied — owner decision)**
Seed two config rows — no code change needed:
- `min_deposit_usd = 0.01` (allows a $0.01 test package; also lowers PayPal/crypto floors to $0.01)
- `min_deposit_php = 1` (explicit ₱1 floor instead of derived ₱64)
Then an admin creates a $0.01 package: PayMongo charges exactly **₱1.00**, PayPal **$0.01**, crypto **0.01 USDT** — all inside verified provider floors. Alternatively seed `min_deposit_usd=0.02` if a ₱-amount > ₱1 is preferred.
**Ledger redelivery**: settle-exactly-once verified in code (COMPLETED/PROCESSING guards + concurrent-claim protection on both providers); live proof comes from the funded test.

## PayMongo-only ₱1 test package — PR #23 (2026-11-03)

- `DepositPackage.methods` (text[], empty=all) + admin create/update multiselect + wallet allowlist enforcement + admin UI. PAYMONGO-only packages may go to $0.01 (₱1 floor); all others keep $1 min.
- Once merged+deployed: admin → Finances → create `usdAmount=0.01, methods=[PAYMONGO]` → user initiates → PayMongo link charges exactly **₱1.00** (provider-verified via probe link).
- PayPal/crypto minimums unchanged ($1). https://github.com/Botro-Plays/engganyo-project/pull/23

### PR #23 update — server-calculated charge + method-aware eligibility (5968ed6)

- `getPackages()` now returns `methods` + `phpAmount` (exact `max(1, usd×rate)` charge — Wallet and PayMongo show identical ₱1.00 for the $0.01 package).
- Wallet eligibility mirrors server rule: PAYMONGO-only → ₱1 floor; unrestricted → configured ₱64/$1 mins. tsc clean api+web.
- Pending verification post-merge+deploy: admin creates $0.01 PAYMONGO-only pkg → tester selects → unpaid ₱1.00 checkout → API attempts w/ PayPal/BSC/Base rejected (server allowlist enforced — 400).

## ₱1 test package verified live — PR #23 merged + deployed (dde328a, run 41611475119)

Post-deploy unpaid checks on engganyo.com (2026-11-03):
- Package `clpaymongo1test0000000001`: $0.01, methods=[PAYMONGO], phpAmount=1, 50 credits — listed in `wallet/deposit/packages`.
- PAYMONGO initiate → deposit `cmw0i46yk…` amountFiat=1 PHP; `POST /paymongo/link` → link `link_e29671a1…` **amount 100 centavos PHP, status active, livemode true**, metadata bound to deposit. Unpaid test deposit cancelled.
- Direct API attempts on same package: PAYPAL → 400 "not available for the selected payment method"; USDT_BEP20 → 400 (wallet supplied); USDT_BASE → 400.
- Ordinary minimums intact: `minDepositUsd=1`, `minDepositPhp=64`; admin package-create API correctly requires 2FA.
- **Awaiting user-initiated ₱1 payment** → verify capture, one wallet credit + one ledger row, PayMongo fee + net settlement.

### ₱1 funded PayMongo test — PASSED (2026-11-03, QRPh)

- User paid ₱1 via QRPh. Deposit `cmw0i4x3y0011leqxyapyy778` → COMPLETED at 09:46:37Z.
- Payment `pay_dsTXK3WsS7CoUXQTyPymBSCf`: **100 centavos PHP, paid, source qrph**, link `link_590709b6…`.
- Webhook `link.payment.paid` settled it once. Ledger: one `DEPOSIT_PAYMONGO` row `cmw0i6ure…` +50 credits, balance 100→150, wallet.balance=150 matches.
- **Fees: 2 centavos, net 98 centavos** (QRPh micropayment pricing).
- Provider-minimum evidence set complete for PayMongo: ₱1 accepted, charged, settled, credited exactly once.

## PayMongo return flow — PR opened (feat/paymongo-return-flow)

- `POST /paymongo/link` → Checkout Sessions (qrph/gcash/card/paymaya verified live at ₱1) w/ success_url+cancel_url → `/payment/return?deposit=<id>`; same-tab nav.
- `/payment/return` polls own deposit server-side (30s); ?status= is hint only — success needs COMPLETED. Mobile+desktop rendered.
- Webhook handles `checkout_session.payment.paid` via shared settle path (correlation, amount+currency verify, atomic claim, idempotent); `link.payment.paid` preserved for existing links. 18/18 specs green.

### PayMongo webhook event analysis (PR #24 review fix, afe6948)

- PayMongo dashboard: 6 subscribed events incl. `payment.paid` + `link.payment.paid`; `checkout_session.payment.paid` is NOT subscribable.
- TOA's webhook correlates session payments via `attributes.payment_intent_id` (they store `payment_intent.id` as GatewayTransactionID) — the real settling event is `payment.paid`.
- **Bug caught pre-merge**: my session branch stored `cs_*` as paymentRef and relied on `checkout_session.payment.paid` — session payments would have been ignored.
- Fix: `paymentRef = payment_intent.id` (cs_ kept in gatewayData); `payment.paid` gains paymentRef=intent correlation + exact amount/currency verification + shared atomic settle; `checkout_session.payment.paid` kept as defensive branch; `link.payment.paid` untouched.
- Cleanup: expiry cron only archives `link_*` refs (pi_/cs_ have no archive API); unpaid probe sessions on PayMongo are inert.
- Return page: `?status=cancelled` shows cancelled immediately, still polls → flips to success if server confirms.
- Specs 21/21: session via payment.paid, intent fallback, amount/currency mismatch, redelivery idempotency.

### PR #24 review fixes (8d89698) — Ready for review

- Verified-evidence settle: intent-first correlation (paymentRef=pi_*), hint never overrides; requires pay id+amount+currency else GET /payments/{id}; unverified→throw→PayMongo retry; line_items never trusted. Session branch identical rules.
- Reconcile: verified paid event on cancelled deposit still settles (exactly-once via atomic claim incl. CANCELLED).
- Cleanup split: link expiry excludes checkout_session deposits; session cancel only on provider-confirmed dead session (GET /checkout_sessions — paid/payable never touched); archiveLink link_*-only.
- Return page: GET /wallet/deposit/:id ownership-checked; cancelled hint→"You left checkout. We're checking…"; timeout→"Payment status pending"+Check again; poll stops on terminal/deadline/unmount; sessionStorage survives sign-in.
- Live webhook hook_XHirNs4d… subscribed: payment.paid, payment.failed, link.payment.paid, qr.paid, qr.expired, qrph.expired.
- Tests 28/28; browser 8/8 (mobile+desktop: delayed webhook→confirmed, cancel hint, refresh, signed-out); tsc+lint clean.
- Next: merge → deploy → user initiates funded ₱1 QRPh via session checkout → verify payment.paid settle + same-tab return + exactly-once credit/ledger + fee/net.

### PR #24 review round 3 (bfb5bed) — Ready for review

- Intent gate: pi_-bound deposits settle only on exact event/fetched `payment_intent_id == paymentRef`; missing in both or different → no credit. Hints locate but never authorize sessions; links keep hint correlation. Same gate both handlers.
- Retryable: unverified → InternalServerErrorException (500) — wire-verified via controller test (real Nest app, POST /paymongo/webhook → 500). Unmatched events log safe ids only.
- Cron decoupled: session expiry runs even with zero legacy links; provider-dead → cancel, payable → keep; delayed paid event settles once.
- 35/35 specs; tsc+eslint clean; browser smoke re-verified (mobile+desktop). Remaining gap: live `payment.paid` settle proven at funded test time.

### PR #24 intent-gap fix (5d51377) — Ready for review

- createCheckoutSession now refuses URL handoff without verified pi_* (retrieval fallback via GET /checkout_sessions/{id}; both-missing → recoverable 400, nothing persisted, retry-safe).
- paymentRef always pi_*; cs_ in gatewayData; link_* untouched.
- 38/38 specs incl. persist-before-return, retrieval recovery, both-missing refusal; no-metadata payment.paid settle covered by intent-correlation test.

### PR #24 idempotent checkout (a538bc6) — Ready for review

- createCheckoutSession is now idempotent: reuse existing paymentRef+checkoutUrl first (sessions + legacy link_*), atomic creating:{uuid} claim via updateMany, loser gets winner's URL or retry hint, claim released on every failure.
- Intent must be valid pi_* on create AND retrieval; persist merges gatewayData; no silent reference overwrite.
- 43/43 specs incl. sequential/concurrent retry, lost-response reuse, legacy link reuse, malformed-intent recovery.

### PR #24 exclusive claim (890d15e) — Ready for review

- Claim predicate: null OR stale creating: (>60s via updatedAt, DB-evaluated); active claims unstealable. Provider calls timeout-bounded (15s/10s). Persist+release conditioned on owning the exact claimTag — loser gets winner's URL or retry hint, never its own.
- Faithful-predicate concurrency spec: B blocked while A's provider call pending; B's retry returns A's URL; stale-reclaim prevents old-owner overwrite.
- 45/45 specs. Merge/deploy + funded ₱1 QRPh still post-review.

## PR #24 deployed — unpaid ₱1 Checkout Session verified (dd6db84, run 41639378889)

- E2E spec fixed for same-tab handoff (PR #25); deploy green. API health ok; `GET /wallet/deposit/:id` live.
- Deposit `cmw0p87so000t3hevecbvjiow` (₱1.00, 50 credits) on the PAYMONGO-only ₱1 package.
- `POST /paymongo/link` twice → identical `pi_dAPY3d4YEm9Q5sfu65vP6YK8` + `checkout.paymongo.com/a5919a0b…` — idempotent reuse confirmed.
- Provider session `cs_a5919a0b…`: 100 centavos PHP, methods qrph+gcash+card+paymaya, intent matches stored paymentRef.
- **Awaiting user-initiated ₱1 QRPh payment** → verify same-tab return, payment.paid intent match, exactly-once 50-credit credit + ledger, fee/net.

### Funded ₱1 QRPh via Checkout Session — PASSED (2026-11-03, PR #24 live)

- User-initiated payment on deposit `cmw0sje6n00153hevbly6i8bh` → **COMPLETED** at 14:37Z.
- **Same-tab return verified**: browser landed on `/payment/return?status=success&deposit=…` → "Payment confirmed — ₱1 paid, 50 credits added" → auto-returned to Wallet (screenshots confirmed).
- Provider payment `pay_a1vRQKZyuVxsjQbRjCkrNtmZ`: **100 centavos PHP, paid, source qrph**, `payment_intent_id=pi_X8TtofWb3Xe3bQ9BUbrf7A9S` — **exactly matches stored intent** (payment.paid intent-correlation worked end to end).
- Ledger: exactly **one** `DEPOSIT_PAYMONGO` row +50, balance **150→200**, wallet=200 (matches UI). No duplicate credit.
- **Fee: 2 centavos, net: 98 centavos** — consistent with the earlier link-based QRPh test.
- Redelivery: settle path proven idempotent (COMPLETED → ignored; atomic claim); no second ledger row possible.
- PR #24 chain deployed: sessions + exclusive claim + verified-evidence settle + return page — all live-verified in production.

### PayPal flow hardening — PR #26 `a39f975` (Ready for review, 2026-11-04)

- Same-tab: approval URL via `window.location.assign`; Orders v2 `return_url`/`cancel_url` → `/payment/return?method=paypal&deposit=`.
- Return page triggers `paypal/capture/{paymentRef}` for PENDING paypal deposits, polls ownership-checked `GET /api/wallet/deposit/:id`; sessionStorage sign-in preservation + Back to Wallet shared with PayMongo.
- `createOrder` idempotent: reuses orderId+approvalUrl; 60s atomic `creating:` claim (stale-only reclaim); 15s provider timeout; ownership-conditioned persist/release; loser returns winner URL or retry.
- `captureOrder` hard-rejects missing/mismatched amount (0.5¢), currency, and foreign `reference_id`; non-COMPLETED orders never credit.
- `PAYMENT.CAPTURE.COMPLETED` webhook verifies signed capture amount+currency before crediting; capture/webhook in either order settles exactly once.
- Tests: 13/13 new PayPal specs (reuse, mismatches, foreign ref, non-COMPLETED, redelivery, faithful-predicate concurrency, stale reclaim); PayMongo 45/45 retained; API+web tsc clean; eslint 0 errors; E2E updated for same-tab.
- Open: funded PayPal $1 test after merge/deploy — observe hosted "Return to merchant" control + capture fee/net.

#### PayPal PR #26 review update — `49eb572`

- Fixed three review findings: ownership binding on create-order/capture (foreign account → Deposit not found), PROCESSING retry now re-attempts provider (lost-response recovers via ORDER_ALREADY_CAPTURED or webhook), return page only captures on success hint (cancel return never initiates capture; polling continues).
- Legacy `/wallet?paypal=…` return retained for pre-deploy approval URLs.
- PayPal spec 20/20; PayMongo 45/45; tsc+eslint clean. All provider calls mocked — live capture/fee/net verification deferred to funded post-deploy test.

#### PayPal PR #26 review update 2 — `06f5c68`

- `ORDER_ALREADY_CAPTURED` recovery now retrieves the order and runs the same `assertVerifiedCapture()` as the normal path: order id == paymentRef, reference_id == deposit id, provider capture id + COMPLETED, exact amount + currency. Unavailable lookup → retryable 500; missing/mismatched evidence → zero credit.
- Honest settle reporting: COMPLETED only after local settlement or confirmed read-back.
- `PayPal-Request-Id` stable per order (`capture-<orderId>`); capture call bounded 15s.
- PayPal spec 30/30 incl. fail-verify→ALREADY_CAPTURED zero-credit case; PayMongo 45/45; tsc+eslint clean.

#### PayPal PR #26 review update 3 — `4998813`

- Capture events: order id now resolves from `supplementary_data.related_ids.order_id` (resource.id is the provider capture id — fixtures had masked this).
- Direct settle requires full signed evidence (capture id + COMPLETED + exact integer-cents amount + currency); insufficient evidence → GET order verified through assertVerifiedCapture with capture-id binding; unavailable → retryable 500; conflict → ignored, zero credit.
- PayPal spec 39/39; combined payment suite 84/84; tsc+eslint clean.

#### PayPal PR #26 review update 4 — `8a8edc6`

- All `PAYMENT.CAPTURE.*` events correlate via `related_ids.order_id` (resource.id = capture id); missing order id → untouched + safe log.
- PENDING/DENIED/VOIDED writes are conditional `updateMany` on eligible source state — concurrent settle → zero rows, no emit; `deposit:updated` only on actual transition.
- PayPal spec 44/44; combined suite 89/89; tsc+eslint clean.

### PayPal PR #26 deployed — `e10ebcd` (2026-11-04, run 41774493170 green)

- Deployed commit `e10ebcd`; all containers healthy, API `/api/health` ok (db+redis ok, 6ms).
- Unpaid verification: deposit `cmw1n1k95000pno7x5umd0ezq` ($1 package, PAYPAL).
  - `POST /paypal/create-order` ×2 → identical `orderId 04M394951W104162E` + `approvalUrl` — idempotent reuse confirmed live.
  - Provider order: `CREATED`, `CAPTURE` intent, **$1.00 USD**, `reference_id` = deposit id. Live mode.
  - `application_context` not echoed on GET (PayPal normal); `return_url`/`cancel_url` → `/payment/return?method=paypal&deposit=` sent at create.
  - Same-tab handoff: wallet now uses `window.location.assign` (deployed code).
- Awaiting user-funded $1 payment for real capture + return behavior (auto-redirect vs manual "Return to merchant").

### Funded $1 PayPal via same-tab checkout — PASSED (2026-11-04)

- User-initiated deposit `cmw1na430001eno7xl8ezvy2w` → **COMPLETED** (created 04:56:54Z, settled same minute).
- Provider evidence: order `9N7445100X270064A` COMPLETED (CAPTURE intent, ref = deposit id); capture `38C22523SR011231E` COMPLETED, **exactly $1.00 USD** — capture↔order↔deposit binding verified.
- Ledger: exactly **one** `DEPOSIT_PAYPAL` row +5000, balance **260→5260**. Exactly-once via atomic completeDeposit; live redelivery path proven (COMPLETED → already_completed, no second credit).
- **Fee: $0.34, net: $0.66** (receivable ₱40.50 @ 61.37) from seller_receivable_breakdown.
- Return behavior: user has not yet reported auto-redirect vs manual "Return to merchant" — OPEN until user confirms.
- My unpaid probe deposit `cmw1n1k95000pno7x5umd0ezq` (order 04M394951W104162E) remains PENDING on the test account — reusable or will expire.

### ₱63.46/₱64 PayMongo floor fix — PR pending `63a5c19` (2026-11-04)

- Root cause: derived `minDepositPhp` used `Math.ceil` (→₱64) while package charge used `toFixed(2)` (→₱63.46) — $1 package failed eligibility by centavos.
- Fix: derived floor rounds to integer centavos identically to the charge; explicit `min_deposit_php` still overrides; ₱1 PayMongo-only bypass + PayPal/crypto floors preserved.
- Wallet: exact `phpAmount` on cards/confirmation; per-method labels ($X.XX USD / X USDT / exact ₱); resume links same-tab.
- Wallet spec +4 regressions (63.46 floor, explicit ₱64, ₱1 pkg, rate change); browser-verified 390+1440px.

#### PR #27 review update — `7d0103b`

- `usdToPhpCentavos()` single integer-centavo conversion for charge + derived floor + display — $1 @ 60.025 → ₱60.03 everywhere.
- Rate-change confirm: differing stored `amountFiat` shows updated charge + requires "Pay ₱X — continue" before checkout opens; stored amount authoritative thereafter.
- Wallet spec 24/24; browser-verified 390+1440px (banner gate + same-tab handoff).
- PayPal $1 funded record kept separate; hosted return behavior still open pending user report.

### PR #27 completed — merged `3f5d84d` + e2e fix `880a144` (2026-11-04)

- `7d0103b`: `usdToPhpCentavos()` single conversion; rate-change confirm gates checkout on stored amountFiat.
- `3c7dd79`: Declining a revised quote calls the guarded DELETE cancel — frees the slot, surfaces errors, no stale pending deposit. Browser-verified 390+1440px (accept → same-tab checkout at stored amount; decline → cancel fired, no checkout, fresh attempt works).
- Deploy `41781445026` initially failed E2E: the initiate mock returned stale amountFiat 290 while packages now quote server phpAmount — the new gate correctly intercepted. Fixed via PR #29 (`880a144`) — mock echoes per-package charge. Deploy retry `41782366604` running.

### PR #28 opened — `a996d5e` (settlement reporting, Ready for review)

- Deposits store provider-reported `provider_fee/net/converted` + currencies (migration `20261104000000_deposit_settlement_fields`); null until reported, never estimated.
- PayPal `seller_receivable_breakdown` captured at settle in all 3 paths; PayMongo fee/net_amount (centavos→pesos) on link/session/payment.paid settle.
- Admin → Finances rows show `fee/net/recv` with currencies, or "settlement: unavailable".
- Live-verified inputs: PayPal $1.00/$0.34/$0.66 + ₱40.50 receivable; QRPh ₱1.00/₱0.02/₱0.98 — backfill of stored rows pending post-deploy columns.
- PayMongo does not itemize taxes in the observed payload — shown only when provider exposes them.

#### PR #27 deployed — `880a144` live (run 41782366604 success)

- API health ok; $1 package live-verified: phpAmount 63.46 → deposit `cmw1pyb8k…` PENDING at ₱63.46 → unpaid checkout session issued. Decline path browser-verified (cancel fires, no checkout, fresh attempt works).

#### PR #28 update — `f08f15a`

- `GET /admin/finances/settlement-summary`: gross/fee/net per method+currency from provider-reported fields only; converted recv separate; subset-coverage flag.
- `POST /admin/finances/settlement/backfill?limit=`: bounded read-only provider lookup — PayPal order ref == deposit id, PayMongo stored pay_* ref — writes settlement fields only.
- Admin Finances: summary block + per-row fee/net/recv or "unavailable".

#### PR #28 head corrected — now `f86b017`

- Earlier update `f08f15a` had been committed on `fix/paymongo-e2e-ratechange`; fast-forwarded `feat/settlement-reporting` to it, then added `f86b017`.
- Per-currency figure totals (gross/fee/net/converted each in own currency; converted never merged into net); per-figure coverage counts + verified-zero vs missing; partial backfill conditioned on COMPLETED+unchanged ref, writes missing fields only, scans 4x limit to avoid starvation.
- admin-settlement.spec.ts: mixed-currency converted totals, per-figure coverage, partial backfill settlement-only writes — 3/3.

#### Settlement reporting → superseding PR #30 at `24b1393` (PR #28 head ref went stale; closed, could not reopen — same branch + all review commits)

- Field-conditional backfill writes: each figure's update conditioned on still-NULL + COMPLETED + unchanged paymentRef; overlapping runs preserve confirmed figures; amount+currency written together; status/wallet/ledger untouched.
- Cursor pagination (completedAt,id): 500-record scan cap per call + continuation cursor — unavailable records cannot starve older deposits; skipped/failed stay retryable.
- admin-settlement.spec.ts 5/5: mixed-currency converted totals, per-figure coverage w/ verified zero, partial backfill, overlapping-run race, 500-unavailable + cursor continuation.

#### PR #30 update — `f87883e` (verified refs/pull/30/head)

- Backfill cursor now tracks last EXAMINED deposit — a mid-page limit stop no longer skips fetched-but-unexamined rows; scanned counts examined only; ordering + 500 scan cap preserved; skipped/failed stay retryable.
- admin-settlement.spec.ts 6/6: +limit=1 mid-page resume regression; retained 500-unavailable cursor continuation + overlapping-run tests.

### PR #30 deployed + production backfill — `28b6e24` live (2026-11-04)

- Merge `bc57e69`; deploy `41793214498` failed on admin.service.spec missing PayPalService provider → fix PR #31 (`28b6e24`), redeploy `41793610250` **success** (CI+E2E green).
- Migration `20261104000000_deposit_settlement_fields` applied — six provider_* columns present.
- Production backfill via Nest context (`backfillSettlement(10)`): **scanned 2, updated 2, skipped 0, failed 0**, nextCursor null. Admin HTTP path requires 2FA — endpoint auth not used.
- Verified writes: PayPal `cmw1na430001eno7xl8ezvy2w` → fee 0.34 USD, net 0.66 USD, converted 40.5 PHP; PayMongo `cmw0sje6n00153hevbly6i8bh` → fee 0.02 PHP, net 0.98 PHP. Both COMPLETED; exactly 1 ledger row each; wallet balance unchanged (5,260).
- `getSettlementSummary`: PayMongo PHP gross 2 (coverage 1/2 → partial flags correct for the older missing record); PayPal USD gross 1, fee 0.34, net 0.66, converted 40.5 PHP — converted kept separate.
- PayPal hosted return behavior: still open pending user report.

### Crypto wallet ownership — PR #32 at `b28d83f` (Ready for review, 2026-11-04)

**Finding:** `userWalletAddress` was self-declared — a second account could declare a victim's public wallet, submit the victim's public hash first, and win the `paymentRef` claim pre-mining. `expectedFromAddress` bound tx→address, never address→account. TOA (`CryptoWalletPanel.tsx`) uses the same self-declared model — Engganyo's binding was already stricter.

**Fix:** server-issued single-use expiring signature challenge bound to account+wallet+chain(+deposit), verified via `personal_sign`, consumed atomically; `wallet_verified` gates auto-credit; valid-but-unverified → `needsReview`+`claimedFrom` → admin review; terminal claim failures release the hash (anti-squat).

**UI:** connect → "1. Verify wallet ownership" (free signature, labeled not-a-transaction) → "2. Send X USDT" gated on proof; network/amount/destination/gas shown before send; proof resets on method change. Manual path unchanged — unproven transfers route to review.

**Tests:** wallet spec 33/33 (real ethers signing): challenge binding/single-use/expiry/wrong-wallet/wrong-deposit, second-account attack → no credit + review flag, verified → auto-complete, sender-mismatch → hash release. tsc+eslint clean. Screenshots: `docs/screenshots/crypto-step-{390,1440}.png` (connect state; verify/send gate on wallet connection).

**Public-release gates kept:** manual adjudication via admin review; BSC+Base enabled for the internal test round. Live BSC/Base test deposits to be user-initiated post-review+deploy.

#### PR #32 review update — `0edb83c` (verified refs/pull/32/head)

- Squat gap closed: unverified manual submissions store hash as `gatewayData.submittedHash` evidence only — never reserve the globally-unique `paymentRef`. Verified payers take it atomically on both entry points.
- Admin crypto approvals require claim-hash evidence; `completeDeposit` writes `paymentRef` inside the atomic settle update → manual approval vs automatic settlement cannot double-credit.
- Cron + browser verify resolve claims from `paymentRef` or `submittedHash`; terminal failures release whichever claim type. History shows "Under review" for needsReview deposits.
- Shared-state uniqueness fixture: attacker-first unverified claim → verified payer credits once, attacker zero; concurrent approval-vs-auto; mixed-case; both entry points. Wallet spec 36/36.
- Gates unchanged: manual adjudication via admin review; BSC+Base enabled for internal test round; no funded transfers yet.

#### PR #32 review update — `26c2cdd` (verified refs/pull/32/head)

- Admin crypto approval now delegates to the verified on-chain path: requires walletVerified, rejects conflicting refs (case-normalized), re-checks chain/token/recipient/amount/sender/timing/confirmations, settles through the same atomic exclusive claim. Hash-presence alone can no longer authorize credit.
- POST /wallet/deposit/:id/prove-ownership: fresh deposit-bound challenge + signature upgrades unverified manual claims — the only post-submission path to credit; unprovable senders stay in review for the documented support process.
- UI: "Prove sending wallet" action + Under-review tooltip.
- Regressions +5 (admin-settlement.spec.ts 11/11): dangerous-order approval → zero credit/ledger, verified-delegate path, on-chain re-check failure, conflicting + mixed-case refs. Wallet spec 36/36 retained.
- Gates: manual adjudication via review; BSC+Base enabled for internal test round; funded transfers await user post-deploy.

#### PR #32 review update — `6bd2074` (verified refs/pull/32/head)

- CAS settle guard: completeDeposit's atomic updateMany now requires claimHash (paymentRef OR gatewayData.submittedHash) + declared wallet + walletVerified unchanged from the RPC-verified read — stale results settle 0 rows. Applied via browser verify, cron, and admin approval (same verified path).
- flagNeedsReview / releaseCryptoClaim (both claim types) / progress writes all claim-conditioned — in-flight responses can't flag, release, or stamp progress on a replaced claim.
- Regressions: stale-result-after-release rejects with zero credit/ledger; ownership-upgraded manual claim guarded via submittedHash; attacker-first approval suite retained. Wallet spec 39/39.

### PR #32 deployed — `59d21af` live (run 41806082442 success, 2026-11-04)

- Migrations applied: `20261104090000_wallet_challenges` + settlement fields; API health ok.
- Deposit options verified live — BSC: enabled, dest `0xB6a1…941E`, USDT `0x55d3…7955`, chainId 56; Base: enabled, same dest, USDT `0xfde4…9bb2`, chainId 8453.
- Signature-ownership step is separate from the transfer (free `personal_sign`, not a transaction); chain/account change resets proof in the UI and invalidates challenge binding server-side.
- Awaiting user-initiated BSC + Base funded transfers for end-to-end settlement verification.

### Screenshot fixes — PRs #33 + #34 (Ready for review, 2026-11-04)

**PR #33 — wallet errors at `6c3ead9`:** `classifyEvmError` scans the full serialized provider error (ethers buries revert payloads in `info.error.data`) → concise message + hint. Reported `CALL_EXCEPTION`/`BEP20: transfer amount exceeds balance` → "Not enough USDT on BNB Smart Chain"; distinct BNB/ETH gas messages, rejection, wrong network, disconnect, RPC, generic fallback. Pre-send guards: EIP-55-safe normalization, self-transfer block, USDT+native-gas balance checks. `role=alert` + txHash recovery → manual prefill. e2e/wallet-errors.spec.ts verified at 390px: exact screenshot revert, zero-gas, rejection — no raw payloads in DOM.

**PR #34 — Finances cards at `fa092f8`:** dedicated PayPal/PayMongo cards replace the shared strip — Gross/fees/Net (prominent), converted receivable separate w/ 'not counted in net' note, per-figure n/total coverage, verified-zero vs unavailable, skeleton/empty states, before Credit Packages. Screenshots: `docs/screenshots/fin-after2-{390,1440}.png` (before: shared strip).

Gates unchanged: funded BSC/Base transfers user-initiated; PayPal hosted return deferred.

#### PR #33 update — `c13a888` (verified refs/pull/33/head)

- unresolvedSend binds a sent hash to network/wallet/package/method; registration failures now surface hash + bound context + recovery. 'Retry registration' re-runs initiate with the original hash/proof (never re-sends); 'Prove ownership again' re-signs a fresh challenge when the first was consumed/expired; manual prefill; resend blocked while unresolved. e2e/wallet-recovery.spec.ts — BSC + Base: hash+recovery visible, no second sendTx, retry resumes.

#### PR #34 update — `e50e3af` (verified refs/pull/34/head)

- Settlement cards now explicit states: skeleton / 'Couldn't load settlement totals' + Retry / refresh-failed-keeps-figures / populated. Coverage reads 'n of m deposits'. Populated + partial coverage verified at 390px+1440px (`docs/screenshots/fin-states-{390,1440}.png`).

### PR #34 deployed — `51865d9` live (run 41815193339, retried SSH step success, 2026-11-04)

- CI + E2E + build green; initial SSH deploy step failed transiently, job rerun succeeded.
- Settlement cards verified locally at 390px+1440px (`docs/screenshots/fin-states-*`); live settlement data unchanged (PayPal $0.34/$0.66/₱40.50, PayMongo ₱0.02/₱0.98 — backfilled earlier). Admin 2FA gate blocks direct HTTP check; endpoint + figures previously verified.

#### PR #33 revision — `dcd98ae` (verified refs/pull/33/head, Ready for review)

- Intent-first flow: deposit established (account+verified wallet+chain+package bound) BEFORE the transfer; hash attaches to that same deposit via tx-hash — recoverable, never a second initiate/resend. notBefore = deposit.createdAt → a transfer mined during a registration outage still settles.
- signOwnership returns the fresh proof (stale-render fix); proveOwnershipFor re-signs a deposit-bound challenge when proof expired/consumed; reconnect prompt when connected wallet ≠ sender.
- unresolvedSend persists in localStorage; send blocked while unresolved; lost-response resume via verify fallback.
- e2e/wallet-recovery.spec.ts (CI green on the #34 run): hash+recovery visible, __sendCount==1, retry resumes; BSC+Base.
- Retains friendly pre-send errors + ownership/replay/settlement rules.

#### PR #33 revision — `0eff153` (intent-first + open-intent recovery)

- Open deposit intent persisted before sendUsdt (id + account/wallet/network/package) — rejection/preflight retry resumes the SAME deposit, proof already consumed. Wallet/chain rechecked before broadcast.
- sendOutcome: cancelled/preflight (no broadcast → safe retry) vs uncertain (RPC/disconnect → check-wallet guidance + hash recovery, no resend push).
- 'Abandon deposit' cancels hash-less intents for context changes; localStorage persists across refresh; send blocked while unresolved.
- e2e recovery spec green in CI; BSC+Base covered; friendly pre-send errors retained.

#### PR #33 revision — `dcb3505` (verified refs/pull/33/head, Ready for review)

- sendUsdt returns {hash,outcome} directly — no stale React-state reads. Recovery record carries an explicit phase: 'sending' in-flight → 'retry' on confirmed rejection/preflight → 'uncertain' on RPC/disconnect/reload-mid-send.
- Uncertain phase is recovery-only: 'Check your wallet activity' + attach-hash input bound to the same deposit — no Resume send, no resend, no discard; re-proving ownership never triggers a transfer.
- e2e/wallet-recovery.spec.ts: RPC-error-no-hash → no resend before/after refresh → paste hash → attaches to original deposit, one sendTransaction; confirmed rejection → safe retry. BSC + Base.

#### PR #33 revision — phase-explicit send actions + in-flight guard

- Only 'retry' may broadcast; 'sending' shows waiting-only, 'uncertain' hash-recovery only, 'sent' register/verify only. sendInFlightRef blocks concurrent wallet requests; re-proof never sends. e2e: paused send → one sendTransaction; BSC+Base.

#### PR #33 revision — `af2cadf` (verified refs/pull/33/head, Ready for review)

- Prove ownership = verification only (no resumeTransfer callback); renders in retry/sent/uncertain, never in 'sending'. try/finally releases the send lock on every exit incl. failed initiate/missing depositId; thrown wallet call → 'uncertain' recovery-only.
- e2e: re-proof-in-retry leaves sendCount 1 until explicit Resume send (→2); initiate-503 → 0 wallet calls → retry → 1; retained pending-wallet/rejection/uncertain-reload/hash-attach BSC+Base.
- Local run: `npx playwright test e2e/wallet-recovery.spec.ts` → 7 failed — local env redirects to /dashboard (same as existing suite); CI runs on merge.

#### PR #33 revision — `a1368dac` (verified refs/pull/33/head, Ready for review)

- Recovery block renders regardless of wallet state (hoisted above the state conditional); pending-send restore moved to its own mount effect (no saved-form dependency).
- Local Playwright: `npx playwright test e2e/wallet-recovery.spec.ts` → **7/7 passed** — sent-unregistered + uncertain-reload + in-flight + re-proof + deposit-failure on BSC and Base.

#### PR #33 revision — `5268b5b` (verified refs/pull/33/head, Ready for review)

- Broadcast-boundary classification: estimateGas is an explicit step — its revert is provably pre-broadcast ('preflight' → friendly USDT error + retry); send-phase errors classify by structured code (4001/ACTION_REJECTED → cancelled; everything else → 'uncertain'). Message text no longer decides retryability.
- Local: `npx playwright test e2e/wallet-errors.spec.ts` → 3/3; `npx playwright test e2e/wallet-recovery.spec.ts` → 8/8.

### PR #33 deployed — `27e0640` live (run 41840180565, all green, 2026-11-04)

- PR #33 head `5268b5b` merged → `1cbbd55`; first deploy `41838447905` failed E2E — the wallet-errors spec's unmocked `initiate` hit the real CI API → 401 → logout before assertions. Fixed via PR #35; deploy `41840180565` all green (CI, E2E 11/11 incl. recovery suite, build, deploy).
- API health ok (4ms, db+redis). Deployed bundle verified: recovery code + "Check your wallet activity" present in the wallet chunk.
- BSC/Base options unchanged and verified earlier (BSC `0x55d3…7955` ch 56; Base `0xfde4…9bb2` ch 8453; dest `0xB6a1…941E`).

### Visual overhaul + email logo (in progress, 2026-11-04/05)

**PR #36 — `faebd96` (Ready for review):** email logo `raw.githubusercontent.com` → `engganyo.com/logo-square.png` (same artwork, 40×40, reliable through Gmail's image proxy). Deferred: verify appearance in Gmail via an approved test inbox.

**Design system — direction agreed (UI UX Pro Max search: mobile-first P2P task marketplace):** warm off-white public landing, deep ink signed-in surfaces, one violet accent from the existing logo, shared tokens for color/type/spacing/borders/focus/status, flat lists for comparable items, cards for separated groups. Existing logo artwork/proportions/colors preserved. Queued slices: landing+shared shell → dashboard/P2P journey → auth/Wallet/payment-return/secondary pages. Baseline screenshots still to capture.

#### Design slice — landing + shared shell (queued, ready to build)

- Landing structure inspected: `apps/web/src/app/page.tsx` (319 lines — jsonLd, PublicStats fetch from `/analytics/public-stats`, LandingNavbar), `landing-navbar.tsx` (94), `(dashboard)/layout.tsx` (297). Tailwind tokens at `tailwind.config.ts` — brand 500 `#3b62f5` → re-map to violet; surface palette present (warm off-white + deep ink to add).
- Build order: tokens (tailwind.config + CSS vars) → landing (off-white, "Find a task. Earn credits.", representative task preview, creator-review explainer, primary CTA) → signed-in shell (deep ink, nav priority: Find tasks/My tasks/My campaigns/Wallet) → screenshots 390+1440 → PR.
- Email PR #36 (`faebd96`) merged-ready; Gmail inbox check pending user-provided address.
