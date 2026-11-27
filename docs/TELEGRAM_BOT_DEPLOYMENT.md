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

## Procedure (as run 2026-11-27 for `a93a21e` -> `5b9b3a8`)

1. In the monorepo: `tar czf - apps/telegram-bot | ssh engganyo@<vps> "mkdir -p engganyo-bot-new && tar xzf - -C engganyo-bot-new --strip-components=2"`.
2. Review `diff -r engganyo-bot engganyo-bot-new` (exclude `.env`, `data`, `logs`, `DEPLOYED_SHA`, `Dockerfile.vps`). Confirm DB schema files unchanged or plan migration/rollback before proceeding.
3. Back up: `tar czf ~/backups/engganyo-bot-<oldsha>-$(date +%Y%m%dT%H%M%SZ).tar.gz -C ~ engganyo-bot`, plus a consistent DB copy inside the container: `docker exec engganyo_bot python -c "import sqlite3; s=sqlite3.connect('/app/data/guardbot.db'); d=sqlite3.connect('/app/data/guardbot-pre-<newsha>.db'); s.backup(d)"`.
4. Overlay: `cp -a engganyo-bot-new/. engganyo-bot/`, clear `__pycache__`, write `DEPLOYED_SHA`.
5. Build: `cd engganyo-bot && docker build -f Dockerfile.vps -t engganyo-bot:<newsha7> .`
6. Replace (single instance, in order): `docker stop engganyo_bot && docker rm engganyo_bot`, then `docker run -d --name engganyo_bot --restart unless-stopped -v /home/engganyo/engganyo-bot/.env:/app/.env:ro -v /home/engganyo/engganyo-bot/data:/app/data -v /home/engganyo/engganyo-bot/logs:/app/logs engganyo-bot:<newsha7>`. A restart of the old image is not a deployment.
7. Verify (below). Keep the old image and backup until acceptance finishes.

## Post-deploy verification

- `docker logs engganyo_bot`: `platform channel: verified bot identity @EngganyoBot`, `Application started`, no errors.
- `getMe` = `EngganyoBot`, `getWebhookInfo` empty URL, pending 0, no `Conflict: terminated by other getUpdates`.
- Recovery sweep: `platform_api.recover()` returns a list (authenticated), JobQueue `engganyo_recover` every 30 s.
- Owner-assisted (needs a designated Telegram account): `/status`, `/connect CODE`, both `link<CODE>` and legacy `link_<CODE>` deep links, website claim/confirm, moderation smoke check.

## Rollback

1. `docker stop engganyo_bot && docker rm engganyo_bot`
2. `docker run` the same command with image `engganyo-bot:<oldsha7>` (kept on the VPS).
3. If data was corrupted: restore `~/backups/engganyo-bot-<oldsha>-*.tar.gz` or swap `data/guardbot-pre-<newsha>.db` back to `guardbot.db`.
4. Source rollback: restore the backed-up `engganyo-bot/` tree.

## Current state (2026-11-27)

Running `engganyo-bot:5b9b3a8` = monorepo `5b9b3a8` = `Jomstaid/EngganyoBot` `2c0e83b`. Previous: `a93a21e` (image retained). `docs/CHAT_HISTORY.md` stays on the VPS only - it is the owner's private build history and is intentionally not in the monorepo.
