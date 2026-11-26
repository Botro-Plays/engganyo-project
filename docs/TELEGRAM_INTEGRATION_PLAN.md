# Telegram Integration Plan

Status: Phase 1 implemented behind a disabled feature flag - nothing is activated. No bot settings, webhooks, messages, rewards, or live delivery are authorized by this document. Reviewed bot revision: `Jomstaid/EngganyoBot` (private) at commit `fd5265e1fb25b618523c4041552cc8d73b5f05ce` (tarball fetched 2026-11-25).

Identities: the **official bot is `https://t.me/EngganyoBot`** (`@EngganyoBot`). The community destination `https://t.me/Engganyo` (`@Engganyo`) is separate and unchanged - they serve different purposes and bot deep links must never point at the community handle.

Hosting check (2026-11-26, VPS `134.255.232.68`): no EngganyoBot process, container, or systemd unit exists on the platform VPS - the moderation bot is hosted elsewhere (or not currently running). Because Telegram allows exactly one update consumer per token (getUpdates XOR webhook), the Phase-1 bot commands are implemented inside the existing EngganyoBot process rather than as a second poller.

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
- Phase 1: account linking (challenge flow, below) + minimal private-chat commands (`/connect <code>`, `/disconnect`, `/status`, plus `/start link_<code>` deep-link routing inside the existing `/start` dispatcher). `/link` and `/unlink` are intentionally NOT the command names: the moderation surface already owns `/link` (group invite link) and `/unlink` (revoke invite link). `/status` was unused and reports link state. Balance/financial display stays out of Phase 1 entirely.
- Phase 2: notification delivery (platform -> bot -> user DM) with the notification contract in section 6.
- Phase 3: group/channel features: admin-verified group linking, optional task feeds/announcements into owner-managed groups.
- Phase 4 (separate approval): task verification via Telegram actions (section 9).
- Financial actions are deferred out of every phase unless separately approved (section 10).

Bot-side changes are additive modules under `guardbot/` (e.g. `handlers/platform.py` + a small `platform_api.py` client) so the standalone moderation feature set is untouched.

## 3. Secure account linking

Design goal: bind a verified Telegram numeric user id to one Engganyo account. Never reserve ownership through a typed username - usernames change and are spoofable.

Trust boundary first: the numeric `telegramUserId` is **not inherently trustworthy API input**. It is trusted only because it arrives through the authenticated bot-to-platform channel (`POST /telegram/bot/*` requires the bot service credential, scoped and rotatable). The API must never accept a `telegramUserId` from the public/user-facing surface - the only paths that may stamp a Telegram identity are the bot-authenticated claim endpoints below. Website-side requests carry the challenge code, never a raw id.

Flow:

1. Signed-in user opens Settings -> Connected accounts -> Telegram -> "Link via bot". The API issues a short-lived, single-use challenge: an 8-character code from an unambiguous alphabet (~40 bits over a 10-minute window), stored on `telegram_link_challenges` with `expiresAt`; minting supersedes any still-PENDING code so at most one usable code exists per user.
2. UI shows a deep link `https://t.me/EngganyoBot?start=link_<code>`. The `link_` prefix routes inside the bot's existing `/start` arg dispatcher without colliding with its other deep-link args (`portal_`, `lk<n>`, `cfg_`, `anon`, `help`).
3. The bot submits the update to the platform inbox (`POST /telegram/bot/updates`, enqueue + claim) carrying the full immutable input `{command, args(code), telegramUserId, username?, firstName?, chatId}` - persisted once, never rewritten. It then applies the effect (`POST /telegram/bot/commands` with just `{updateId, claimToken}`; effects run from the stored input). The API CAS-marks the challenge CLAIMED atomically (first claimant wins) and records the pending claim - no link is written yet.
4. The website then shows a confirmation step inside the authenticated session: "Link Telegram account @username (id 123456789, First Name)?" - the user sees exactly which Telegram account claimed the code and must confirm before the binding commits. This is the control that defeats forwarded deep links: anyone can forward `?start=link_...`, but the victim sees the attacker's identity on their own Settings page and declines.
5. On confirm, `POST /telegram/linking/confirm` submits the opaque `claimId` shown in the status payload and re-verifies it under the challenge row lock: owner, CLAIMED status, live expiry, and the immutable Telegram identity stamped at claim time all must hold - it never confirms "whichever claim is latest". A stale screen confirming a superseded/expired claim gets an error. The binding runs in the same transaction through the verified-identity shape (slot lock -> upsert -> claim -> release prior verified id -> consume reservation) plus the `telegram_links` history row. Decline (`POST /telegram/linking/decline`) targets the exact displayed `claimId` too - it cancels that attempt whether it is minted-but-unclaimed or already claimed, and only that one.
6. Challenge minting is serialized per user (user-row lock in the mint tx): concurrent mints can never produce two usable codes. A new mint supersedes BOTH pending and claimed attempts - the latest mint always wins. The confirmation names the claiming account including its numeric Telegram id, since names are not unique.

