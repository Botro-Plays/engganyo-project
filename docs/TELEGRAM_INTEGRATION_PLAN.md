# Telegram Integration Plan

Status: planning document only. No bot settings, webhooks, messages, rewards, or deployment are authorized by this document. Reviewed bot revision: `Jomstaid/EngganyoBot` (private) at commit `fd5265e1fb25b618523c4041552cc8d73b5f05ce` (tarball fetched 2026-11-25).

## 1. Current bot capabilities (source-backed)

`EngganyoBot` is a standalone Python group/channel management bot, not a platform integration.

- Stack: Python 3.10+, `python-telegram-bot` 22.x (`[job-queue,rate-limiter]`), SQLite (WAL) at `data/guardbot.db`, Pillow cards, `deep-translator`, optional `nudenet`. No HTTP client dependency (`requests`/`httpx`/`aiohttp`) is present; nothing calls the Engganyo API.
- Transport: long polling by default; optional webhook via `WEBHOOK_URL` + `WEBHOOK_PORT` behind a reverse proxy (`docs/SETUP.md` section 5). No webhook-secret or signature verification logic exists.
- Features (`docs/FEATURES.md`, `docs/COMMANDS.md`: 141 commands, 195 names): protection pipeline (spam shield, flood guard, media/alphabet/adult/word filters, quiet hours, anti-raid, captcha, join approval), greetings, tag-all (`/mentionall`/`@all`), invite contest, Portal (verified entrance with single-use expiring links), announcements, Start Studio, clone bots (users paste their own BotFather token; clones share one SQLite DB), channel tools (composer, planner, mirror, gated posts, welcome flow, fans DM), developer panel `/panel` gated on `OWNER_IDS`, 33 locales.
- Auth model: `OWNER_IDS` env for developer panel; group permissions resolved from Telegram admin rights + DB roles/custom roles (`core/perms.py`). Identity is the Telegram numeric user id everywhere in the bot; there is no concept of an Engganyo account.
- Persistence: per-chat settings as JSON merged over `DEFAULT_SETTINGS`; per-bot audience tables `bot_users`/`bot_chats`; `clones` table holds third-party bot tokens (sensitive); `audit` table exists.
- Tests: `tests/test_core.py` (~1150 checks), `test_flow.py` (~290 checks, faked Telegram API), `test_style.py`, `check_strings.py`. All offline; no live-Telegram or platform integration coverage.
- Deployment: `run.sh`/`run.bat`/`run_forever.ps1` watchdog, or systemd/Docker per docs. Single instance per token (`Conflict: terminated by other getUpdates`).

Source-backed gaps relative to integration goals:

- No Engganyo API client, no account linking, no platform identity.
- No webhook authentication/replay protection (webhook mode is bare).
- No outbound delivery abstraction (retry, dedup, rate-limit accounting); PTB rate-limiter covers inbound API throttling only.
- `clones` stores third-party bot tokens in shared SQLite - must never be reachable from any integration surface.
- Usernames are used to identify people in commands (`/ban @user`); Telegram usernames are mutable and must never anchor ownership.

## 2. Phased integration architecture

Engganyo (apps/api + Postgres) is the authoritative source for accounts, permissions, tasks, and financial state. The bot is a thin client: it authenticates to a private bot API with a service credential, renders what the API returns, and never computes balances, eligibility, or proof outcomes itself.

```
Telegram <-> PTB Application (bot process, VPS-side or managed host)
              |  signed HTTPS calls, service token
              v
apps/api: /telegram/bot/* module (private, IP/secret restricted)
              |  Prisma / existing services (authoritative)
              v
        PostgreSQL
```

- Phase 0 (this doc): audit + design. No code activation.
- Phase 1: account linking (challenge flow, below) + read-only identity (`/link`, `/unlink`, `/status`, `/balance` display). Private-chat only.
- Phase 2: notification delivery (platform -> bot -> user DM) with the notification contract in section 6.
- Phase 3: group/channel features: admin-verified group linking, optional task feeds/announcements into owner-managed groups.
- Phase 4 (separate approval): task verification via Telegram actions (section 8).
- Financial actions are deferred out of every phase unless separately approved (section 9).

Bot-side changes are additive modules under `guardbot/` (e.g. `handlers/platform.py` + a small `platform_api.py` client) so the standalone moderation feature set is untouched.

## 3. Secure account linking

Design goal: bind a verified Telegram numeric user id (`message.from.id`, supplied by Telegram, unforgeable) to one Engganyo account. Never reserve ownership through a typed username - usernames change and are spoofable.

Flow:

