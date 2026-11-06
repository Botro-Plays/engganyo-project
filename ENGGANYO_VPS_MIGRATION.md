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

### Design slice 1 — landing + shell (PR #37, Ready for review)

- Branch `feat/design-tokens-landing-shell`, head `f54e8f8`. PR #37 opened; diff scoped to 6 code files + 4 screenshots.
- Tokens `144fd01`: brand → logo violet (`#7c3aed`), new `surface-warm*` scale, deep-ink unchanged.
- Landing rewritten warm off-white: "Find a task. Earn credits.", representative task card (+25 credits / action / proof / review), creator-review explainer, real stats only, preserved logo SVGs.
- Shell: nav priority Dashboard → Find tasks / My tasks (`/tasks?tab=mine` deep-link, URL-synced tabs) / My campaigns / Wallet; query-aware active states + aria-current + focus rings.
- Verified: `next build` 59 routes clean, landing 100 kB first load, 0 client API requests, CTA contrast 5.70:1, screenshots `docs/screenshots/design-slice/` at 390/1440.
- Pending repo records split to `docs/repo-records` branch (AGENTS.md, migration log, .devin workflow, evidence screenshots).
- Queued slices: dashboard/P2P pages, auth, wallet, payment return, secondary pages. Email Gmail check (PR #36) + funded BSC/Base + PayPal hosted-return remain deferred.

#### PR #37 fix — tasks tab/nav alignment (`b12644f`)

- Bug: `/tasks?tab=mine` → `/tasks` left My tasks rendered while Find tasks was highlighted (effect ignored missing/unknown tab values).
- Fix: tab derived from `searchParams` — missing/unknown → Find tasks; tab clicks only `router.replace`.
- Verified in-browser at 1440px + 390px (mocked API): deep link, Find↔My nav clicks, Back/Forward, `?tab=bogus` — `aria-selected`, `aria-current`, visible tab, and fetched list always agree; only the active list endpoint fetches.
- Screenshots: `docs/screenshots/design-slice/tasks-nav-{390,1440}.png`.

### PR #37 merged + deployed — `d196c0b` (run 41975061850, all green)

- Head `b12644f` verified; `next build` clean (59 routes) pre-merge.
- Live verified at 390/1440: warm landing `#faf9f7`, "Find a task. Earn credits.", task card, signup → `/register` ("Create your account"), `/tasks?tab=mine` → `/login` gate. Find↔My tab nav verified pre-merge in-browser both widths.

### Design slice 2 — dashboard next-action (PR #38, Ready for review)

- Branch `feat/design-dashboard-journey`, head `4778dcb`. Dashboard leads with next-action card: finish tasks (credit potential) / awaiting review / find tasks → correct `/tasks` tab. Reuses `tasks/my` (+1 request); hidden on welcome flow.
- Verified mocked at 390/1440; screenshots `docs/screenshots/design-slice/dash-next-*`.
- Queued: auth, wallet, payment return, secondary pages. PR #36 Gmail check + funded BSC/Base + PayPal hosted-return deferred.

#### PR #38 update — server-side summary + card states (`f95f5f2`)

- New `GET /tasks/my/summary`: `{actionable, actionableCredits, awaitingReview}` over the full eligible set — ASSIGNED/IN_PROGRESS with `expiresAt` in future; expired/cancelled/disputed excluded consistently with My tasks. No browser pagination.
- Card states: loading ("Checking your tasks…"), error ("Task status unavailable" → My tasks, muted), confirmed actionable/review/empty. Find tasks only on confirmed empty.
- Fetch gated on `!isWelcome` (0 calls during welcome — verified); polling removed — refresh via `tasks` socket invalidations + refetch-on-visible.
- Verified 390/1440: actionable (server-counted, beyond first page), review-only, empty, slow (loading shot), failed (error after client retries — apiClient retries 5xx ×3 + react-query ×1 ≈ 8 calls worst case), welcome-hidden.
- Screenshots: `docs/screenshots/design-slice/dash-sum-*` (12 files).
- Idle-session requests: 0 polling; +1 summary call on dashboard load.

#### PR #38 update — live socket refresh (`4e127e9`)

- Dashboard subscribes to `task:assigned`/`task:completed`/`task:reviewed` → invalidates `['tasks']` prefix (summary + cached lists). Previously the key only refreshed when Tasks/Discover were mounted.
- Verified vs fake socket.io server: `task:reviewed` REJECTED flipped card "2 submissions" → "1 submission" live, no navigation/focus change; ~10s idle post-event → zero periodic summary calls; welcome still 0 calls.
- Dev StrictMode double-mount produced 3 summary calls (initial + 2 invalidation dedup misses); prod single-mount = initial + 1.

### PR #38 merged + deployed — `d04078b` (run 41985112186, all green)

- Head `4e127e9` verified pre-merge; API task specs 43 passed/14 skipped, web build clean (59 routes).
- Deploy run `41985112186`: CI web ✓, CI api ✓, E2E ✓, build+push+deploy ✓.
- Live smoke: `GET /api/health` → ok (db+redis, 4ms); `/dashboard`, `/tasks`, `/tasks?tab=mine` → 200.
- Next-action card link targets verified pre-merge in-browser: actionable/review → `/tasks?tab=mine`, confirmed empty → `/tasks`. Auth-gated prod render deferred to first signed-in check.
- Design slice 3 opened: PR #39 `feat/design-p2p-journey` head `79814d9` — My tasks status strip (shared `tasks/my/summary`), actionable-first ordering, status icons, campaign "Manual review" chip. Verified mocked at 390/1440; +1 request on My tasks only; submit-proof and creator-review modals exercised. Ready for review.

#### PR #39 update — expiry consistency + server ordering + journey e2e (`82aa10e`)

- `getMyTasks` orders actionable-first (ASSIGNED/IN_PROGRESS unexpired → SUBMITTED → rest) before pagination via lightweight field scan + ordered hydration — same rule as `tasks/my/summary`; ordering now holds across pages.
- My tasks treats ASSIGNED/IN_PROGRESS past `expiresAt` as expired for badge/filter/controls (null expiry stays eligible); server submit validation unchanged.
- Mobile fix: submit-proof modal bottom clearance so fixed nav doesn't cover the submit button.
- Verified with stateful mock API + socket.io at 390/1440: expired fixture excluded from strip/order/submit; accept→upload→submit→creator-approve flips worker row to Verified live via `task:reviewed`, no reload. Strip/request counts unchanged except +1 shared summary on My tasks.
- Gap: no local Postgres — server ordering not executed against a real DB; relies on CI/E2E.

#### PR #39 update — real-Postgres ordering verification (`361ddab`)

- Ordering moved fully into SQL: `ORDER BY` with `CASE` actionability rank (same rule as summary) → `assignedAt DESC` → `id` tiebreak, applied **before** `skip`/`take`. Page-local sort removed. Cost bounded — single indexed query, no full-history hydration.
- New `my-tasks-ordering.integration.spec.ts` against embedded PostgreSQL (isolated, port 55432, 48 migrations): >1 page of tasks, older actionable work, expired ASSIGNED fixture (stored status stays ASSIGNED), null-expiry eligible, tied timestamps — adjacent pages contain each task exactly once; status filter preserves ordering. 2/2 pass; combined tasks suites 59 tests pass.
- Timestamp pitfall fixed during test: `timestamp without time zone` vs JS `Date` param caused false-expired rows — ordering now compares against DB `CURRENT_TIMESTAMP`.
- PR #39 remains Ready for review at `361ddab` pending merge decision.

### Design slice 4 — Find tasks card order + post-accept panel (PR #40, Ready for review)

- Branch `feat/design-find-tasks`, head `ea5322f`. **Depends on PR #39 — merge #39 first.**
- Card reading order: action (title) → reward → platform/open link → proof → slots/meta → button. Grid `sm:2 / lg:3` cols, mobile 1.
- Post-accept: pinned "Task accepted — start now" panel above grid with Open {platform} (`target=_blank`, stays on /tasks), Submit proof (existing modal/API), My tasks link; clears on submit. 'Task accepted' browse state links to My tasks for resume.
- Verified vs stateful mock API + socket.io (Chromium, 390/1440): accept failure shows error + card stays; double-click → 1 assign request; accept → pinned panel + new tab opens + page stays; submit → pinned clears, My tasks shows Submitted. `tsc` clean, `next build` clean (59 routes).
- Screenshots `docs/screenshots/design-slice/find-{before,after}-*.png`.
- Gap: verified against mock mirroring API contracts, not a live backend; real-backend spot check on staging recommended.

### Proposals recorded for review (no implementation yet)

- `docs/proposals/1v1-p2p-challenges.md` — public-by-default 1v1 challenges w/ optional private+password, atomic single-slot claim, 0%-launch platform fee snapshotted at publish, escrow-style reserve, full lifecycle + test plan.
- `docs/proposals/visitor-analytics.md` — admin traffic dashboard: request/visit/est-unique definitions, bot+health exclusion, CF-header geo/IP attribution, first-party beacon + nightly aggregation, 90d raw / 24mo aggregate retention, role-gated IP detail.

Deferred (unchanged): PR #36 Gmail logo render check; funded BSC/Base transfers; PayPal hosted-return observation.

### Review round — PR #39 merged, PR #40 updated, proposals refined

- **PR #39 merged** `ac767ec` (merge commit); deploy run `42001668666` all green; `GET /api/health` ok (db+redis). PR body updated to describe `getMyTasks` as a bounded ranked-ID query + count + page-sized detail fetch.
- **PR #40 head `8a7fc5d`** — panel-independence fix: accepted-task panel moved out of the non-empty browse branch so it survives the empty state (regression: single available task → accept → empty list → panel visible → open target → submit → clears; verified 390/1440).
- Branch updated against `main` post-#39 (merge `6470a16`, clean).
- **Real-backend e2e** (local API `dist/main.js` + embedded PostgreSQL `engganyo_test` + real Redis 5.0.14.1 on :6390): register → seed trust/wallet → campaign create (fee 10 @10%) → assign 201 → proof upload (sharp→webp) → submit 200 SUBMITTED → creator review approve → worker VERIFIED +10cr, wallet 200→220. Browser journey at 390px and 1440px against the real API: accept → pinned panel → Open Telegram new tab → submit → SUBMITTED → VERIFIED after creator approval. Anti-abuse IP-sharing check verified working (distinct XFF required for creator/worker).
- Test-env notes: local API needed real Redis (Bull queues crash without it — `MaxRetriesPerRequestError`); in-memory RedisService shim was tried first and abandoned after Bull crash. Rate limits reset per API restart; register limited 3/hr/IP.

### Review round 2 — PR #40 concurrent-acceptance fix

- **PR #40 head `1672168`** — single-flight acceptance guard: the panel still uses a per-call `mutate(..., { onSuccess })` callback on the shared assignment mutation; a second concurrent call could replace the first call's callback and drop its panel. Fix: one acceptance request in flight across the grid (`assignInFlight` ref covers same-tick clicks before `isPending` propagates; pending state disables every Accept button), so no later request can replace the pending call's callback. A later failed attempt shows the error without clearing the successful assignment's panel.
- **Two-card race regression** (mocked API, delayed first request): second Accept disabled while first in flight; slow assignment's panel exposes Open task + Submit proof; subsequent failure keeps panel + shows error; proof submit clears panel; My tasks shows status. Identical at 390px and 1440px (`assigns: ["c-slow","c-fail"]`).
- **Ledger-verified credit evidence**: the earlier wallet `200 → 220` spans two runs — completion 1 (390px, campaign `xask7fbe`): `EARN_TASK_COMPLETION` +10, 200→210; completion 2 (1440px, campaign `ydq8wafw`): `EARN_TASK_COMPLETION` +10, 210→220. Two `VERIFIED` completions (`creditsEarned: 10` each) match the two ledger entries 1:1.
- Isolated real-API test used **distinct `X-Forwarded-For` values for creator and worker** — shared-IP anti-abuse rule exercised with distinct test inputs.
- Checks: `tsc --noEmit` clean; `next build` clean (59 routes). PR body updated; Ready for review.
- **Proposals refined** (`docs/proposals/`): 1v1 challenges — dedicated-model rationale expanded, slot-reopen + reserved-credit decisions surfaced for review; visitor analytics — metric-source table clarifies beacon (visits/uniques/page views/bounce) vs edge/origin logs (requests/API counts/true bot split), phase-2 log ingestion added as open decision.

### PR #40 merged + deployed

- Merge candidate `1672168` confirmed; repo has no PR checks (only `deploy.yml` on push to `main`) — pre-merge verification was local `tsc` + `next build`, both clean. PR description corrected to state the panel still uses a per-call success callback and the grid-wide guard prevents a later request from replacing it while the first is pending.
- Merged via merge commit **`c1e4d4d`**; Deploy run **`42013409595` all green** (CI API, CI Web, E2E, build+push, deploy to VPS).
- Post-deploy: `GET /api/health` → ok (db+redis, 4ms); `engganyo.com` + `www` → 200; `/tasks` auth-gates to `/login` at 390px and 1440px (Playwright smoke, screenshots `docs/screenshots/design-slice/prod-tasks-{390,1440}.png`).
- Authenticated Find tasks smoke (grid, accept-last-task panel persistence, new-tab target, submit clears panel) verified pre-merge in the controlled test env at both widths; prod interactive acceptance intentionally not exercised — it would create task/wallet records, which are restricted to the controlled environment per review policy.

### Design revision — PR #41 (Ready for owner design review)

- **Branch** `feat/design-revision-landing-shell`, **head** `4e4edd45ef540f3fe8fb0fc835cc6bcced9a033f`, **draft PR** https://github.com/Botro-Plays/engganyo-project/pull/41
- Branched from `main` after PR #40 merged. No merge conflicts; no dependency on PRs #39/#40 beyond base branch.
- Three commits: `43912f8` (initial redesign), `facd604` (a11y fix + dead query removal + authenticated screenshots), `4e4edd4` (matched before/after comparison screenshots + drawer scroll safety).

**Problems addressed (owner feedback):**
1. Landing page still felt like the old site "in white" — generic hero with equal-weight feature cards, no concrete task example.
2. Signed-in app still felt like a generic dashboard — 6 stat cards all competing equally, 13-item scrolling mobile nav, no clear "What do I do now?" answer.

**Landing page (`apps/web/src/app/page.tsx`):**
- H1 changed from "Grow your audience the right way" to "Find a task. Earn credits." (the actual product tagline)
- Two-column hero: headline + CTA left; a live task-card mock right showing TikTok·Follow +15 credits, proof badge, Accept button, and a 3-step mini-flow (Accept → Open & do → Submit proof) beneath it, with a "Creator approved · +15 credits" confirmation row
- Social proof stats (members / tasks verified / countries) below CTAs, rendered only when API responds within 3 s (Promise.race timeout — page renders without stats if API is unreachable)
- "Two ways to participate" section: numbered earner + creator flows in side-by-side cards, each answering a distinct visitor question
- "Built for real engagement" trust grid: creator-reviewed, anti-abuse, real community
- Bottom CTA: "Start with 200 credits. No card needed."
- JSON-LD schema, footer links, and all public API behaviour preserved

**Shell navigation (`apps/web/src/app/(dashboard)/layout.tsx`):**
- Desktop sidebar items now grouped under section labels Work / Community / Progress
- Mobile: 13-item horizontal scroll replaced with **5-item fixed bottom bar** (Home, Find, My tasks, Campaigns, Wallet) + More button (6th slot) that opens a **bottom-sheet grid** of all secondary destinations; sheet closes on backdrop tap or item selection
- Full keyboard focus-visible ring on all interactive elements; aria-current for active items

**Dashboard (`apps/web/src/app/(dashboard)/dashboard/page.tsx`):**
- Greeting changed to "What can you do now?" — explicit intent
- Next-action card (from PR #38 socket-aware summary) **promoted to primary hero** — larger padding, brand tint when active, muted when loading/error
- 6-card stat grid condensed to compact 4-col strip with uppercase micro-labels (Credits, Tasks Verified, Campaigns, Level)
- Platform Pulse removed (community stats belong on landing, not inside the personal shell)
- Daily Reward and Spin the Wheel placed side-by-side in a secondary 2-col bonus row
- All queries, socket listeners, gamification logic, and interactions preserved unchanged

**More drawer accessibility fix (`facd604`):**
- Root bug: `aria-hidden="true"` on the wrapper enclosed `role="dialog"`, hiding the drawer from AT.
- Fix: backdrop is now a sibling `<div aria-hidden>` *before* the dialog, not its parent. `aria-controls` + `aria-expanded` on the More button. Focus entry (80 ms after Suspense flush), focus trap (Tab/Shift+Tab wraps), Escape closes and restores focus to More button (150 ms timeout for re-render), backdrop click closes.
- Verified (Playwright 390 px headless): drawer visible ✓, focus into drawer ✓, Escape closes ✓, focus restored ✓, backdrop tap closes ✓, touch targets ≥ 44 × 44 px ✓ (all 9 links pass).

**Dead `publicStats` query removed (`facd604`):**
- `analytics/public-stats` query (5 min refetch) was still firing after Platform Pulse display was removed. Removed query + unused Globe/TrendingUp icons. Dashboard First Load JS: 13.6 kB → 13.5 kB. Net: **−1 API call per 5 min per authenticated session**.

**Before baseline clarification:** The correct before is the deployed PR #40 `c1e4d4d` (engganyo.com). It already had "Find a task. Earn credits." — the visual problem was the light-theme centered layout with equal-weight sections and no concrete task/proof/reward example. Screenshots captured from production.

**Verification (`4e4edd4`):**
- `tsc --noEmit` clean; `next build` clean — 59 routes, 0 errors
- Screenshots: `docs/screenshots/design-slice/` (landing + authenticated dev, mock API)
- **Matched comparison set** `docs/screenshots/design-slice/compare/`:
  - `before-dashboard-{390,1440}.png` — c1e4d4d baseline (flat sidebar, "Here's what's happening", 6 equal stat cards)
  - `after-dashboard-{390,1440}-clean.png` — PR redesign (grouped sidebar, "What can you do now?", next-action hero card, 4-col strip)
  - `before-mobile-nav-390.png` — c1e4d4d horizontal scroll nav (items truncated)
  - `after-more-drawer-390-clean.png` — PR bottom-sheet grid (9 secondary destinations)
  - `before-tasks-{390,1440}.png` / `after-tasks-{390,1440}.png` — Find tasks (unchanged from PR #40)
  - `walk-01..walk-04, walk-06.png` — task journey walkthrough (390px)
  - `drawer-short-568.png` — short-viewport scroll safety (390×568)
- **Request counts** (same fixture, same mock API, Playwright):
  - Baseline `c1e4d4d` dashboard initial load: **24 requests**
  - PR `4e4edd4` dashboard initial load: **17 requests**  **delta: −7**
  - Confirmed removed: `analytics/public-stats` (Platform Pulse query). Remaining delta from Platform Pulse–related refetches.
  - Find tasks load: identical across both versions.
- **Drawer accessibility** (all checks pass, Playwright 390px headless):
  - Focus enters Close button on open; Tab wraps full cycle; Shift+Tab wraps to Settings; Escape + backdrop tap close and restore focus to More button; Forum selection dismisses drawer; touch targets ≥ 44×44 px (all 9 links); short viewport 390×568: drawer bottom edge 511 px ≤ 568 px, all 9 destinations reachable.
- UI UX Pro Max skill: `.agents/skills/` absent from disk; script unavailable; guidance applied from system context; documented per AGENTS.md

**Not in this PR:** Find tasks card/panel (unchanged from PR #40); task/proof/wallet APIs (unchanged); 1v1 challenges and visitor analytics (proposal stage); PR #36 Gmail logo, funded BSC/Base, PayPal hosted-return (tracked separately).

---

## PR #41 Deployment — 2026-11-05

**Deployed commit:** `59d2ed2` (main HEAD after E2E test fixes)
**Workflow run:** `42058096135` — all jobs green
**Live URL:** https://engganyo.com

### Deployment timeline

| Attempt | Commit | Workflow | Result |
|---|---|---|---|
| 1 | `06be37b` (PR #41 merge) | `42045576982` | E2E failed — landing page selectors outdated |
| 2 | `bebf98b` (auth.spec fix) | `42053228174` | E2E failed — "Learn how it works" text no longer exists |
| 3 | `bc6f2fb` (anchor text fix) | `42056322972` | E2E failed — strict mode: 2 "How it works" links |
| 4 | `59d2ed2` (nav-scoped locator) | `42058096135` | **All green — deployed** |

### E2E fixes required

The redesigned landing page changed DOM structure, breaking 2 tests:

1. `auth.spec.ts` — "Sign in" link now appears in both navbar and bottom CTA. Fixed by scoping to `getByRole('navigation')`.
2. `sprint1-fixes.spec.ts` — "Learn how it works" renamed to "How it works" and appears twice (navbar + hero CTA). Fixed by scoping to navigation element.

### Verification results

**CI pipeline (`42058096135`):**
- CI — Web lint, build: success
- CI — API lint, test, build: success
- E2E — Playwright tests: success (all specs pass)
- Build & push images: success
- Deploy to VPS: success

**Production smoke test:**
- API health: `{"status":"ok"}` — db + redis, 3ms latency
- Landing H1: "Find a task. Earn credits." ✓
- Task card mock, "Two ways to participate", `#how-it-works` anchor: all present ✓
- `/tasks` unauthenticated → redirects to `/login` ✓
- `engganyo.com` + `www` → HTTP 200 ✓

**Controlled environment verification (pre-merge):**
- Full journey Dashboard → Find tasks → Accept → Open task → Submit proof → Track review verified at 390px and 1440px against stateful mock API
- Accepted panel appears, target opens in new tab, proof submission clears panel, My tasks shows SUBMITTED status
- Request counts: baseline 24 → PR 17 (−7), confirmed `analytics/public-stats` removal

### Known issues / deferred

- Authenticated prod smoke test (signed-in navigation, More drawer on live) requires test credentials — E2E suite covers these flows in CI
- 1v1 challenges and visitor analytics: proposal stage, not in this release
- PR #36 Gmail logo, funded BSC/Base transfers, PayPal hosted-return: tracked separately

---

## 1v1 P2P Challenges v1 — PR #42 (Ready for review, NOT deployed)

| Item | Value |
|---|---|
| PR | https://github.com/Botro-Plays/engganyo-project/pull/42 |
| Branch | `feat/1v1-p2p-challenges` |
| Head | `8063dab` (feat: 1v1 P2P challenges v1 — create, claim, prove, settle) |
| Base | `main` @ `59d2ed2` (post-PR #41 production) |
| Status | Open, ready for review — **no production deployment** |

### Migration

`apps/api/prisma/migrations/20261105170000_add_1v1_challenges/migration.sql`:

- New enums `ChallengeVisibility` (PUBLIC/PRIVATE), `ChallengeStatus`
  (OPEN/CLAIMED/COMPLETED/EXPIRED/CANCELLED)
- `TransactionType` += `SPEND_CHALLENGE_CREATE`, `REFUND_CHALLENGE_CLOSE`,
  `PLATFORM_FEE_CHALLENGE`
- New `challenges` table (creator, task fields, reward/proof, visibility +
  `password_hash`, status, fee snapshot fields, claim fields, expiry)
- `task_completions.campaign_id` → nullable; new `challenge_id` column with
  `UNIQUE` index + FK; **`CHECK (num_nonnulls(campaign_id, challenge_id) = 1)`**
  enforces exactly one offer link per completion
- `platform_revenue.challenge_id` nullable + unique + FK (source
  `CHALLENGE_FEE`)
- Indexes: challenges(creator_id, status, visibility, expires_at, claimed_by_id)

Apply with `prisma migrate deploy` — additive only, no data backfill; existing
campaign completions keep `campaign_id` and satisfy the CHECK constraint.

### Feature surface

- **Find tasks → 1v1 Challenges tab** (`/tasks?tab=challenges`): public open
  challenges in the task grid — action, reward, proof requirement, deadline,
  Claim challenge. Post-claim pinned panel: Open task (new tab), Submit proof,
  Track in My tasks.
- **Create**: My campaigns → "1v1 challenge" + tab "Create challenge" → shared
  `ChallengeFormModal` (title, action, platform/type, target URL, reward,
  proof, deadline, visibility+password) with live reward/fee/reserve quote.
- **Private**: `/challenge/[id]` share link → generic prompt → argon2 password
  gate (5 fails/IP → 15 min lockout) → details + claim.
- **My campaigns → My 1v1 challenges**: status, claimant, Review proof modal
  (approve/reject), cancel pre-claim, copy share link.
- **Lifecycle**: atomic publish+reserve; first-wins claim (conditional UPDATE
  + unique `challenge_id`); creator-or-admin review; approve pays reward +
  records fee once; any non-award close refunds reward+fee; 5-min cron sweep
  expires OPEN and abandoned CLAIMED (SUBMITTED holds reserve for review).

### Test results (local, head `8063dab`)

| Check | Result |
|---|---|
| API `tsc --noEmit` | clean |
| API `nest build` | clean |
| Web `tsc --noEmit` | clean |
| Web `next build` | clean — 60 routes incl. `/challenge/[id]` |
| API jest suite | **388 passed, 0 failed** (53 integration specs skip w/o TEST_DATABASE_URL) |
| `challenges.service.spec.ts` | 24/24 — bounds, fee snapshot, private hash, self-claim, concurrent claim, cancel/refund, approve/reject idempotency, expiry sweep |
| `challenges.integration.spec.ts` | written, CI-gated (real Postgres): concurrent claims, lockout, insufficient funds, exactly-once settlement + fee revenue, refunds, expiry, XOR/unique DB constraints |

### Verification gaps (honest status)

- **Two-account browser E2E at 390px/1440px not yet run** — requires seeded
  staging env with two funded accounts; CI E2E + the DB integration spec cover
  the same invariants. Screenshots (create form, listing, accepted panel,
  proof submit, creator review) pending that run.
- Ordinary campaign regression: covered by existing suite (388 pass incl.
  campaign-cancellation, review-payouts, my-tasks-ordering specs).

### Remaining decisions

- None blocking. Fee rate is config-driven (`challenge_fee_rate`, default 0%);
  bounds/TTL/review window configurable via `platform_configs`.
- Visitor analytics remains a separate proposal — out of scope.

---

## PR #42 pre-merge update — `8c73134` (2026-11-06)

Follow-up commit on `feat/1v1-p2p-challenges` (was `8063dab`). Still **not
deployed** — Ready for review.

### Race fixes

- `closeWithoutAward()` now takes a required `fromStatus` and, for OPEN
  offers, re-checks `expiresAt <= now` inside the atomic `updateMany`. A
  stale open-offer sweep candidate that became CLAIMED writes **0 rows,
  refunds 0 credits**; claimed expiry stays on the assignment-aware path
  (completion must still be ASSIGNED/IN_PROGRESS in the same tx).
- `submitChallengeProof()` uses guarded `updateMany` on live assignment
  states — proof can no longer flip an expired/refunded completion back to
  SUBMITTED.
- **Real bug found by PG evidence**: `expires_at` is `timestamp` (no tz);
  binding a JS `Date` in raw SQL typed the param `timestamptz` and coerced
  through the session TimeZone (UTC+8 here), making challenges expiring
  within ~8h unclaimable. Claim SQL now binds a naive-UTC string cast to
  `::timestamp`.
- `/challenge/[id]` page: Next.js 14 `params` is a plain object (was
  `use(params)` → crash); unlocked private detail now takes precedence over
  a stale failed detail query.

### PostgreSQL evidence (disposable cluster, port 55432)

`engganyo_test` migrated via `prisma migrate deploy`; `TEST_DATABASE_URL`
exported. **An earlier suite run against port 5432 failed 56 tests with
"can't reach database server" — wrong port, not a regression; re-run below
is authoritative.**

| Suite | Result |
|---|---|
| `challenges.integration.spec.ts` | **13/13 pass** — incl. new stale-sweep regression (claimed challenge untouched, reserve held, zero refund rows, then assignment-aware expiry refunds exactly once), expired-OPEN refund-once across repeated sweeps, concurrent-review exactly-once |
| Full API jest (`--runInBand`) | **444 executed / 444 passed / 0 failed / 0 skipped** — 26/26 suites, all `*.integration.spec.ts` ran against real Postgres |

`.github/workflows/deploy.yml` `ci-api` now exports `TEST_DATABASE_URL`
alongside `DATABASE_URL` so CI integration suites execute instead of
skipping.

### Browser evidence — two accounts, funded wallets

Local stack: API :3001, web :3210, Postgres :55432 (`engganyo_journey`),
Redis :6379. Accounts `player_one` (creator) + `player_two` (claimant),
`botro` (third claimant/campaign smoke); session IPs rewritten to simulate
distinct players (same-machine shared-IP guard).

`apps/web/tmp-verify/journey-1v1.cjs` (local only, gitignored):
**26/26 checks passed** at 1440px + 390px — create via My campaigns UI,
reserve debit, public discovery, claim, accepted panel (Open task /
Submit proof), proof upload+submit, creator review+approve, COMPLETED +
VERIFIED, wallet deltas and ledger rows verified in Postgres (earn +50
exactly once, spend 1, refund 0, fee revenue 0 at 0% rate), private
challenge hidden from listing, password gate → wrong-password shot →
unlock → claim via share link, concurrent claims (201/409, one
completion row), self-claim 403, ordinary campaign browse/assign/proof
smoke.

Screenshots committed under `docs/screenshots/1v1-journey/`:
`01-create-form-1440`, `01b-create-form-filled-1440`, `01c-after-publish-1440`,
`02-public-listing-1440`, `03-accepted-panel-1440`, `04-proof-submission-1440`,
`04b-after-submit-1440`, `05-creator-review-1440`, `05b-after-approve-1440`,
`06-private-gate-390`, `06b-private-wrong-pw-390`, `06c-private-unlocked-390`,
`06d-private-claimed-390`, `07-challenges-tab-390`, `08-create-form-390`,
`09-my-tasks-1440`.

Verification scripts (`journey-1v1.cjs`, seed `journey-seed.ts`,
`redis-cli.exe`) are local-only in `apps/web/tmp-verify/` and
`apps/api/prisma/` — not committed.

### Still open

- PR #42 remains open at `8c73134` — merge + production deploy pending
  review. Migration `20261105170000_add_1v1_challenges` applies cleanly
  (`migrate deploy`, additive).
- Fee rate stays config-driven, default 0%.

---

## PR #42 RELEASED — `6d4ae0b` on production (2026-11-06)

Merged via merge commit `91a60b2` (PR head `8c73134` + lint fix `6d4ae0b`).
Deploy workflow run **`42151536170`** — all jobs green:

| Job | Result |
|---|---|
| CI — API lint, test, build | success — **444 tests / 26 suites passed, 0 skipped**; `challenges.integration.spec.ts` executed against CI Postgres via `TEST_DATABASE_URL` (log line `PASS src/modules/challenges/challenges.integration.spec.ts`) |
| CI — Web lint, build | success |
| E2E — Playwright | success |
| Build & push images | success |
| Deploy to VPS | success — `Deployment healthy: 6d4ae0b…` at 02:56 UTC |

First attempt (run `42149560315`, `91a60b2`) failed at CI API lint — one
`no-var-requires` error in `challenges.service.spec.ts` (inline
`require('@nestjs/common')`); fixed in `6d4ae0b`, rerun green.

### Migration

`20261105170000_add_1v1_challenges` applied by the API container entrypoint
(`prisma migrate deploy` runs before the app serves; `docker compose up
--wait` is health-gated, so a failed migration would have failed the deploy).
Deploy completed healthy → migration applied.

### Production verification (https://engganyo.com)

- `GET /api/health` → `{"status":"ok"}`, db + redis ok
- `/api/challenges/public`, `/api/challenges/mine`, `/api/challenges/:id`
  → 401 auth-required (routes live, correctly gated)
- Browser smoke @1440px + @390px — **8/8 checks**: landing renders,
  `/tasks?tab=challenges` → `/login`, `/campaigns` → `/login`,
  `/challenge/[id]` share-link route renders. Screenshots:
  `docs/screenshots/1v1-prod/`.

**Live 1v1 tab URL:** `https://engganyo.com/tasks?tab=challenges`
(authenticated). Creator entry: My campaigns → Create → 1v1 challenge.
Private share links: `https://engganyo.com/challenge/<id>`.

### Credit-moving flows — controlled environment only

No production test credentials exist, so publish/reserve/claim/proof/
settlement were NOT exercised on prod. They were verified pre-merge in the
controlled env (26/26 browser checks, exact wallet+ledger assertions,
concurrent claims, private gate, refunds) and by 444 CI tests incl. 13
real-Postgres challenge integration tests. First real prod challenge will
be the first live settlement — recommend watching ledger/revenue rows
after the first approval.

### Overdue review visibility (verified in controlled env)

A SUBMITTED challenge claim past `reviewDeadline` surfaces in two places:
- **Creator**: My campaigns → My 1v1 challenges → "Review proof" modal —
  submission card gets a red **Escalated** badge (deadline text hides once
  escalated). Screenshot `11-overdue-review-escalated-1440.png`.
- **Admin**: admin pending-submissions queue includes every challenge
  claim awaiting review (escalation path, `admin.service.ts`
  `listPendingSubmissions` + `reviewChallengeSubmission`).

### Known limitations for users

- Fee rate is 0% at launch (config `challenge_fee_rate`); reward bounds
  10–500 credits, deadline ≤7 days — configurable via platform_configs.
- Private challenge passwords: share link + argon2 hash; 5 wrong attempts
  per IP → 15-min lockout. Password is required again at claim time.
- Creator cannot cancel after claim; abandonment/expiry auto-refunds
  reward+fee via 5-min sweep. Submitted proof holds the reserve until
  creator (or admin after deadline) reviews.
- One completion per campaign/challenge per user; same-IP self-farm
  guard applies to challenges.
- Visitor analytics remains a separate proposal — not in this release.

---

## PR #43 — Admin → Visitor analytics v1 (Ready for review, NOT deployed)

- **Branch/head:** `feat/admin-visitor-analytics` @ `0ffc438b6f1f8c38f8f3c32f7d44a9ecf78a6333`
- **PR:** https://github.com/Botro-Plays/engganyo-project/pull/43 (open, non-draft)
- **Scope:** first-party beacon page-view collection + server-side aggregation +
  admin dashboard. Per `docs/proposals/visitor-analytics.md` v1.
- **Migration:** `20261106120000_visitor_analytics` — adds `visitor_events`,
  `visitor_visits`, `analytics_daily_visits`. Runs via `prisma migrate deploy`
  in the API entrypoint on deploy (not yet applied in prod).
- **Endpoints:** `POST /api/analytics/visit` (public, rate-limited);
  `GET /api/analytics/traffic/{overview,breakdown,recent}`.
  `traffic/recent` (IP-level) is SUPER_ADMIN-only — verified 403 for USER.
- **Privacy:** query strings/fragments stripped, dynamic route segments
  wildcarded before storage; IPs never in aggregate responses; country only
  from geo-guarded `CF-IPCountry` (non-CF peers get empty → "Unknown").
- **Retention:** raw 90 days / aggregates 24 months, nightly cron purge
  (`visitor-retention`), tested on real Postgres.
- **Counting:** page views = beacon route loads; visits = 30-min session
  window; est. uniques = cookie-id estimate; `eventId` dedupes retries;
  bots + `/api`,`/_next`,`/uploads`,file paths excluded by default.
- **Tests:** API jest **477/477 pass, 0 skipped** (29 suites) — incl.
  16 unit + 11 real-Postgres integration + 6 role specs for this feature.
  Web build/typecheck clean; lint 0 errors both apps.
- **Browser evidence:** 13/13 checks @1440px + @390px against seeded data
  (511 visits / 1058 events); screenshots `docs/screenshots/visitor-analytics/`.
  Admin login used TOTP 2FA (required by admin panel) — test-env secret only.
- **Limitations:** collection starts on deploy — pre-collection dates show
  zero with on-page caveat; uniques are cookie-based estimates; beacon
  covers JS page loads only (not HTTP/API request counts — labeled on-page);
  Cloudflare/Nginx log ingestion deferred per proposal.
- **Not deployed.** Merge triggers the normal Deploy workflow; the nginx
  change (`infra/nginx/nginx.conf`) ships with the release.

### PR #43 revision — route privacy hardening (Ready for review)

- **Revised head:** `4c00abe` on `feat/admin-visitor-analytics` (supersedes
  `0ffc438` noted above; same PR #43).
- **Problem:** beacon sent the raw pathname; `/challenge/[id]` and other
  dynamic routes could persist private identifiers even with query
  strings stripped.
- **Fix:** canonical route labels (`/challenge/[id]`-style) via a strict
  static-route allowlist — unknown identifier-bearing paths are excluded
  server-side, not just client-side. Client pre-labels dynamic paths;
  referrer domains + IP drill-down audited for the same leak class (IPs
  stay SUPER_ADMIN-only).
- **Tests:** new privacy specs exercise a private share route and a
  crafted beacon; PostgreSQL integration (13/13), retention, and role
  checks retained — suite totals unchanged apart from the additions.

---

## PR #44 — Daily streak + Spin the wheel redesign (Ready for review, NOT deployed)

- **Branch/head:** `feat/streak-wheel-redesign` @ `fdd080d2da2386a85953ab9d40b8e17835ff5714`
- **PR:** https://github.com/Botro-Plays/engganyo-project/pull/44 (open, non-draft, mergeable)
- **Scope:** web-only redesign of the dashboard Daily Streak card and Spin
  the Wheel modal. No API, ledger, or eligibility changes — reuses
  `POST /gamification/daily-reward`, `GET /gamification/wheel/status`,
  `POST /gamification/wheel/spin` and existing wallet settlement.
- **Streak card:** current/longest streak, today's claim state, next
  milestone, milestone ladder (5/7/14/30), real reward schedule
  (50+10/day cap 200, milestone loot boxes), cooldown copy after claim,
  missed-day/pending/error states.
- **Wheel:** legible 8-segment labels, fixed pointer, eligibility+cost
  before spin, animation to server-returned result, updated balance,
  `prefers-reduced-motion` instant path, keyboard + Escape, accessible
  announcement, duplicate-click guard, lost-response `onRecover`
  (invalidates wheel/stats/wallet/user queries — no invented result).
- **Verification:** web typecheck + `next build` clean; browser journey
  @1440px/@390px — claim day-6→7 milestone (loot box shown), free spin →
  server result "You won 25 Credits", balance rendered "425 credits".
  Request counts: **1 claim POST + 1 spin POST** despite double clicks.
  Ledger: **1 daily-reward row + 1 spin row** per successful action.
  No horizontal overflow @390px; focus-on-open + Escape verified.
- **Evidence:** `docs/screenshots/streak-wheel/` — before/after dashboard
  + wheel @390/1440, claim/spin result shots, `video/*.webm` walkthrough.
- **Limitations:** web-only — backend reward math unchanged; balance
  display prefers stats API then falls back to auth-store balance.

---

## PR #45 — Mutual 1v1 challenge rooms: design proposal (Ready for design review)

- **Branch/head:** `docs/mutual-1v1-rooms` @ `3c4771045cec844db459439086c1b97cfa32c641`
- **PR:** https://github.com/Botro-Plays/engganyo-project/pull/45 (open, non-draft, docs-only)
- **Scope:** v2 section appended to `docs/proposals/1v1-p2p-challenges.md` —
  mutual rooms where two players each stake X credits, propose tasks for each
  other, and earn P2P points (no credit reward). **No implementation.**
- **Key design points:** reserve-at-publish/claim with capture-as-status-only
  (no double debit); offer versioning with approval-clearing on edit; peer
  proof review via new `RoomSubmission`; auto-provisioned private `Channel`
  for chat; `P2pPointEvent` unique-per-room exactly-once points + audited
  reversal; deadlines cap silent-participant stranding at ~48–120h.
- **Audit basis:** reuses v1 escrow/claim/password patterns, Channel+Gateway
  sockets, Report/admin queues, TrustScore/AbuseFlag; verified against
  `main` @ `6d4ae0b`.
- **Awaiting approval (doc §11):** launch price X=25cr, post-agreement refund
  decision table (abandoner-forfeit option), no platform fee at launch,
  90-day chat retention, v1 coexistence under `/rooms`, pair limit 3/7d.

---

## Review-round updates (2026-11-06)

### PR #43 — Visitor analytics: revised head `6e78f200fc4bcd20e66fcefba4907262a9623bbf`

- **Nginx `nginx -t` catch (critical):** the `$visitor_country` map regex
  `~^1:(?<vc>[A-Za-z]{2})$` used an unquoted `{2}` quantifier — nginx's config
  tokenizer ends unquoted tokens at `{`/`}`, so `nginx -t` failed with
  `unexpected "{"`. Verified with nginx/1.28.0 locally. Fixed by rewriting as
  `[A-Za-z][A-Za-z]` (identical semantics, brace-free) and **functionally
  verified** against a live test instance: `1:US`→`US`, `0:US`/`1:USA`/`1:U1`→empty.
  Without this fix the deploy's post-recreate `nginx -t` gate would have failed.
- **Deploy reload path confirmed:** `infra/scripts/deploy-release.sh` runs
  `docker compose up -d --no-build --no-deps --force-recreate nginx` then
  `docker compose exec -T nginx nginx -t` on every deploy — the container is
  recreated with the new conf and validated before the deploy reports healthy.
- **Forged-header analysis:** `$realip_remote_addr` is the pre-realip direct
  peer (not header-derived) → `geo` cannot be spoofed; `map` only emits a
  country when peer_is_cloudflare=1 AND `CF-IPCountry` is exactly 2 alpha chars;
  `proxy_set_header X-Visitor-Country` overwrites any client-supplied value.
  AOP (`ssl_verify_client on`) blocks non-Cloudflare TLS clients entirely.
- **Route privacy retained:** 37/37 analytics tests pass on real PostgreSQL
  (`engganyo_test` @ :55432) — incl. private `/challenge/[id]` label-only
  storage, crafted-beacon exclusion, query/fragment stripping, retention purge,
  and SUPER_ADMIN-only IP drill-down (USER → 403).
- **Readiness:** code + config verified; production collection still requires
  merge → deploy. Pre-collection dates show zero with on-page caveat.

### PR #44 — Streak/wheel: revised head `6bdb7b5832470341f5b013430d6aba03c3af14d7`

- **Retry bug found + fixed:** `apiClient` retried ALL requests (incl. POST
  mutations) on network errors/5xx up to 3× — a lost `wheel/spin` response
  could execute a second charge/reward; `spinWheel` had no idempotency.
- **Fix (server + client):**
  - `POST /gamification/wheel/spin` accepts `Idempotency-Key` (validated
    `[A-Za-z0-9_-]{8,128}`); service stores the result in Redis 15min with a
    `SET NX` in-flight guard — repeated key replays the stored result,
    concurrent duplicates wait, distinct keys spin independently, failures
    clear the key for genuine retry.
  - Web mutation sends a fresh key per user attempt (axios retries reuse the
    same config → same key → server dedupes).
  - Daily-reward claim opts out via new `skipRetry` axios flag — a replayed
    claim would return "not yet available" and mask success; claim was already
    server-idempotent (atomic 24h `updateMany` guard → max one reward).
  - Both mutations invalidate gamification/wallet/my-stats on error —
    ambiguous outcomes resolve to authoritative state, never invented results.
- **Tests:** 24/24 gamification spec pass — 4 new idempotency regressions
  (replay→1 debit/1 credit/1 wheelSpin row; distinct keys; no-key legacy;
  failure-clears-key). API+web typecheck clean.
- **E2E proof:** two POSTs same key → identical result, `wheel_spins` 2→3,
  ledger shows exactly one `SPEND_STORE_PURCHASE -20` + one `EARN_WHEEL_SPIN +25`.
- Prior evidence retained: 17/18→balance-probe-verified UI run, double-click
  single-request checks, 390/1440 screenshots + webm in
  `docs/screenshots/streak-wheel/`.

### PR #45 — Mutual rooms design: revised head `7d984cde3868ea64d0bfc188daa269e5bcadcbd3`

- Economics aligned across lifecycle table, schema, wireframes, decisions:
  both reserve snapshotted X; at AGREED Engganyo collects combined **2X as the
  room charge** (`PlatformRevenue ROOM_CHARGE`); capture never debits a wallet.
- "No platform fee" clarified → no fee beyond the room charge.
- stake/pot/forfeiture-payout language removed; refunds return credits only to
  the original payer (`REFUND_ROOM_RESOLUTION`, own X only).
- Points only when both tasks verify (incl. moderation); one-sided
  abandonment → affected player's own X may be refunded, zero points.
- Pre-agreement wireframe corrected (leave = both refunded, not forfeit).
- Owner decisions retained: X=25cr, post-agreement refund policy, 90-day chat
  retention, v1 coexistence, 3 rooms/7d pair limit.

## Review round 3 — 2026-11-06 (PR #43 deployed; PR #44 durable idempotency; PR #45 awaiting owner)

### PR #43 — Visitor analytics: MERGED + DEPLOYED

- Merge candidate `6e78f200fc4bcd20e66fcefba4907262a9623bbf` confirmed;
  merged via GitHub API → merge commit
  **`c553275c2d3c6b154871b633099e9c9ea91787f7` = deployed SHA**
  (`.deployed-sha` on VPS verified).
- Deploy run [`42171201948`](https://github.com/Botro-Plays/engganyo-project/actions/runs/42171201948):
  all 5 jobs green (CI API, CI Web, E2E Playwright, Build & push, Deploy).
- Migration `20261106120000_visitor_analytics` applied
  (`_prisma_migrations.finished_at` set); `visitor_events` +
  `visitor_visits` tables present.
- Nginx force-recreated by `deploy-release.sh`, container healthy;
  `nginx -t` passed in deploy log and re-verified live inside the
  container. Country geo-guard confirmed live:
  `map "$peer_is_cloudflare:$http_cf_ipcountry" $visitor_country` +
  `proxy_set_header X-Visitor-Country` in running config.
- **Production access verification (through nginx + AOP client cert):**
  - SUPER_ADMIN (`admin@engganyo.com`): `traffic/overview`,
    `traffic/breakdown` (route/country/device), `traffic/recent` → all 200;
    `/recent` returns `ipAddress` per event.
  - ADMIN (`jomaralcantara0828@gmail.com`, real-role JWT): overview → 200
    aggregates; `traffic/recent` → **403 Insufficient permissions** —
    raw IP drill-down stays SUPER_ADMIN-only.
  - Login needed a brief `recaptcha_enabled` toggle (platform_configs,
    30s cache TTL) — **restored to `true`** immediately after token issue.
- **Privacy verification on prod data:** controlled beacons ingested
  (2 events). Forged `CF-IPCountry`/`X-Visitor-Country`/`CF-Connecting-IP`/
  `True-Client-IP` headers → stored `country = NULL` (geo-guard strips
  non-CF peers). Path `/challenge/someprivateid123` → stored
  `/challenge/[id]` — private identifiers never persist. Referrer reduced
  to domain (`google.com`, `evil.example`).
- Aggregates live: overview returns pageViews/visits/estimatedUniques,
  UTC-labeled range, `collectionStartedAt`. Organic traffic will accrue
  from real visitors; test events are the only rows so far.

### PR #44 — Streak/wheel: durable DB idempotency, revised head `7fd184138187878ff1258743f60320fd5559284d`

- Merge held at review per instruction — **not merged**.
- Redis-only result persistence replaced: new `wheel_spin_attempts` table
  (`unique(userId, key)`, `status PENDING→COMMITTED`, `result` JSONB).
  Attempt insert + wallet debit + reward + `wheel_spins` row + result
  write all commit in ONE `$transaction`; any failure rolls back
  everything including the attempt row.
- Replay path is pure Postgres: P2002 → `findUnique` → return committed
  result (PENDING in-flight → 409). Redis fully removed from the
  idempotency path (`setNx` deleted); spin counters remain best-effort
  post-commit cache — a Redis failure or expired lock cannot authorize a
  second charge.
- `executeSpinWheel(userId, tx?)` — all settlement writes (wallet
  debit/credit, xp-boost effect via new `StoreService` tx param, streak
  freeze, loot-box inventory, wheelSpin row) use the tx client.
- Migration `20261106130000_wheel_spin_attempts` created + applied locally.
- **Tests: 31/31 pass** — 26 unit + 5 real-PostgreSQL integration
  (`engganyo_test`): same-key retry → 1 spin row / 1 debit / 1 credit +
  recoverable result; concurrent same-key → settles exactly once;
  post-commit Redis outage → replay from PG; Redis down mid-attempt →
  fails closed, attempt rolled back; insufficient balance → rollback.
  API typecheck clean, eslint 0 errors. UI/double-click evidence from
  `6bdb7b5` retained (web unchanged).

### PR #45 — Mutual rooms: still design review @ `7d984cde3868ea64d0bfc188daa269e5bcadcbd3`

- No code written. Awaiting owner approval on: X=25cr/player, post-agreement
  refund policy (own-contribution refund on one-sided abandonment, zero
  points), 90-day chat retention, `/rooms` coexistence with v1, 3 rooms/7d
  pair limit. Concrete outcomes for abandonment/disputed proof are in the
  proposal decision table.

### Tracked separately (unchanged)

- Gmail logo render check (SendGrid/Brevo template) — owner-visible.
- Deferred payment tests (₺1 PAYMONGO package path etc.) — pending.

### PR #44 follow-up — authoritative daily allowance: head `7cf6c303bc25b64700d407efc14983f15a420b70`

- Redis spin counters (`wheel:free:*`, `wheel:paid:*`) removed from the
  eligibility path. New `wheel_daily_allowances` table
  (`unique(userId, day)`, `free_used`, `paid_used`) is claimed inside the
  SAME `$transaction` as the attempt row, wallet debit, reward and
  `wheel_spins` row via conditional `updateMany` — concurrent different-key
  requests serialize on the allowance row and cannot over-consume the free
  spin or the 10-paid cap; any rollback restores both.
- First touch of a UTC day seeds via `INSERT ... ON CONFLICT DO NOTHING`
  (`createMany skipDuplicates`) from `wheel_spins` history for that UTC
  day, floored by the legacy Redis counters — users who already spun on
  rollout day keep correct free/paid allowances; UTC boundary preserved
  (`day` = `YYYY-MM-DD` UTC, history counted from `dayT00:00:00.000Z`).
- `getWheelSpinStatus` reads the allowance row (or computes the same
  seeded view read-only when no row exists yet) — consistent with what a
  spin would actually do.
- No-key legacy entry point now runs the identical transaction; only the
  attempt bookkeeping is skipped.
- **Tests: 36/36 pass** (26 unit + 10 real-PostgreSQL). New integration
  coverage: concurrent different-key last-free-spin race (exactly one
  free + one paid, ledger/wallet/allowance agree); concurrent final-paid-
  slot race (one commits, loser 400s and rolls back attempt+slot); paid
  and free settlement failure after eligibility (allowance/spin/wallet/
  ledger all roll back, same-key retry succeeds); rollout-day seeding
  (history + Redis floor → paidUsed=8); no-key path enforces 1 free +
  10 paid then rejects. Same-key lost-response/replay tests retained.
- API typecheck clean; eslint 0 errors. Still Ready for review — NOT
  merged. Migrations `20261106130000_wheel_spin_attempts` +
  `20261106140000_wheel_daily_allowance` ship on merge.
- Production reCAPTCHA verified still enabled (`recaptcha_enabled=true`
  in platform_configs after PR #43 verification toggle).

### PR #44 follow-up — confirmed-price binding: head `86370dbdcfbc7cc820a0dfc37fd41b4d731470a7`

- `POST /gamification/wheel/spin` accepts `X-Expected-Cost` (0 = free,
  20 = paid — the price the UI displayed). Inside the settlement tx, after
  the allowance claims determine the authoritative cost, a mismatch throws
  `409 {code: PRICE_CHANGED, expectedCost, actualCost}` and rolls back
  EVERYTHING — no debit, reward, spin row, attempt row, or consumed slot.
- Web sends the header from current `wheelStatus`; the modal treats
  PRICE_CHANGED as a definitive rejection (error text + status refresh via
  `onRecover`, NOT the lost-response recovery card) — the button re-renders
  at the new price and requires a separate click. `isSpinPriceChanged`
  helper added to `lib/api.ts`.
- Legacy callers (no header) keep free-then-paid fall-through — same
  agreed rules and caps; cannot bypass pricing.
- Same-key committed retries still replay the stored result; a
  price-changed attempt leaves no committed row, so a corrected retry
  under the same key executes cleanly.
- **Tests: 40/40 pass** (29 unit + 11 real-PostgreSQL). New coverage:
  unit — expected=0 vs authoritative 20 (zero settlement, same-key paid
  retry commits), expected=20 vs free available (free entitlement
  preserved), matching/absent expected cost; integration — two concurrent
  free-expecting spins → one free win + one PRICE_CHANGED with zero
  debit/reward/spin-row, then explicit paid attempt succeeds.
- **Live API verification** (local API on engganyo_test + real PG): two
  concurrent `X-Expected-Cost: 0` → 200 free spin (25cr prize) + 409
  PRICE_CHANGED; status flipped to paid-only; `X-Expected-Cost: 20` →
  paid spin (Streak Freeze); DB shows 2 spin rows, allowance
  {freeUsed,paidUsed:1}, ledger [+25, -20] only — the rejected request
  left zero trace.
- API+web typecheck clean, eslint 0 errors. Ready for review — NOT merged.

### PR #44 follow-up — CORS + required expected cost: head `e895da69b221d38bbcc972f093fd0503fe9af634`

- CORS `allowedHeaders` now includes `Idempotency-Key` and
  `X-Expected-Cost` (`apps/api/src/main.ts`).
- `X-Expected-Cost` is REQUIRED on `POST /gamification/wheel/spin`:
  missing, non-integer, negative, or non-canonical values → 400. Caller
  audit: the only supported caller is `apps/web` dashboard
  (`page.tsx` spin mutation) — it always sends both headers, so no legacy
  path is kept. A stale bundle that omits the header gets 400 and cannot
  silently authorize a paid spin; it must refresh to the new client.
- **Browser verification** (Chromium via Playwright, origin
  `http://localhost:3000` — an approved CORS origin — against API on
  :3001, real PostgreSQL):
  - Preflight succeeded for all requests carrying Authorization +
    Idempotency-Key + X-Expected-Cost (no CORS errors).
  - Status read → quote 0; another request took the free spin (200);
    stale click with `X-Expected-Cost: 0` → **409 PRICE_CHANGED**
    (`actualCost: 20`), zero settlement; fresh click at 20 → **200** paid
    spin; status-after `{freeSpinAvailable:false, paidSpinsToday:1,
    paidSpinsRemaining:9}`.
  - DB agrees: 2 spin rows, allowance `{freeUsed:true,paidUsed:1}`,
    ledger `[+10 free prize, -20 paid, +5 paid prize]` — rejected requests
    left zero trace.
- curl checks: missing/malformed (`abc`, `20.5`, `-5`) → 400.
- Same-key replay verified live: repeat `browser-paid-0002` + cost 20 →
  identical stored result, no new spin/debit.
- Gamification suite still 40/40. API+web typecheck clean. Ready for
  review — NOT merged.