Reverse direction (`/connect <code>` typed into the bot): the same code works when typed by hand - the alphabet excludes 0/O/1/I/L for this. Claims are bounded by the code's ~40-bit entropy, its 10-minute expiry, single-use consumption, and the confirm page naming the claiming Telegram account before binding. Forwarding the deep link remains the only practical abuse path - mitigated by step 4, not by secrecy alone.

Concurrent claims: the challenge is consumed atomically - the first bot-claim wins; later claims on the same code get `challenge_used`/`challenge_expired`. A second Telegram account claiming a forwarded link cannot silently bind anything: the pending claim can only be completed by the issuing website session, which sees the claimed identity first.

Schema and the single identity authority:

- The `socialIdentity` verified-identity record is the **sole authority** for "which Engganyo user owns this Telegram id". Telegram registers as `platform=TELEGRAM` with `stableId=<telegramUserId>` and goes through `linkVerifiedAccount` / `releaseVerifiedIdentity` / `claimVerifiedIdentity` / `consumeReservation` exactly like other verified platforms. There must not be a second, independently mutable identity table - the existing reservation check, 24h post-unlink hold, and `identity_reserved` semantics then apply uniformly.
- `telegram_links` is a **link-history record only**: `{ userId, telegramUserId, telegramUsername?, telegramFirstName?, linkedAt, unlinkedAt? }`. It carries no ownership authority of its own. Phase-1 keeps no chatId/opt-in columns - notification delivery fields land with Phase 2 alongside the opt-in UI.
- Resolving the uniqueness conflict: an ALL-rows unique constraint on `telegramUserId` would permanently block relinking by any account after a soft delete - wrong. Uniqueness applies to the **active link only**: partial unique index `telegram_links.telegramUserId WHERE unlinkedAt IS NULL` (and the same on `userId`). Unlinked rows are retained history for audit; the ownership authority is the identity record above, which is where the 24h reservation actually lives.

Error states, plainly:

- `identity_taken`: an active link already binds this Telegram id to a **different** Engganyo account. Not retryable; only unlink/dispute frees it.
- `identity_reserved`: no active link, but the verified-identity reservation (24h post-unlink) still holds for a different account. Retryable at the returned `availableAt`; the original owner may always reconnect immediately by re-verifying (a fresh challenge + confirm), which consumes their own reservation.
- `challenge_used` / `challenge_expired` / `challenge_unknown`: claim-time failures - never produce pending claims or partial links.

## 4. Explicit decisions (owner-sign-off needed where marked)