1. Signed-in user opens Settings -> Connected accounts -> Telegram -> "Link via bot". The API issues a short-lived, single-use challenge: `tglink_<random 128-bit>` (store hash only; TTL 10 minutes; one active per user).
2. UI shows a deep link `https://t.me/EngganyoBot?start=tglink_<code>` (Telegram start parameter; `startapp` is for mini apps, not needed here).
3. Bot receives `/start tglink_<code>` in private chat, calls `POST /telegram/bot/link/claim` with `{code, telegramUserId, chatId, firstName?}`. API verifies the code atomically (single-use consume in a transaction), creates the link row, and returns a display name. Bot confirms in-chat.
4. The reverse direction also works: `/link` in the bot shows "open engganyo.com and paste code `XYZ-1234`" - a short-lived code the user types into Settings (same challenge record, two UX paths, one table).

Schema (new, minimal): `telegram_links` { userId unique, telegramUserId unique, telegramChatId, linkedAt, unlinkedAt?, notifyOptIn bool default false, lastSeenAt }. Link state lives in Postgres, not in `guardbot.db` (the bot caches nothing authoritative).

The existing `socialIdentity` machinery applies: a verified Telegram link is a `linkVerifiedAccount`-class identity. The 24-hour post-unlink reservation (`releaseVerifiedIdentity`) already prevents instant identity hand-off; the link write must route through that reservation check (see section 4).

## 4. Explicit decisions (owner-sign-off needed where marked)

| Situation | Proposed rule | Owner decision? |
|---|---|---|
| Unlink by the Engganyo user | Soft-delete the link (`unlinkedAt`), keep the row + 24h verified-identity reservation exactly as social-auth does today; notifications stop immediately | No (matches existing policy) |
| Unlink from Telegram side (`/unlink` in bot) | Same soft-delete via API; bot confirms. Never a hard delete | No |
| 24h identity reservation | Reuse `socialIdentity` reservation: a verified `telegramUserId` cannot be claimed by a different Engganyo user for 24h after unlink | No (already implemented for social identities; extend to telegram_links or register the same table) |
| Relinking the same account | Free within or after the window: same user + same telegram id is always allowed | No |
| Account deletion | Deleting the Engganyo account hard-deletes/pseudonymizes the link row (telegramUserId retained only as a salted hash for the reservation window, then purged). Personal data minimization per section 7 | Yes - confirm retention shape |
| Disputed ownership ("someone linked my Telegram") | Only numeric-id-verified links exist, so a dispute means the challenger controls the Telegram account: support flow revokes the link, logs to `audit`, applies the 24h reservation to the *claimant*, and rate-limits re-claims. No automated "prove it" flow beyond a fresh challenge | Yes - approve support procedure |
| Two Engganyo accounts, one Telegram | Forbidden by the unique constraint; second claim gets `identity_reserved` with the availability timestamp (existing error shape) | No |
| Bot-side admin verification in groups | A group is "linked" to an Engganyo org/campaign only when the linking user is verified as a group administrator via `getChatMember` at link time AND re-verified periodically (member-status updates + daily re-check) | No |

## 5. Private chat vs group/channel permissions

- Private chat: identity and notifications only. Any `/balance`-style command requires a linked account and answers only to the owner (`telegramUserId` match). No admin rights needed.
- Group/channel features require: (a) bot is admin with the needed rights (existing `/reload` check), (b) the linking Engganyo user holds a verified link and is verified admin of that chat via `getChatMember` at link time, (c) re-verification on `chat_member`/`my_chat_member` updates and on a periodic sweep; a demoted admin's group linkage is suspended, not silently kept.
- Anonymous admins: Telegram hides their identity; group linkage must be attributed to a named admin (match existing bot behavior for anonymous senders) or refused. Proposed: refuse group-admin linkage for anonymous admins (documented).

## 6. Notifications

- Opt-in model: `notifyOptIn` default false; `/notifications` in bot and Settings toggle both write the same row. Per-category flags (task status, review result, payout, security alerts). Security alerts may be non-optional (owner decision).
- Rate limits: per-user cap (e.g. 10/day, burst 3) enforced API-side; per-category quiet hours optional. Global send budget protects the bot token (Telegram ~30 msg/s, ~1 msg/s per chat - PTB rate-limiter already honors API limits).
- Retries: platform-side outbox table (`telegram_outbox`: id, telegramUserId/chatId, payload hash, status, attempts, nextAttemptAt, lastError). Exponential backoff, max ~8 attempts over ~24h, dead-letter row surfaced in admin panel. Telegram `chat not found`/`bot was blocked` errors mark the link undeliverable and stop retries (failure is visible, not silent).
- Dedup: deterministic `dedupKey` (event type + entity id + recipient); unique constraint; retries of the same outbox row are idempotent sends.
- Ordering: FIFO per recipient; no guarantee across recipients.
- Failure visibility: admin panel counter + per-user "last delivery failed" notice in Settings; the outbox row is the audit.

## 7. Webhook security, secrets, retention

