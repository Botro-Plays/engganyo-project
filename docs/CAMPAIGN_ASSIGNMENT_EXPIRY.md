# Campaign assignment expiry

Operational semantics for the `sweepExpiredCampaignAssignments` cron in
`TasksService`, and the launch-time impact assessment for historical rows.

## Which completions may expire

| Completion status | Expirable? | Reason |
|-------------------|-----------|--------|
| `ASSIGNED` | Yes | Pre-submission claim holding a pending slot |
| `IN_PROGRESS` | Yes | Same; claimant started but has not submitted |
| `SUBMITTED` | **No** | Proof is awaiting review. The review deadline (`review_deadline`, creator then admin escalation) owns the remaining timeline, not the claim deadline. Expiring would strand reviewed work and release a slot that is still owed a payout decision. |
| `VERIFIED`, `REJECTED`, `DISPUTED`, `EXPIRED`, `CANCELLED` | No | Terminal or post-submission states. `REJECTED`/`CANCELLED` already released their slot; `VERIFIED` consumed it. |

Applies only to campaign completions (`task_completions.campaign_id` set).
1v1 challenge claims are handled separately by `challenges.sweepExpired`
(every 5 minutes) with their own escrow refund path.

## Deadline

`task_completions.expires_at` is set at claim time to **assigned_at + 48
hours**. A row is eligible only when `expires_at < now()`. Rows with a
null deadline are never touched.

`submitProof` already refuses submissions after `expires_at`. The guarded
manual-review write and the expiry CAS both match only
`ASSIGNED`/`IN_PROGRESS`, so whichever transition commits first wins and
the loser fails cleanly; a SUBMITTED row can never be expired, and an
EXPIRED row can never be resurrected by a stale submit.

## What expiry does (and does not) do

- Sets `task_completions.status = EXPIRED`.
- Decrements `campaigns.pending_slots` by 1 under the shared counter
  invariant (`pending_slots > 0`, `completed + pending <= total`,
  non-negative). A malformed campaign row matches nothing, the
  transaction rolls back, and the completion stays claimable for a
  later pass once counters are repaired.
- Moves **no wallet credits**. Pending reservations live in the
  campaign pool exactly as they do on rejection. The creator recovers
  unclaimed value only through campaign cancellation, which refunds
  `total - completed - pending` slots. A released reservation cannot be
  refunded twice: the slot returns to the unclaimed pool first, so a
  later cancellation includes it in the refund like any unclaimed slot.
- Emits a `SYSTEM_ANNOUNCEMENT` notification and a `task:expired`
  socket event to the claimant (post-commit, best-effort).

## Cancellation interaction

Cancellation refunds `total - completed - pending` and leaves in-flight
claims resolvable (a worker mid-task is not stranded). If the sweep
later expires a claim on an already-CANCELLED campaign, the released
slot's value stays in the platform pool because the refund was already
computed. This asymmetry is accepted: the alternative (expiring claims
at cancel time and enlarging the refund) would strand workers and is a
separate product decision. Only one historical row is affected (below).

## Deployment gating and batch bounds

| Env var | Default | Effect |
|---------|---------|--------|
| `CAMPAIGN_ASSIGNMENT_SWEEP` | off | Cron returns immediately unless exactly `true`. Enabling is a deliberate ops step. |
| `CAMPAIGN_ASSIGNMENT_SWEEP_SINCE` | unset | ISO date. When set, only rows with `assigned_at >= since` are eligible. Use to sweep only new assignments while historical rows await policy. |
| `CAMPAIGN_ASSIGNMENT_SWEEP_BATCH` | 200 | Max rows per 5-minute run, clamped to 1-1000, oldest `expires_at` first. |

Each completion expires in its own transaction. A concurrent
submit/verify that wins the status CAS is logged as `skipped`, not
failed; counter-invariant and unexpected failures count as `failed` and
are retried next run.

## Production impact report (read-only, 2026-11-25)

Query over `engganyo_prod`: campaign completions in `ASSIGNED` or
`IN_PROGRESS` with `expires_at < now()`:

| completion | status | assigned | expired since | campaign | campaign status | pending/completed/total |
|-----------|--------|----------|---------------|----------|-----------------|------------------------|
| `cmw65znrz009v5vv8vnmkd9j8` | ASSIGNED | 2026-11-07 | 2026-11-09 | Retweet our Platform Launch Post | ACTIVE | 1 / 1 / 500 |
| `cmwg3c3h6011npfpzf1n9a35g` | ASSIGNED | 2026-11-14 | 2026-11-16 | DEVIN TEST browser activity-reward campaign 4 | CANCELLED | 1 / 0 / 1000 |

Total: **2 rows**. Both hold one `pending_slots` reservation each.

- The ACTIVE-campaign row is a genuine stale claim on a live launch
  campaign. Expiring it returns one slot to the claimable pool. No
  credits move.
- The CANCELLED-campaign row is leftover agent test data whose campaign
  was already refunded `total - completed - pending`. Expiring it is
  bookkeeping only; the residual slot value remains in the pool (see
  Cancellation interaction). The owning account is an agent test
  account, so no real owner loses value.

## Proposed historical-processing policy (owner decision required)

Ship the sweep **disabled** (`CAMPAIGN_ASSIGNMENT_SWEEP` unset) so no
historical row is touched on deploy. Then, in order:

1. **Owner approves** this policy (or an alternative).
2. **Historical pass**: run the sweep once with no `SINCE` filter. Both
   rows above expire; each gets a claimant notification. Effect is
   limited to the 2 documented rows and is recoverable (EXPIRED rows are
   auditable; the released slot on the ACTIVE campaign just reopens).
3. **Steady state**: leave the cron enabled. Optionally set
   `CAMPAIGN_ASSIGNMENT_SWEEP_SINCE` during a grace period if the owner
   prefers to process only new assignments first, then remove it.

If the owner prefers a different split (e.g. expire only test-campaign
rows now and defer the live-campaign row), the `SINCE` env var plus a
manual targeted run can express it without code changes.