| Situation | Proposed rule | Owner decision? |
|---|---|---|
| Unlink by the Engganyo user | Soft-delete the link (`unlinkedAt`), keep the row + 24h verified-identity reservation exactly as social-auth does today; notifications stop immediately. Every unlink entry point converges on one shared detach: the telegram endpoint, the bot `/disconnect` effect, and the generic social Disconnect (`socialAuth.disconnect`, `users.removeSocialLink`) all soft-delete the active link AND expire open challenges inside the same transaction that releases the verified identity - no second mutable authority can outlive it | No (matches existing policy) |
| Unlink from Telegram side (`/unlink` in bot) | Same soft-delete via API; bot confirms. Never a hard delete | No |
| 24h identity reservation | The `socialIdentity` reservation is the sole mechanism: after unlink, a verified `telegramUserId` cannot be claimed by a different Engganyo user for 24h; the original owner re-verifies freely at any time (their own reservation is consumed, not blocking) | No (existing machinery, extended to platform=TELEGRAM) |
| Relinking the same account | Free within or after the window: same user + same telegram id always confirms | No |
| Account deletion | Deleting the Engganyo account soft-deletes the link row and pseudonymizes the identity record (telegramUserId retained only as the reservation key for the 24h window, then released). Personal data minimization per section 7 | Yes - confirm retention shape |
| Disputed ownership | Concrete reviewed procedure (below) - a human reviews; no automated self-serve transfer | Yes - approve procedure |
| Two Engganyo accounts, one Telegram | The active-link partial unique index forbids it; the second claim gets `identity_taken` (distinct from `identity_reserved`, which names a retryable `availableAt`) | No |
| Bot-side admin verification in groups | A group is "linked" to an Engganyo org/campaign only when the linking user is verified as a group administrator via `getChatMember` at link time AND re-verified periodically (member-status updates + daily re-check) | No |

**Disputed-ownership procedure (concrete, human-reviewed).** A claim that "someone linked my Telegram" means the claimant controls the Telegram account but a link exists on an Engganyo account they say is not theirs:

1. Reporter files a dispute via the support channel, including the Telegram numeric id (from @userinfobot - a public, shareable fact, not a secret).
2. Reviewer looks up `telegram_links` for an ACTIVE link on that id. No active link -> nothing to dispute; the reporter can simply link normally (subject to the reservation rules).
3. Proof of Telegram control: the bot delivers a one-time, short-lived confirmation code to that account's private chat (only the account holder can read it); the reporter returns the code through the support channel. This proves control of the Telegram account without trusting a typed username.
4. On confirmed control: the active link is soft-deleted with reason `dispute_revoked`; an `audit` row records reviewer, reporter, telegram id, and the displaced userId; a security notification email goes to the displaced Engganyo account; the released identity enters the normal 24h reservation so the claimant can re-link after the hold (or immediately if the reviewer marks the dispute fraudulent-by-error, e.g. an old account of the same person).
5. Rate-limit disputes per reporter and per identity; a second dispute on the same identity within 30 days escalates to owner review. No path in this flow lets the reporter learn the displaced account's identity or data.

## 5. Private chat vs group/channel permissions

- Private chat: identity and notifications only. Any `/balance`-style command requires a linked account and answers only to the owner (`telegramUserId` match). No admin rights needed.
- Group/channel features require: (a) bot is admin with the needed rights (existing `/reload` check), (b) the linking Engganyo user holds a verified link and is verified admin of that chat via `getChatMember` at link time, (c) re-verification on `chat_member`/`my_chat_member` updates and on a periodic sweep; a demoted admin's group linkage is suspended, not silently kept.
- Anonymous admins: Telegram hides their identity; group linkage must be attributed to a named admin (match existing bot behavior for anonymous senders) or refused. Proposed: refuse group-admin linkage for anonymous admins (documented).

## 6. Notifications

