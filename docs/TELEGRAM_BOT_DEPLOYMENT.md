# Telegram bot deployment

## Source of truth

The deployable bot source is `apps/telegram-bot/` in this repository (monorepo `main`). It was imported from the owner's private repo `Jomstaid/EngganyoBot` at commit `2c0e83b` via PR #189 (squash merge `5b9b3a8`). The private repo remains the owner's development history; **deployments are built only from monorepo `main`**. Future bot fixes must land as platform PRs touching `apps/telegram-bot/**` so the two sources do not diverge silently.

**Merging a bot PR does not deploy it.** `.github/workflows/telegram-bot-tests.yml` runs the five test files and nothing else; the platform image build (`deploy.yml`) does not include this Python application. Activation is the manual procedure below.

## Runtime layout (VPS `134.255.232.68`, user `engganyo`)

| Piece | Location / value |
|---|---|
| Deploy root | `/home/engganyo/engganyo-bot/` (flat source copy, not a git checkout) |
| Container | `engganyo_bot`, restart policy `unless-stopped`, bridge network |
| Image | `engganyo-bot:<sha7>` built on the VPS from `Dockerfile.vps` (`python:3.12-slim`, `pip install -r requirements.txt`, `CMD python main.py`) |
| Config | `.env` bind-mounted read-only at `/app/.env` (BOT_TOKEN, OWNER_IDS, ENGGANYO_API_BASE, ENGGANYO_BOT_SERVICE_KEY, ENGGANYO_BOT_USERNAME live here - never in the image, never committed) |
| Persistent data | `data/` -> `/app/data` (`guardbot.db` SQLite WAL + uploaded cards), `logs/` -> `/app/logs` |
| Update mode | long polling (`WEBHOOK_URL` empty). Exactly one consumer per token: never run two instances |

`DEPLOYED_SHA` in the deploy root records what is running. `.dockerignore` excludes `.env`, `data`, `logs`, and the private `docs/CHAT_HISTORY.md` from the image (all arrive via mounts or stay on the host).

## Procedure

1. Transfer the exact reviewed revision from git - never a working-directory archive, so uncommitted or stray files cannot reach production: `git archive <sha> apps/telegram-bot | ssh engganyo@<vps> "rm -rf engganyo-bot-new && mkdir -p engganyo-bot-new && tar x -C engganyo-bot-new --strip-components=2"`. Because the transfer is a git archive it carries no `.env`, `data`, `logs`, or untracked files; secrets and runtime state are also excluded at image-build time by `.dockerignore`.
2. Review `diff -r engganyo-bot engganyo-bot-new` (exclude `.env`, `data`, `logs`, `DEPLOYED_SHA`, `Dockerfile.vps`). Confirm DB schema files unchanged or plan migration/rollback before proceeding.
3. Back up: `tar czf ~/backups/engganyo-bot-<oldsha>-$(date +%Y%m%dT%H%M%SZ).tar.gz -C ~ engganyo-bot` for source/config/cards/logs recovery. The tarball contains a *hot* copy of `guardbot.db` and is **not** the database backup - take the consistent one inside the running container via the sqlite backup API: `docker exec engganyo_bot python -c "import sqlite3; s=sqlite3.connect('/app/data/guardbot.db'); d=sqlite3.connect('/app/data/guardbot-pre-<newsha>.db'); s.backup(d)"`.
4. Overlay: `cp -a engganyo-bot-new/. engganyo-bot/` and clear `__pycache__`. Do not write `DEPLOYED_SHA` yet.
5. Build: `cd engganyo-bot && docker build -f Dockerfile.vps -t engganyo-bot:<newsha7> .`
6. Replace (single instance, in order): `docker stop engganyo_bot && docker rm engganyo_bot`, then `docker run -d --name engganyo_bot --restart unless-stopped -v /home/engganyo/engganyo-bot/.env:/app/.env:ro -v /home/engganyo/engganyo-bot/data:/app/data -v /home/engganyo/engganyo-bot/logs:/app/logs engganyo-bot:<newsha7>`. A restart of the old image is not a deployment.
7. Verify (below). Only after every check passes, record the revision: `echo "<sha> monorepo apps/telegram-bot (source Jomstaid/EngganyoBot <srcsha>)" > engganyo-bot/DEPLOYED_SHA`. Keep the old image and backups until acceptance finishes.

## Post-deploy verification

- `docker logs engganyo_bot`: `platform channel: verified bot identity @EngganyoBot`, `Application started`, no errors.
- `getMe` = `EngganyoBot`, `getWebhookInfo` empty URL, pending 0, no `Conflict: terminated by other getUpdates`.
- Inbox health (read-only): `GET /telegram/bot/inbox/health` on the API with the bot service key returns status counts and recent DEAD rows; expect all rows in terminal states (`DONE`, `DEAD`) and no lease-stuck `CLAIMED`/`INGESTED`. Direct DB check equivalent: `SELECT command, status, count(*) FROM telegram_update_inbox GROUP BY 1,2`.
- Do **not** use `platform_api.recover()` (or the `updates/recover` endpoint) as a health probe: it **claims** reclaimable rows and issues fencing tokens - it is a worker call, not an inspection. Exercise it only through a worker that finishes every row it claims (the JobQueue `engganyo_recover` sweep inside the bot does exactly that).
- Owner-assisted (needs a designated Telegram account): `/status`, `/connect CODE`, both `link<CODE>` and legacy `link_<CODE>` deep links, website claim/confirm, moderation smoke check.

## Rollback

Ordering matters: the bot must be stopped before any data restore, and restarted only after restore checks pass.

1. `docker stop engganyo_bot` - single consumer of the token, and no writes while restoring.
2. Code rollback (if only the code is bad): `docker rm engganyo_bot`, restore the backed-up `engganyo-bot/` tree or re-overlay the old source, `docker run` the same command with image `engganyo-bot:<oldsha7>` (kept on the VPS). Skip to step 5.
3. Database rollback (data corrupted): use the **consistent** copy `data/guardbot-pre-<newsha>.db`. Remove WAL sidecars first - a stale `guardbot.db-wal`/`-shm` would be replayed on top of the restored file: `rm -f data/guardbot.db-wal data/guardbot.db-shm`, then `cp data/guardbot-pre-<newsha>.db data/guardbot.db`. **Restoring loses every change made since the backup was taken** - settings, users, submissions the bot recorded. Only restore when the new state is worse than that loss.
   - The `~/backups/engganyo-bot-*.tar.gz` contains a live-copy `guardbot.db` (and possibly `-wal`/`-shm`); it is not transactionally consistent. Use it for source/config/cards/logs, and treat its database only as a last-resort artifact.
4. Restore checks before restart: inside any python container or the new image, `python -c "import sqlite3; print(sqlite3.connect('/path/to/guardbot.db').execute('PRAGMA integrity_check').fetchone())"` must print `('ok',)`; spot-check a known table (`SELECT count(*) FROM users`).
5. Restart (`docker start` or `docker run` per step 6 above), re-run the post-deploy verification, then update `DEPLOYED_SHA`.

## Current state (2026-11-27)

Running `engganyo-bot:5b9b3a8` = monorepo `5b9b3a8` = `Jomstaid/EngganyoBot` `2c0e83b`. Previous: `a93a21e` (image retained). `docs/CHAT_HISTORY.md` stays on the VPS only - it is the owner's private build history and is intentionally not in the monorepo.
