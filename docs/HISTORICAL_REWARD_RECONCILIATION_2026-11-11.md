# Historical Reward Reconciliation — Read-Only Report (2026-11-11)

**Scope:** production DB `engganyo_prod` on `134.255.232.68`, queried read-only via
`docker exec engganyo_postgres psql -U engganyo`. No rows were modified.
**Deployed code at query time:** `1c9b622` (entitlement feature live, sweep had no
production caller); `679b8bc`/`d9c9228` deploys in flight.

## 1. Deposits touched by the entitlement sweep — NONE

`reward_entitlements` contains **0 rows**. The last COMPLETED deposit finished
2026-11-04, over a week before the entitlement writer deployed (run `42998020733`,
completed 2026-11-11T10:14Z). The deployed `processRewardEntitlements` also had no
scheduled caller in `1c9b622`, so no sweep or backfill has ever run against
production data.

| Deposit | User | Method | Package | amount_fiat | ccy | rate | usd_value | completed_at | VP event |
|---|---|---|---|---|---|---|---|---|---|
| cmw0i4x3y0011leqxyapyy778 | botro | PAYMONGO | ₱1 Deal ($0.01) | 1 | PHP | 63.547 | NULL | 2026-11-03 09:46 | 10 VP |
| cmw0sje6n00153hevbly6i8bh | botro | PAYMONGO | ₱1 Deal ($0.01) | 1 | PHP | 63.547 | NULL | 2026-11-03 14:37 | 10 VP |
| cmw1na430001eno7xl8ezvy2w | botro | PAYPAL | $1 package | 1 | USD | NULL | NULL | 2026-11-04 04:59 | 10 VP |

## 2. Deposit VP discrepancy — ~20 VP over-award (pre-fix code)

The two PAYMONGO deposits are the ₱1 minimum-charge test package
(`usd_amount = 0.01`). Correct valuation under current rules:
`1 PHP / 63.547 = $0.0157 → round(0.157) = 0 VP`. They were awarded **10 VP each**
by the pre-`e647a0d` code path. The PAYPAL $1 deposit's 10 VP is correct.

- Total `deposit_completed` VP events: 3 events / 30 VP (all user `botro`, vp=138).
- Estimated over-award: **~20 VP** (2 × ~10 VP).
- **No adjustment made — awaiting owner approval.** If approved, the correction
  would be a ledger-visible adjustment, not a silent balance edit.

## 3. Ledger reconciliation

**VP: fully reconciles.** Every user's `vp` equals `SUM(vp_events.amount)`
(10 users checked, 0 diffs).

**XP: one unexplained surplus.**

| User | xp balance | SUM(xp_events.amount) | diff |
|---|---|---|---|
| jhing | 400 | 220 | **+180** |
| all others | — | — | 0 |

Likely XP awarded before `xp_events` existed or via a path that bypassed the
ledger. Read-only finding; no correction proposed yet.

## 4. Lost task-completion XP — historical evidence for the durable-outcome fix

3 VERIFIED completions exist. XP/VP events by completion:

| Completion | User | Verified | XP event | VP event |
|---|---|---|---|---|
| cmw65uoxo005t5vv8t2800cvk | botro | 2026-11-07 08:48 | 50 XP ✓ | 1 VP ✓ |
| cmw65pfxp004l5vv8brx5cz6q | jhing | 2026-11-07 08:59 | 50 XP ✓ | 1 VP ✓ |
| cmw66ldge00ga5vv8e76li5nn | devin_earn_test | 2026-11-07 09:08 | **MISSING** | 1 VP ✓ |

Completion `cmw66ldge00ga5vv8e76li5nn` received its VP reward but **never received
its 50 XP** — a permanently lost effect from the pre-durable outcome path
(catch-and-log after VERIFIED). This is exactly the failure mode PR #75's
`task_completion_outcomes` + sweeper now recovers for all future completions.

- Historical note: pre-#73 `xp_events.reference_id` values are campaign/challenge
  IDs, not completion IDs — do not join them to `task_completions.id`.
- devin_earn_test's balance still reconciles (xp=20 = daily_login only); the 50 XP
  is simply absent, not mismatched.

## 5. Status

- Sweep/backfill boundary `ENTITLEMENT_ROLLOUT_AT = 2026-11-11T10:18Z` excludes all
  3 historical deposits — they can never be auto-entitled; any award requires this
  report + explicit owner approval.
- Outstanding owner decisions: (a) reverse/adjust ~20 VP deposit over-award;
  (b) investigate jhing's +180 XP surplus; (c) whether to backfill the missing
  50 XP for `devin_earn_test` (test account — likely moot).