- Opt-in model: `notifyOptIn` default false; `/notifications` in bot and Settings toggle both write the same row. Per-category flags (task status, review result, payout, security alerts). Security alerts may be non-optional (owner decision).
- Rate limits: per-user cap (e.g. 10/day, burst 3) enforced API-side; per-category quiet hours optional. Global send budget protects the bot token (Telegram ~30 msg/s, ~1 msg/s per chat - PTB rate-limiter already honors API limits).
- Retries: platform-side outbox table `telegram_outbox` retains enough to actually retry: `{ id, recipient(telegramUserId/chatId), payload OR sourceRef, dedupKey, status, attempts, nextAttemptAt, lastError }`. A payload hash alone cannot retry - the row carries either the rendered text (small, no secrets, scrubbed) or a `sourceRef` (event type + entity id) the worker re-renders from authoritative data at send time. Prefer `sourceRef` where the event maps to a durable entity so retries reflect current state; `payload` where the text was already produced. Exponential backoff, max ~8 attempts over ~24h, then dead-letter surfaced in the admin panel. Telegram `chat not found`/`bot was blocked` errors mark the link undeliverable and stop retries (failure is visible, not silent).
- Dedup: deterministic `dedupKey` (event type + entity id + recipient) with a unique constraint prevents double-enqueue. Retries of the same outbox row are idempotent sends.
- **Delivery is at-least-once, honestly stated.** Telegram sends are not transactional: a send that succeeded server-side but whose response was lost will be retried and the recipient may see a duplicate. The dedup key prevents duplicate *enqueue*, not a duplicate *send* on a lost response. Design accepts this: notifications are display-only (no "credited X" that could read as double-applied) and duplicate text is the documented worst case. There is no recipient-side dedup available through the Bot API.
- Ordering: FIFO per recipient on a best-effort basis; no guarantee across recipients and no guarantee after retries (a retried row may land after later rows).
- Failure visibility: admin panel counter + per-user "last delivery failed" notice in Settings; the outbox row is the audit.

## 7. Webhook security, secrets, retention

- Webhook mode must gain, before any use: `secret_token` on `setWebhook` + verification of `X-Telegram-Bot-Api-Secret-Token` on every update; `allowed_updates` allowlist (`message`, `callback_query`, `chat_member`, `my_chat_member`, `chat_join_request`); HTTPS-only behind the existing nginx.
- Update deduplication is a **durable inbox**, not a seen-set and not a scalar comparison: `telegram_update_inbox` holds one row per `(bot_username, update_id)` with `status` (PENDING/CLAIMED/DONE/DEAD), `attempts`, `worker_id`, `claim_token`, `lease_until`, `last_error`, the immutable command input (`command`, `command_args`, `telegram_user_id/username/first_name`, `chat_id`), and a stored `result`. The unique key maps every redelivery of the same update to the same row. A "reject `update_id <= last_processed`" rule is wrong (ids are monotonic but **not dense**, delivery is unordered, and Telegram re-delivers stale updates after inactivity), and a bare insert-first seen-set is also wrong: recording an update and then crashing must not skip it forever.
- Claim semantics close that crash window: `POST /telegram/bot/updates` enqueues **and** claims in one transaction, persisting the immutable input on first sight. Every claim issues a fresh **`claim_token`** - effects (`POST /telegram/bot/commands`), completion (`updates/complete`), and failure (`updates/fail`) all require it, so a stale attempt is fenced even when the worker id is reused across reclaims. Effects are bound to the stored input: the apply body carries only `{updateId, claimToken}`, so no caller can substitute params for the same update id. A row is claimable when PENDING or when a prior CLAIMED lease expired; the first application stores the result on the row and a redelivery replays it verbatim instead of re-running effects. Attempts are bounded: a row claimed more than `TELEGRAM_INBOX_MAX_ATTEMPTS` times goes DEAD and surfaces via `GET /telegram/bot/inbox/health`.
- **Autonomous recovery does not depend on Telegram redelivery.** Polling acknowledges updates via its offset, so an update the worker crashes on after ack would never arrive again. `POST /telegram/bot/updates/recover` claims reclaimable rows (PENDING or expired-lease CLAIMED, `FOR UPDATE SKIP LOCKED`, bounded batch) and returns each with its immutable input, `chatId` for the reply, fresh `claim_token`, and any stored `result`. The bot sweeps at startup and periodically: a crash *before* effects gets applied and replied; a crash *after* effects gets re-replied from the stored result and completed - the real process-restart boundary is covered, not just manual re-ingest.
- **Age is not a validity signal.** Do not discard updates older than ~5 minutes - a delayed legitimate event (a join, a member-status change, a queued message) still reflects real state and must be processed. Validity lives in the data, not the clock: a linking-challenge claim is checked against that challenge row's own expiry (a delayed claim on an expired code fails safely by lookup), and state events are applied regardless of arrival time. The only age-sensitive items are purely ephemeral effects, and even those defer to semantic checks over wall-clock cuts.
- Long polling is acceptable for phase 1 (no inbound endpoint at all); webhook is only needed for group-scale later phases.
- Secrets: `BOT_TOKEN` and the platform service token live in env/secret store, never in `guardbot.db`, logs, or the repo. The existing `clones` table (third-party tokens) is out of scope and must stay unreachable from integration code paths.
- Minimal retention: the API stores only `telegramUserId`/`chatId` (needed to deliver), link timestamps, opt-in flags, and outbox rows (payload or sourceRef, scrubbed, deleted on delivery; dead-letter retained ~30d for audit). No message content is persisted from Telegram. Logs redact tokens by construction (PTB already truncates tokens in URLs).

