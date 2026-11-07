# Referral balance consistency — audit and remediation plan

**Status:** proposal for review — no historical data has been changed.
**Trigger:** PR #50 made `/auth/me` and `/users/me` read `wallets.balance`
fresh after discovering that `user.creditBalance` is only a denormalized
mirror. Auditing every writer showed the referral path never maintains that
mirror at all, so discrepancies already exist in production.

## 1. Audit — every referral credit path

All referral credit awards funnel through one private method,
`ReferralsService.awardMilestone` (`apps/api/src/modules/referrals/referrals.service.ts`),
called by:

| Caller | Milestone | Referrer | Referee |
|---|---|---|---|
| `awardSignUpBonus` (on registration) | `sign_up` | +10 | +25 |
| `qualifyReferral` (first verified task) | `first_task` | +25 | 0 |
| `checkMilestones` (periodic/post-action) | `ten_tasks` | +50 | +25 |
| `checkMilestones` | `deposit` | +100 | 0 |
| `checkMilestones` | `silver_tier` | +200 | +100 |

Inside one `prisma.withTransaction`, `awardMilestone` currently:

1. Updates `referral.milestones` JSON + `creditsAwarded`.
2. For each bonus > 0: `tx.wallet.findUnique` → `tx.wallet.update`
   (`balance`/`lifetimeEarned` increments) → `tx.transaction.create`
   (`EARN_REFERRAL_BONUS` ledger row).

### Findings

**F1 — `user.creditBalance` mirror is never updated (confirmed bug).**
Every other balance writer (`WalletService.executeWithOptimisticLock`,
register, admin reset) maintains the mirror inside the same transaction.
Referral awards update `wallets.balance` + ledger only. The mirror
permanently diverges by the sum of all referral bonuses the user received.

**F2 — Ledger `balanceBefore`/`balanceAfter` can be wrong under concurrency.**
`awardMilestone` reads `w.balance` once, then writes `increment` and stamps
the ledger row with `before: w.balance`, `after: w.balance + bonus`. A
concurrent `wallet.credit/debit` (optimistic-lock path) committing between
the read and the update makes the referral ledger row's before/after not
reflect the real chain order. `balance`/`lifetimeEarned` themselves stay
correct (`increment` is atomic), but the ledger chain invariant
("each row's `balanceBefore` equals the prior committed `balanceAfter`")
can break.

**F3 — Milestone double-award race.**
The `ms[milestone]` already-awarded check runs **outside** the transaction,
and the in-transaction `referral.update` is unconditional — two concurrent
`awardMilestone` calls for the same milestone can both pass the check and
both credit the wallets. No DB-level uniqueness guards
`(referralId, milestone)`.

**F4 — `version` not bumped.** The referral path bypasses the wallet
optimistic-lock `version` column entirely; interleaved settlements don't
conflict, which is fine for correctness of `balance` but means F2's stale
reads are undetected.

### Consumers of the mirror (`user.creditBalance`)

| Consumer | File | Impact today |
|---|---|---|
| Admin user list | `admin.service.ts` ~L85 | Shows stale balance |
| Admin user detail | `admin.service.ts` ~L114 | Shows stale balance |
| Admin user CSV export | `admin.service.ts` ~L1700 | Exports stale balance |
| Gamification `getMyStats` | `gamification.service.ts` ~L216 | Returns stale `creditBalance` in stats payload |
| `/auth/me`, `/users/me` | — | **Fixed by PR #50** (reads `wallets.balance`) |
| Wallet endpoints | `wallet.service.ts` | Unaffected (read `wallets`) |

## 2. Proposed implementation

**I1 — Route referral awards through `WalletService.credit` inside the
existing transaction.** `credit(userId, amount, opts, tx)` already joins a
caller-provided transaction client, so `awardMilestone` keeps its single
transaction while gaining: mirror update, `version` bump + optimistic-lock
conflict retry semantics, and ledger rows whose before/after are computed
inside the tx (F2 fixed).

**Confirmed wiring constraint:** `WalletModule` already imports
`ReferralsModule` and `WalletService` injects `ReferralsService` — so
`ReferralsService → WalletService` is a circular edge and must use
`forwardRef` on both module imports and the constructor injection (the
codebase already uses `forwardRef` for PayMongo/PayPal/Gamification in
`WalletModule`, so this matches convention). Alternative if forwardRef is
rejected in review: keep `awardMilestone`'s own writes but add the mirror
update, `version` increment, and in-tx before/after computation — more
duplication, same outcome.

Ledger type stays `EARN_REFERRAL_BONUS`; description/reference metadata
carried via `CreditOptions` so the audit trail is unchanged.

**I2 — Atomic milestone claim.** Inside the transaction, lock the referral
row (`SELECT id FROM referrals WHERE id = $1 FOR UPDATE`) and re-read
`milestones` before awarding, replacing the outside-tx pre-check. This
serializes concurrent awarders on the row lock — the loser sees the
milestone already set and skips all credit writes (F3 fixed). No schema
change required; a `referral_milestones` table is a heavier alternative
rejected for v1.

**I3 — Mirror reconciliation (forward-only).** After I1 deploys, run a
one-time backfill (below). No code keeps writing the mirror except
`WalletService` + register/admin-reset, so it stays correct thereafter.

## 3. Reconciliation plan — existing discrepancies

The mirror is **derived** state, not ledger-backed: `wallets.balance` is
authoritative (every credit/debit has a `transactions` row). Therefore
reconciliation corrects the mirror only — **no credits are re-awarded, no
ledger rows are written, no wallet balances change**.

1. **Dry-run report (read-only):**
   `SELECT u.id, u.username, u.credit_balance AS mirror, w.balance AS truth,
   w.balance - u.credit_balance AS drift`
   `FROM users u JOIN wallets w ON w.user_id = u.id
   WHERE u.credit_balance <> w.balance;`
   Expected drift = sum of `EARN_REFERRAL_BONUS` ledger amounts per user
   (cross-check against `transactions` to prove the mirror is the only
   wrong side).
2. **Review:** attach the dry-run output to this PR for owner sign-off.
   Any row where drift ≠ referral-bonus sum is investigated before backfill
   (would indicate a second unknown writer).
3. **Backfill (after approval):** single transaction
   `UPDATE users u SET credit_balance = w.balance FROM wallets w
   WHERE w.user_id = u.id AND u.credit_balance <> w.balance;`
   plus an `audit_log` entry recording row count and total absolute drift.
4. **Verify:** re-run the dry-run query (expect 0 rows); spot-check
   `getMyStats`/admin export for a known referral earner.

## 4. Test plan (CI, real PostgreSQL)

- `awardMilestone` credits referrer+referee wallets, ledger rows, **and**
  `user.creditBalance` mirror — assert all three agree.
- Concurrent `awardMilestone` for the same milestone → exactly one award
  (row-lock serialization).
- `awardMilestone` racing `wallet.credit` → final balance exact, ledger
  before/after chain contiguous.
- Backfill dry-run SQL returns only referral-drift rows on a seeded
  divergent fixture.

## 5. Open questions for owner

1. Backfill scope: all diverged users at once, or report-first then batch?
   (Plan assumes report → approval → single backfill.)
2. Should admin user list/detail/CSV and `getMyStats` keep reading the
   mirror (now maintained) or switch to `wallets.balance` directly?
   Recommendation: keep mirror — it is now correctly maintained and avoids
   extra joins; revisit only if a third mirror-writer appears.
3. `referral.creditsAwarded` currently increments by **referrer** bonus
   only — confirm that is the intended semantic for leaderboards
   (`getLeaderboard` sums it as "credits earned").
