# Mutual P2P rooms — production verification (2026-11-07)

Deployed SHAs: PR #54 `1611b43` (deploy run 42377316654), PR #55 `9ccdb5f` (deploy run 42380992157).
Final deployed SHA: `9ccdb5fd709e4bb05126956b537bfa347cf762bc`.

Labeled test accounts only (devin_create_test / devin_earn_test / devin_ref_test). No owner account used.

## Journey verified live on engganyo.com

1. `GET /rooms/quote` → 25 cr/player, 50 room charge, 30-min timer, 72-h claim window, 24-h rating window, 3 rooms/pair/7d.
2. Creator published room `cmw6gknu7000q4w1s65xtmdmg` → `SPEND_ROOM_CREATE` −25 (70→45), participation slot held.
3. Joiner saw it in `GET /rooms` marketplace → `POST /rooms/:id/join` → NEGOTIATING, `expiresAt` = join+30min, PRIVATE channel + exactly 2 members provisioned atomically; `SPEND_ROOM_CLAIM` −25 (50→25).
4. Both `PUT /offers` (v1) → both `POST /approve` → AGREED; `platform_revenue` ROOM_CHARGE 50 created exactly once; duplicate approve → 409.
5. `POST /uploads/room-proof` (WebP re-encode + SHA256) ×2 → `submit-proof` both directions → peer `review` approve ×2 → COMPLETED exactly once; `p2p_point_events` +1 each; no wallet credit.
6. `POST /rate` ×2 → ratings 5/4 stored; public `GET /rooms/ratings/:username` shows early-reveal averages (after #55 fix).
7. `POST /nudge` → sent; same pingId → deduplicated; per-sender cooldown enforced.
8. Second create while active → 409 `ACTIVE_ROOM_EXISTS`.
9. Friend request → accept → ACCEPTED both directions.
10. `POST /report` → room-scoped report created. `GET /admin/rooms` as USER → 403.
11. Socket chat: both participants joined channel, message broadcast; non-participant `POST /channels/join` → 403 after #55 (was exploitable before).

## Expiry/refund/cancel verified

- Room2 `cmw6gn78j002h4w1srctjgbpn`: reached AGREED (revenue 50 collected) → `expires_at` forced past → every-minute cron sweep → EXPIRED/ACTIVE_TIMEOUT. Ledger: −25/−25 then `REFUND_ROOM_CLOSE` +25/+25 (20→45, 0→25). `platform_revenue.reversed_at` set, `reversal_reason=ACTIVE_TIMEOUT`. 0 point events. Slots released. Second sweep idempotent.
- Room3 `cmw6gpzsw003z4w1slrk7vuu6`: cancelled while NEGOTIATING → CLOSED/PLAYER_CANCEL, same exact refund pattern.
- Room4 `cmw6gwkem005a4w1s8hf5lani`: left OPEN for owner/friend join testing (72-h auto-expiry + refund).

## Bugs found in live verification and fixed in PR #55

1. Room PRIVATE channels self-joinable by any authenticated user → participant/staff check in `joinChannel` (verified 403).
2. Rating early-reveal unreachable → count all room ratings via groupBy (verified averages live).
3. `/rooms/[id]` crashed for every room — Next 14 `params` is sync, `use(params)` threw → `useParams()` (verified render + screenshots).

Also fixed pre-merge in CI: `cancel()` rejected OPEN listings; integration-spec cascade + expectations.

## Files

- `evidence.json` — full machine-readable record (ids, ledger rows, revenue, points, ratings).
- `rooms-market-1440.png` / `rooms-market-390.png` — marketplace at desktop/mobile.
- `room-detail-1440.png` / `room-detail-390.png` — completed-room workspace at desktop/mobile.

## Limitations

- Admin room monitor: build + 403 authz verified; full moderator actions need an admin 2FA/PIN session (not exercised).
- Dispute→moderator resolution path coded, not exercised live.
- 90-day chat retention rule documented; no purge cron separately verified.