## 8. Threat model

| Threat | Vector | Mitigation |
|---|---|---|
| Impersonation | Attacker claims a challenge with a different Telegram account, or types a reverse code to bind someone else's Telegram identity | The website confirm step (section 3 step 4) names the claiming Telegram account before binding - a wrong identity is declined. `telegramUserId` is only ever stamped through the bot-authenticated channel, never accepted as public API input. |
| Forwarded deep link | `?start=link_<code>` forwarded to another Telegram user lets *their* account claim your code | Code alone never binds - it produces a pending claim visible only to the issuing website session, which sees the foreign identity and declines. Codes are single-use, 10-minute TTL. |
| Reverse-code guessing | `/link`-style short codes typed into Settings | >=32-bit entropy, <=10 attempts per account, 10-minute expiry, per-account rate limit, and the same identity-naming confirm step. Deep-link codes carry 128 bits so guessing is not viable. |
| Service-token / BOT_TOKEN leakage | A leaked bot service credential lets an attacker submit arbitrary `(code, telegramUserId)` claims; a leaked BOT_TOKEN lets them read updates or send as the bot | Service credential is scoped to `/telegram/bot/*` only, rotatable, in env/secret store; pending claims still require website confirmation so a leaked service token alone cannot bind accounts - it can only create pending claims (spam-limited). BOT_TOKEN revocation is a kill-switch; clone tokens in `guardbot.db` stay unreachable from integration code paths. |
| Account takeover (Engganyo side) | Attacker with the website session links their own Telegram to the victim account | Confirmation is explicit inside the session; unlink + dispute procedure (section 4) revokes with audit trail; a security email goes to the displaced owner on any dispute revoke. |
| Replay | Re-delivered webhook updates, duplicated `getUpdates` results, retried deliveries | Durable per-bot inbox: unique `(bot, update_id)` rows with claim/lease recovery, idempotent effect results stored on the row, bounded attempts with DEAD visibility, no arrival-order assumptions, no age-based discards - delayed but legitimate events are still applied (section 7). |
| Spam / abuse | Bot used to message users or groups at scale | Notification outbox with per-user caps, global send budget, per-category opt-in, rate limits, dead-letter visibility; no user-triggered arbitrary-message surface. |
| Multi-account farming | One Telegram user links many Engganyo accounts to multiply rewards | Active-link uniqueness on `telegramUserId` (one Engganyo account per Telegram id); the 24h verified-identity reservation prevents rapid identity hand-off between accounts; dispute path handles contested claims. |

## 9. Task verification via Telegram (phase 4 candidate)

Concrete limitations to state plainly:

- Bots cannot read group member lists; join detection works only for chats where the bot is admin (via `getChatMember` spot-check or `chat_member` updates). A "join this group" task is verifiable only for bot-administered chats.
- Public-channel join is not directly readable; `chat_join_request` works only for invite-link-request flows.
- Verifying "follow/subscribe" on channels the bot does not administer is impossible; `getChatMember` works only where the bot is present.
- Message/action verification (reacted, commented, posted) is readable only in bot-member groups; in channels, comments live in the linked discussion group.
- Rate limits: `getChatMember` per proof check is API-call-bound; batch/queue checks.

Proposed scope if approved: only "join a bot-administered group/channel" tasks, with `getChatMember` re-check at proof review + anti-leave re-check at settlement. Everything else stays out until separately designed.

## 10. Financial actions

Deferred from all planned phases. If later proposed: every financial intent is created and authorized server-side (never from a bot message alone), requires a second explicit confirmation step, and settles through the existing idempotency-key contract (`chat_request_keys` pattern) so retries and duplicate taps settle exactly once. A bot chat id is a notification address, never an authorization credential. This needs its own approval before any design is finalized.

