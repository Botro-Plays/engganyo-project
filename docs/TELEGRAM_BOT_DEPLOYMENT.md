# Telegram bot deployment

## Source of truth

The deployable bot source is `apps/telegram-bot/` in this repository (monorepo `main`). It was imported from the owner's private repo `Jomstaid/EngganyoBot` at commit `2c0e83b` via PR #189 (squash merge `5b9b3a8`). The private repo remains the owner's development history; **deployments are built only from monorepo `main`**. Future bot fixes must land as platform PRs touching `apps/telegram-bot/**` so the two sources do not diverge silently.

## Automated release path (current)

**Merging an approved bot change to `main` now invokes its automated release.** The `Deploy` workflow is a single dependency graph:

```
ci-api ─┐
        ├─> e2e ─> build(api/web images) ─> deploy(API/web/nginx to VPS) ─┐
ci-web ─┘                                                               ├─> deploy-bot
bot-tests ─> changes(scope) ─> build-bot(GHCR) ─────────────────────────┘
perf (report-only) / perf-prod (post-deploy measurement)
```

- `bot-tests` calls the reusable `telegram-bot-tests.yml` in-graph, so a bot release can never run ahead of its tests on the same revision. The same workflow still runs standalone on bot-path PRs.
- `changes` diffs the merge and enables the bot chain only when bot-relevant paths changed: `apps/telegram-bot/**`, `apps/api/src/modules/telegram/**` (the contract the bot consumes), `infra/scripts/deploy-bot.sh`, the two workflow files. Unrelated merges skip bot replacement entirely.
- `build-bot` builds `apps/telegram-bot/Dockerfile` (context `apps/telegram-bot`, governed by its `.dockerignore`) and pushes `ghcr.io/botro-plays/engganyo-project/telegram-bot:<sha>` + `:latest`. Production credentials are never available to build/test jobs.
- `deploy-bot` runs **after** the API deploy so the bot never lands ahead of a contract change it consumes. It SSHes to the VPS and runs `infra/scripts/deploy-bot.sh`.
- Concurrency group `engganyo-release-<ref>` serializes runs; on the VPS a `.deploy-bot.lock` flock plus a merge-base ancestry guard refuse stale releases overwriting newer ones.

PRs get `bot-tests` (and, on bot paths, the standalone workflow check) but never build or deploy production.

## Manual dispatch

`Actions -> Deploy -> Run workflow` on `main` with input **`bot_sha`** = an exact 40-char monorepo SHA already merged to `main`. This redeploys or rolls back the bot only: API/web build+deploy are skipped, `DEPLOY_BOT_FORCE=1` is set for the ancestry guard, and the image tag must already exist in GHCR (with fallback to legacy VPS-local `engganyo-bot:<sha7>` tags).

## Runtime layout (VPS `134.255.232.68`, user `engganyo`)

| Piece | Location / value |
|---|---|
| Deploy root | `/home/engganyo/engganyo-bot/` (source copy kept for ops reference; the running container only needs `.env`, `data`, `logs` from it) |
| Container | `engganyo_bot`, restart policy `unless-stopped`, bridge network |
| Image | `ghcr.io/botro-plays/engganyo-project/telegram-bot:<sha>` (legacy local tags `engganyo-bot:<sha7>` retained as rollback set) |
| Config | `.env` bind-mounted read-only at `/app/.env` (BOT_TOKEN, OWNER_IDS, ENGGANYO_API_BASE, ENGGANYO_BOT_SERVICE_KEY, ENGGANYO_BOT_USERNAME live here - never in the image, never committed, never needed by CI) |
| Persistent data | `data/` -> `/app/data` (`guardbot.db` SQLite WAL + uploaded cards), `logs/` -> `/app/logs` |
| Update mode | long polling (`WEBHOOK_URL` empty). Exactly one consumer per token: never run two instances |

`DEPLOYED_SHA` in the deploy root records what is running; it is written only after post-replacement verification passes.

## What `deploy-bot.sh` does

1. Flocks, validates `.env` key *names* are present (values never printed), refuses a target SHA that is an ancestor of the currently deployed one unless forced.
2. `docker pull`s the new image **before** stopping the old poller; falls back to a matching local `engganyo-bot:<sha7>` tag.
3. Takes a consistent SQLite backup via the running container (`data/guardbot-pre-<sha7>.db`), then a read-only `PRAGMA quick_check` against the new image (`immutable=1` URI, no writes).
4. `docker stop` + `docker rm` the old container, `docker run` the new one with identical mounts and restart policy.
5. Verifies: `Application started` + `verified bot identity` in logs, no `Conflict`/traceback, sustained running (~15s) with restart count 0, exactly one consumer, `getMe` = `ENGGANYO_BOT_USERNAME`, `getWebhookInfo` empty, `GET /telegram/bot/inbox/health` = 200 via the service key.
6. Only then writes `DEPLOYED_SHA`. On any verification failure it restores the **previous image** (previous **data** is never restored automatically) and fails the job.

## Rollback

- **Preferred:** manual dispatch with `bot_sha` = the last known-good monorepo SHA. The image must exist in GHCR; legacy local tags cover pre-automation revisions (`5b9b3a8`, `a93a21e`).
- **On host:** `GHCR_TOKEN=... GITHUB_ACTOR=... DEPLOY_SHA=<sha> DEPLOY_BOT_FORCE=1 bash /opt/engganyo-project/infra/scripts/deploy-bot.sh` (extracts to `/tmp` is equivalent if the checkout is detached).
- **Database:** never auto-restored - that would discard newer user data. Manual DB restore only with explicit authorization: stop the bot first, remove `guardbot.db-wal`/`-shm`, copy the chosen consistent backup over `guardbot.db`, `PRAGMA integrity_check`, then restart. A live-copied tarball DB is not transactionally consistent.

## Failure handling (by design, not by experiment)

- Bot tests fail -> `build-bot`/`deploy-bot` never run.
- Image build/pull fails -> job fails before the old poller is touched (pull precedes stop).
- Startup verification fails -> automatic rollback to the previous image, job fails, `DEPLOYED_SHA` untouched.
- Overlapping releases -> workflow concurrency group + VPS flock + ancestry guard.

## Health probes

Read-only: `GET /telegram/bot/inbox/health` (service key) or `SELECT command, status, count(*) FROM telegram_update_inbox GROUP BY 1,2`. Do **not** use `platform_api.recover()` / `updates/recover` as a probe - it claims reclaimable rows and issues fencing tokens; it belongs only inside a worker that finishes every claimed row (the `engganyo_recover` JobQueue sweep does exactly that).

## Owner-assisted checks (designated chats only)

`/status`, `/connect CODE`, both `link<CODE>` and legacy `link_<CODE>` deep links, website claim/confirm, moderation smoke check, and any QA_LOG items flagged "re-test live" (e.g. F29).

## Current state (2026-11-27)

Running `engganyo-bot:5b9b3a8` = monorepo `5b9b3a8` = `Jomstaid/EngganyoBot` `2c0e83b` (deployed manually; first automated release lands with the next bot-scope merge). `docs/CHAT_HISTORY.md` stays on the VPS only - it is the owner's private build history and is intentionally not in the monorepo or the image.
