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
- On an ACTIVE/COMPLETED campaign, moves **no wallet credits**. Pending
  reservations live in the campaign pool exactly as they do on
  rejection. The creator recovers unclaimed value only through campaign
  cancellation, which refunds `total - completed - pending` slots.
- On an already-CANCELLED campaign, reconciles the released slot's
  value in the same transaction (see below).
- Emits a `SYSTEM_ANNOUNCEMENT` notification and a `task:expired`
  socket event to the claimant (post-commit, best-effort).

## Cancellation interaction

Cancellation refunds `total - completed - pending` and deliberately
leaves in-flight claims resolvable: a worker whose claim is still valid
keeps submission rights (the refund excludes their pending slot), and
only once the claim itself expires is its reservation reconciled.

When the sweep expires a claim on an already-CANCELLED campaign, the
same transaction re-reads the campaign row (after the guarded updates,
so a cancellation committed mid-flight is observed) and issues a
provenance-checked refund of `credit_per_task` to the campaign owner
via `resolveFundedRefund` + a `REFUND_CAMPAIGN_CANCEL` credit. Exactly
once is guaranteed by commit ordering:

- Cancel commits first: its refund excludes the still-pending slot;
  the expiry refund covers it. (Test: `cancel-then-expire`.)
- Expiry commits first: the cancellation sees `pending_slots` already
  decremented and includes the slot in its own refund; expiry sees an
  ACTIVE status and issues nothing. (Test: `expire-then-cancel`.)
- Repeated sweeps cannot re-refund: the completion is EXPIRED and no
  longer eligible.

Funding anomalies (unfunded campaign, partial funding, over-refunded
history) fail closed inside `resolveFundedRefund`: the whole row
transaction rolls back, counts as `failed`, and is retried once
counters/provenance are consistent. An unfunded cancelled campaign
still expires cleanly with zero refund.

### Reserved policy surface (not a default)

The implemented rule is "refund at expiry". The rejected alternative,
refunding pending claims immediately at cancel time, was not chosen
because it strands workers mid-task. Whether stale claims on cancelled
campaigns should instead remain locked (never expire, never refund) is
a product/economic choice for the owner; this code does not silently
adopt any of the three as policy beyond the transactional semantics
above.

## Deployment gating and batch bounds

| Env var | Default | Effect |
|---------|---------|--------|
| `CAMPAIGN_ASSIGNMENT_SWEEP` | off | Cron returns immediately unless exactly `true`. Enabling is a deliberate ops step. |
| `CAMPAIGN_ASSIGNMENT_SWEEP_SINCE` | unset | ISO date. When set, only rows with `assigned_at >= since` are eligible. Dating it at activation means "new assignments only". |
| `CAMPAIGN_ASSIGNMENT_SWEEP_ALL_HISTORY` | off | Must equal `true` to sweep every past-due row regardless of age. The only way historical rows are touched. |
| `CAMPAIGN_ASSIGNMENT_SWEEP_BATCH` | 200 | Max rows per 5-minute run, clamped to 1-1000, oldest `expires_at` first. |

Scope is mandatory: an enabled sweep with neither a valid `SINCE` nor
`ALL_HISTORY=true` refuses to run and logs an error, and an invalid
`SINCE` value also refuses. An unfiltered sweep can therefore never be
an accident; the candidate set is always either explicitly bounded or
explicitly all-history.

Each completion expires in its own transaction. A concurrent
submit/verify that wins the status CAS is logged as `skipped`, not
failed; counter-invariant and unexpected failures count as `failed` and
are retried next run.

## Production impact report (read-only, refreshed 2026-11-26)

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
  was already refunded `total - completed - pending`. Under the
  reconciliation above, expiring it would also issue a
  `REFUND_CAMPAIGN_CANCEL` credit of `credit_per_task` to the owning
  agent test account (subject to funding provenance resolving). The
  worker loses nothing they were owed: the claim was already past its
  submission deadline.

This count is a revalidation, not a bound: the candidate set is
whatever matches the predicate at run time, which is why scope is
mandatory and the report is refreshed before any activation request.

## Proposed historical-processing policy (owner decision required)

The sweep ships **disabled** (`CAMPAIGN_ASSIGNMENT_SWEEP` unset) so no
historical row is touched on deploy. Then, in order:

1. **Owner approves** this policy (or an alternative).
2. **New assignments only**: set `CAMPAIGN_ASSIGNMENT_SWEEP=true` and
   `CAMPAIGN_ASSIGNMENT_SWEEP_SINCE=<activation date>`. Only future
   claims are swept; the 2 historical rows stay untouched.
3. **Historical pass**: after approval, either set
   `CAMPAIGN_ASSIGNMENT_SWEEP_ALL_HISTORY=true` once (then unset) or
   move `SINCE` earlier than the oldest stale `assigned_at`. The
   CANCELLED-campaign row additionally credits its slot value back to
   the test account.

If the owner prefers a different split (e.g. expire only test-campaign
rows now and defer the live-campaign row), a targeted manual run or a
future row-allowlist can express it; the env knobs alone cannot select
by campaign.
