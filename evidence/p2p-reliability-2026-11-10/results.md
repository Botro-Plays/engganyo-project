# P2P reliability follow-up — cold-load 429s + chat readiness

Date: 2026-11-10 · Deployed SHA: `3ffe744` (PRs #66 `8565df5`, #67 `3ffe744`)
Deploy run: [42791889004](https://github.com/Botro-Plays/engganyo-project/actions/runs/42791889004) — all jobs green.
Live site: engganyo.com, labeled accounts `devin_p2p_a` / `devin_p2p_b`, same public IP, reCAPTCHA enabled, normal sessions (owner-assisted Edge logins on CDP :9222/:9223).

## 1. Corrected cold-load 429 record — was OPEN, now measured closed

### Original incident (2026-11-10 ~04:32 UTC, deploy `9d9de0b`)

19 HTTP 429s during simultaneous two-account cold loads. Endpoint accounting
(9 per account, all inside ~1.2s):

| Account | 429'd endpoints |
|---|---|
| A | auth/me, notifications, store/active-effects, rooms/quote, rooms, auth/public-config, users/cosmetics, wallet/me, analytics/visit |
| B | wallet/me (×2 calls), notifications, store/active-effects, rooms/quote, rooms, auth/public-config, users/cosmetics, analytics/visit |

Timing: dashboard bursts at T+0.0–0.6s (A≈5, B≈10 requests), `/rooms`
navigation at T+1.2–1.4s (~9 each) → ~35–40 requests in ~1.5s vs
`api_general` 60r/m + burst=20 → everything past the burst 429'd.

Duplicates identified: `auth/public-config` fired on **every** page mount
(`staleTime: 0` + `refetchOnMount: 'always'`); `wallet/me` fired twice for B
within 330ms; notifications/store/cosmetics refired on each page mount.

### Actual recovery mechanism (verified, not assumed)

- Polling queries self-recovered: notifications/store at +30s, wallet at +60s (all 200s in logs).
- **Non-polling required queries did NOT self-recover**: `rooms` browse list
  and `rooms/{id}/state` have no data yet → `refetchInterval` returns false →
  page sat on error/empty until manual Retry or remount. Focus refetch was
  already disabled for room state; no focus change occurred anyway.
- Visible consequence: marketplace showed error states; workspace could show
  "Couldn't load this room" indefinitely (reproduced live on `8565df5`).

### Fixes (PR #66 + #67)

Request reduction: public-config 60s staleTime; store/active-effects staleTime
= poll interval; rooms quote fetched lazily (create modal only); rooms browse
30s poll (required content self-recovers); room state error-poll every 10s on
transient failures (429/5xx/network), permanent 403/404 stays manual.

Burst adjustment — measured justification: the legitimate same-IP chain
(dashboard → marketplace → room) is ~70 requests/15s for two users, exceeding
burst=40 (10×429 observed live on `8565df5`). `api_general` burst raised
20 → 60. **Sustained rate unchanged at 60r/m; `api_auth` (10r/m, burst 5) and
`api_task` (30r/m) untouched.**

### Post-fix live measurement (`3ffe744`, room `cmwaigb4m0012tf4k5lpcvi4f`)

| Phase | A reqs | A 429 | B reqs | B 429 |
|---|---|---|---|---|
| dashboard cold | 14 | 0 | 14 | 0 |
| marketplace cold | 8 | 0 | 8 | 0 |
| room cold | 9 | 0 | 9 | 0 |
| **Total journey** | **49** | **1** | **37** | **0** |

The single 429: `GET friends/status` (non-critical friend badge, silent
failure, no user-facing breakage). **Zero required-content or action
failures** — all pages rendered, room workspace loaded, chat operated.

## 2. Chat readiness — transport vs membership

`RoomChat` now tracks the `channel:join` acknowledgement separately from
Socket.IO transport:

- States: `connecting` → `ready` (only after `channel:joined` ack) /
  `reconnecting` (transport lost) / `failed` (join error or 10s ack timeout
  or `reconnect_failed`).
- Manual **Retry** re-emits join (transport up) or revives the socket
  (transport down).
- Reconnect/reload re-joins and backfills missed history via
  `GET channels/{id}/messages`; all merges dedupe by message id —
  history + REST response + socket event overlap cannot duplicate.
- Failed REST sends restore the unsent draft.
- Status copy distinguishes persisted sends ("live updates paused — sends
  still save") from live subscription delivery.
- `channel:error` now carries `channelId` for shared-socket attribution.

### CI regressions (`apps/web/e2e/chat-readiness.spec.ts`)

Proxied Socket.IO (`page.routeWebSocket`) drives: ready-ack assertion,
dropped connection → `reconnecting` → delayed reconnect → missed message
backfilled exactly once, swallowed `channel:joined` → `connection failed` →
Retry → ready + backfill, failed REST send → draft preserved, and a real
HTTP 429 on `rooms/{id}/state` → workspace self-recovers with no reload.

### Live verification (`3ffe744`)

- Both participants: `chat-status` = `ready`.
- A→B UI-sent message delivered live without refresh: **true**.
- B→A message sent during A's reload backfilled after reconnect:
  **true, exactly 1 DOM occurrence** (no duplicates).

## 3. Test records & cost

- Room `cmwaigb4m0012tf4k5lpcvi4f` (`LIVE REL …`): created+joined via API on
  labeled test accounts — 25cr reservation each, NEGOTIATING, expires ~30min
  → auto-refund (same as prior verification rooms).
- Earlier probe room `cmwag7wbk000q60iqxo7yp1kw` (`LIVE REL`): same pattern,
  expired/refunded.
- Prior accounting/expiry evidence (`p2p-sameip-2026-11-09`,
  `p2p-deadline-rule-2026-11-10`) retained unchanged.

## Remaining limitations

- `friends/status` can still transiently 429 (1 observed) — non-critical,
  silent failure; friend badge may be absent until next visit.
- Socket-level auto-reconnect (not reload) is CI-verified via WS proxy;
  live check used reload-based reconnect (same join-ack + backfill path).
- Redis adapter attach failure at API boot remains (single-instance
  harmless; required before multi-instance scaling).