## 11. Deployment, monitoring, rollback, acceptance

- Topology: bot process on the VPS as its own systemd unit (or container) with `Restart=always`, dedicated `BOT_TOKEN`, service credential scoped to `/telegram/bot/*` only, outbound-only egress to api.telegram.org + engganyo.com. Polling in phase 1 keeps the attack surface minimal.
- Monitoring: process health + update-loop heartbeat; outbox depth and dead-letter count alerts; Telegram API error-rate counters; `getUpdates`/webhook lag metric; audit log on link/unlink/claim-fail events.
- Rollback: feature flags per surface (`TELEGRAM_LINKING`, `TELEGRAM_NOTIFY`, `TELEGRAM_GROUPS`); unlink-all admin action; revoking the service credential instantly disables the channel without touching bot moderation.
- Acceptance tests (before any user-facing enable): challenge mint -> bot claim -> pending claim -> website confirm of the exact `claimId` (naming the Telegram account incl. numeric id) -> link row; concurrent mints serialized to one usable code; a new mint superseding a CLAIMED attempt makes the stale screen's confirm fail; confirm of a foreign/nonexistent/superseded claim refuses; decline cancels minted and claimed attempts; single-use + expiry; forwarded-link claim by a foreign Telegram account is visible and declinable, never silently bound; reverse-code attempts capped; wrong-account claim -> `identity_taken` vs post-unlink `identity_reserved` + `availableAt`; unlink (telegram endpoint, bot `/disconnect`, and the generic social Disconnect) detaches link/history/challenge atomically and blocks foreign claims for 24h while allowing same-account relink; admin verification grant/revoke on `getChatMember` transitions; durable update dedup on re-delivery, out-of-order, post-inactivity batches, stale-claimToken fencing with reused workerId, immutable-input binding (replacement params never apply), and process-restart sweep recovery without Telegram redelivery; outbox dedup on repeated event, retry-on-429 honoring `retry_after`, dead-letter after cap; blocked-by-user stops retries and flags the link; no token in logs.

## 12. Ordered implementation backlog

1. ~~`telegram_links`/`telegram_link_challenges`/`telegram_update_inbox` migration + user endpoints (`/telegram/linking/*`) + Settings UI~~ - implemented.
2. ~~Bot channel (`/telegram/bot/*`, service-key guard, runtime-validated DTOs) + durable inbox (claim/lease, per-attempt claim-token fencing, immutable-input effects, bounded attempts, DEAD health, autonomous `updates/recover` sweep)~~ - implemented.
3. ~~`connect`/`disconnect`/`status` effects wired through the verified-identity reservation~~ - implemented.
4. ~~Bot-side handlers (`/start link_` routing, `/connect`, `/disconnect`, `/status`) in the EngganyoBot process + getMe identity check~~ - implemented as an EngganyoBot-repo change (`Jomstaid/EngganyoBot` PR #1).
5. `telegram_outbox` + notification categories + opt-in UI (Settings + `/notifications`).
6. Delivery worker honoring retry/dedup/dead-letter + admin visibility.
7. Group linkage (admin verification + re-verification sweep) behind `TELEGRAM_GROUPS`.
8. Webhook hardening pack (secret token, durable per-bot update dedup, allowlist, crash-recoverable processing) - prerequisite to any group scale-out.
9. Phase-4 task-verification spike (bot-administered joins only) - separate PR + approval.

## 13. Owner decisions register

Separately flagged for Jomar (everything else above is routine engineering):

1. Account-deletion retention shape for `telegram_links` (section 4).
2. Disputed-ownership support procedure (section 4).
3. Whether security alerts may bypass opt-out (section 6).
4. Phase-4 task verification scope (section 9).
5. Any future financial actions (section 10) - separate approval required.
6. Where the bot process actually runs today - VPS check 2026-11-26 found no bot process/container/unit on `134.255.232.68`, so its host is still unconfirmed - and who holds `BOT_TOKEN`/`@BotFather` ownership.