- Webhook mode must gain, before any use: `secret_token` on `setWebhook` + verification of `X-Telegram-Bot-Api-Secret-Token` on every update; `allowed_updates` allowlist (`message`, `callback_query`, `chat_member`, `my_chat_member`, `chat_join_request`); HTTPS-only behind the existing nginx; update `update_id` dedup for replay protection (persist last processed id per bot; reject `<=`); drop updates older than a TTL (e.g. 5 min) to bound delayed-replay effects.
- Long polling is acceptable for phase 1 (no inbound endpoint at all); webhook is only needed for group-scale later phases.
- Secrets: `BOT_TOKEN` and the platform service token live in env/secret store, never in `guardbot.db`, logs, or the repo. The existing `clones` table (third-party tokens) is out of scope and must stay unreachable from integration code paths.
- Minimal retention: the API stores only `telegramUserId`/`chatId` (needed to deliver), link timestamps, opt-in flags, and outbox metadata (payload hash + status, not full text past delivery window). No message content is persisted from Telegram. Logs redact tokens by construction (PTB already truncates tokens in URLs).

## 8. Task verification via Telegram (phase 4 candidate)

Concrete limitations to state plainly:

- Bots cannot read group member lists; join detection works only for chats where the bot is admin (via `getChatMember` spot-check or `chat_member` updates). A "join this group" task is verifiable only for bot-administered chats.
- Public-channel join is not directly readable; `chat_join_request` works only for invite-link-request flows.
- Verifying "follow/subscribe" on channels the bot does not administer is impossible; `getChatMember` works only where the bot is present.
- Message/action verification (reacted, commented, posted) is readable only in bot-member groups; in channels, comments live in the linked discussion group.
- Rate limits: `getChatMember` per proof check is API-call-bound; batch/queue checks.

Proposed scope if approved: only "join a bot-administered group/channel" tasks, with `getChatMember` re-check at proof review + anti-leave re-check at settlement. Everything else stays out until separately designed.

## 9. Financial actions

Deferred from all planned phases. If later proposed: every financial intent is created and authorized server-side (never from a bot message alone), requires a second explicit confirmation step, and settles through the existing idempotency-key contract (`chat_request_keys` pattern) so retries and duplicate taps settle exactly once. A bot chat id is a notification address, never an authorization credential. This needs its own approval before any design is finalized.

## 10. Deployment, monitoring, rollback, acceptance

- Topology: bot process on the VPS as its own systemd unit (or container) with `Restart=always`, dedicated `BOT_TOKEN`, service credential scoped to `/telegram/bot/*` only, outbound-only egress to api.telegram.org + engganyo.com. Polling in phase 1 keeps the attack surface minimal.
- Monitoring: process health + update-loop heartbeat; outbox depth and dead-letter count alerts; Telegram API error-rate counters; `getUpdates`/webhook lag metric; audit log on link/unlink/claim-fail events.
- Rollback: feature flags per surface (`TELEGRAM_LINKING`, `TELEGRAM_NOTIFY`, `TELEGRAM_GROUPS`); unlink-all admin action; revoking the service credential instantly disables the channel without touching bot moderation.
- Acceptance tests (before any user-facing enable): challenge mint -> claim -> link row; single-use + expiry; wrong-account claim -> `identity_reserved` + timestamp; unlink -> 24h reservation blocks foreign claim but allows same-account relink; admin verification grant/revoke on `getChatMember` transitions; outbox dedup on repeated event, retry-on-429 honoring `retry_after`, dead-letter after cap; blocked-by-user stops retries and flags the link; no token in logs.

## 11. Ordered implementation backlog

1. `telegram_links` migration + `POST /telegram/link/challenge` (Settings UI) - no bot change needed to land.
2. `POST /telegram/bot/link/claim` + bot `/start` deep-link handler + `/link` reverse path.
3. `/unlink` (both sides) wired through the verified-identity reservation.
4. `/status` + `/balance` read-only private-chat commands.
5. `telegram_outbox` + notification categories + opt-in UI (Settings + `/notifications`).
6. Delivery worker honoring retry/dedup/dead-letter + admin visibility.
7. Group linkage (admin verification + re-verification sweep) behind `TELEGRAM_GROUPS`.
8. Webhook hardening pack (secret token, update dedup, allowlist) - prerequisite to any group scale-out.
9. Phase-4 task-verification spike (bot-administered joins only) - separate PR + approval.

## 12. Owner decisions register

Separately flagged for Jomar (everything else above is routine engineering):

1. Account-deletion retention shape for `telegram_links` (section 4).
2. Disputed-ownership support procedure (section 4).
3. Whether security alerts may bypass opt-out (section 6).
4. Phase-4 task verification scope (section 8).
5. Any future financial actions (section 9) - separate approval required.
6. Where the bot process runs (same VPS vs separate host) and who holds `BOT_TOKEN`/`@BotFather` ownership.
