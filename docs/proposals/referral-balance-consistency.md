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

**Retry semantics — verified, with a required correction.** With an outer
`tx`, `executeWithOptimisticLock` retries only its own `apply` callback
(wallet updateMany → ledger create → mirror update) inside the caller's
transaction; the wallet row is re-read each attempt under READ COMMITTED,
and a conflict throws before the ledger insert, so inner retries cannot
duplicate ledger rows. However, the caller's own writes are **not**
retried: `awardMilestone`'s milestone-flag merge is computed from a
pre-transaction read, so if `credit` exhausts its inner retries the whole
transaction must restart — milestone lock, eligibility re-read, both
awards, ledger entries, and mirror updates — or a stale `milestones` merge
can overwrite a concurrently awarded flag. Implementation: a dedicated
`WalletContentionException extends BadRequestException` (same HTTP 400 for
existing callers, `instanceof`-distinguishable) thrown on inner-retry
exhaustion; `awardMilestone` wraps its entire `withTransaction` in a
bounded retry loop catching it. Recursion/lock-order audit: all referral
entry points (`qualifyReferral`, `checkMilestones`, `awardSignUpBonus`)
are invoked fire-and-forget **after** the caller's transaction commits
(tasks/campaigns/admin/wallet-deposit), so the referral tx is never nested;
inside it the lock order is referral row (`FOR UPDATE`) → wallet row(s) →
user row — no path locks wallet→referral in one tx, so no deadlock cycle.
`WalletService.credit` has no callbacks into referrals/gamification.

**Confirmed wiring constraint:** `WalletModule` already imports
`ReferralsModule` and `WalletService` injects `ReferralsService` — so
`ReferralsService → WalletService` is a circular edge and must use
`forwardRef` on both module imports **and both constructor injections**
(provider-level circularity: each service needs the other's instance).
The codebase already uses `forwardRef` for PayMongo/PayPal/Gamification in
`WalletModule`, so this matches convention. Alternative if forwardRef is
rejected in review: keep `awardMilestone`'s own writes but add the mirror
update, `version` increment, in-tx before/after computation, `FOR UPDATE`
claim, and whole-tx retry — more duplication, same outcome.

Ledger type stays `EARN_REFERRAL_BONUS`; description/reference metadata
carried via `CreditOptions` so the audit trail is unchanged.

**I2 — Atomic milestone claim.** Inside the transaction, lock the referral
row (`SELECT id FROM referrals WHERE id = $1 FOR UPDATE`) and re-read
`milestones` before awarding, replacing the outside-tx pre-check. This
serializes concurrent awarders on the row lock — the loser sees the
milestone already set and skips all credit writes (F3 fixed). No schema
change required; a `referral_milestones` table is a heavier alternative
rejected for v1.

**I3 — Locked per-user mirror reconciliation.** The earlier bulk
`UPDATE ... FROM wallets` plan is unsafe under live settlements: in READ
COMMITTED the `FROM` snapshot can copy a pre-commit `wallets.balance` over
a mirror a concurrent settlement just rewrote to a newer value. Instead,
`WalletService.reconcileCreditBalanceMirror(userId)` runs per user in its
own transaction: `SELECT balance FROM wallets WHERE user_id = $1 FOR
UPDATE` (waits out any in-flight settlement, then reads the newest
committed balance) → `UPDATE users SET credit_balance = <that balance>`.
Lock order wallet→user matches `executeWithOptimisticLock`, so no
deadlock; while the wallet lock is held, new settlements queue and then
rewrite the mirror themselves. Idempotent, returns `{changed, from, to}`.
A driver script iterates the dry-run list calling it per user — each call
is independently safe under live traffic. Regression spec races it against
`credit`/`debit` on real PostgreSQL and asserts the mirror always ends
equal to `wallets.balance`.

## 3. Reconciliation plan — existing discrepancies

The mirror is **derived** state, not ledger-backed: `wallets.balance` is
authoritative (every credit/debit has a `transactions` row). Therefore
reconciliation corrects the mirror only — **no credits are re-awarded, no
ledger rows are written, no wallet balances change**.

### 3a. Production dry-run result (2026-11-07, read-only)

- `referrals` rows: **0** — the referral program has never produced a row.
- `EARN_REFERRAL_BONUS` transactions: **0**.
- Diverged `credit_balance <> wallets.balance`: **0 users**.

**Conclusion: no historical discrepancy exists — no backfill is required.**
The F1 bug is latent (first referral payout would create drift), which is
why the forward fix ships before any referral can pay out. I3's locked
routine remains as the safe mechanism if drift ever appears; it is covered
by the race regression but does not need to run on production now.

### 3b. Dry-run interpretation rules (for any future drift)

Drift does **not** equal a user's lifetime referral-bonus total: every
`WalletService` settlement rewrites the mirror to the then-current wallet
balance, so a later ordinary credit/debit "heals" earlier referral drift.
Current drift therefore only reflects referral bonuses received **after**
the user's last wallet-service settlement. To explain a diverged row:

1. `referral_earned` = `SUM(transactions.amount WHERE type='EARN_REFERRAL_BONUS')`.
2. `last_settlement_at` = `MAX(transactions.created_at)` on the wallet.
3. Expected residual drift ≈ referral bonuses posted **after**
   `last_settlement_at` (approximation — wallet txs also occur via
   referral path itself; use ledger order, not just timestamps).
4. Classification:
   - `drift == post-last-settlement referral sum` → mirror drift only (F1).
   - `drift > that` or negative drift → unknown writer or duplicate award
     (F3) → investigate before reconciling.
   - Ledger `balanceBefore/After` gaps vs wallet history → F2 chain defect,
     separate from mirror drift.

### 3c. Execution plan (only if drift appears)

1. Run the read-only report; attach output for owner sign-off.
2. After approval, run the per-user locked reconciliation (I3) over the
   diverged list; verify dry-run returns 0 rows afterward.
3. Record row count + absolute drift in `audit_log`.

## 4. Test plan (CI, real PostgreSQL)

- `awardMilestone` credits referrer+referee wallets, ledger rows, **and**
  `user.creditBalance` mirror — assert all three agree.
- Concurrent `awardSignUpBonus`/`qualifyReferral`/`checkMilestones` for the
  same referee → each milestone awarded exactly once (row-lock + in-tx
  re-read); no duplicate `EARN_REFERRAL_BONUS` ledger rows.
- `awardMilestone` racing `wallet.credit`/`debit` → final balances exact,
  ledger before/after chain contiguous, mirror consistent.
- Forced `WalletContentionException` (inner retries exhausted) → whole
  referral tx retries: milestone flag, both awards, ledger, mirror all
  re-applied exactly once.
- `reconcileCreditBalanceMirror` raced against concurrent credit/debit →
  mirror always ends equal to `wallets.balance`; returns correct
  `{changed, from, to}`.

## 5. Open questions for owner

1. ~~Backfill scope~~ — resolved by the production dry-run: **0 referrals,
   0 referral-bonus transactions, 0 diverged users** → no historical
   reconciliation required. I3 ships as a tested routine only.
2. Should admin user list/detail/CSV and `getMyStats` keep reading the
   mirror (now maintained) or switch to `wallets.balance` directly?
   Recommendation: keep mirror — it is now correctly maintained and avoids
   extra joins; revisit only if a third mirror-writer appears.
3. `referral.creditsAwarded` currently increments by **referrer** bonus
   only — confirm that is the intended semantic for leaderboards
   (`getLeaderboard` sums it as "credits earned").
