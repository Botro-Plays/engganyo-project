# Proposal: Public 1v1 P2P Challenges

Status: **proposal — awaiting review before implementation**

## Concept

A 1v1 challenge is a custom task created by one player with exactly one available
slot for a second player. Public by default: it appears in Find tasks until an
eligible player claims it — no invitation required. The creator may optionally
choose **Private** and set a password; private challenges are hidden from public
discovery and reachable only through a share link that asks for the password
before revealing task details.

Flow: **Create challenge → Claim → Open task → Submit proof → Creator review →
Release credits**.

## UX proposal

### Create (worker or creator)

- Entry points: "Create challenge" button on Find tasks (authenticated) and a
  "Challenge a friend" action on a user profile.
- Form fields: title, required action (free text + platform picker), target URL
  (validated http/https, same allowlist rules as campaigns), advertised reward
  (credits), deadline (default 48h, max 7d), proof requirement toggle +
  instructions, visibility (Public / Private + password).
- Before publishing, a review step shows: **reward, platform fee, total credits
  reserved** — e.g. at a 5% fee a 100-credit reward reserves 105 credits; the
  player receives the full 100 on approval.
- On publish: challenge appears in Find tasks (public) or generates a share link
  `/challenge/{id}` (private, password-gated).

### Discover / claim (public)

- Public challenges render as a distinct card in Find tasks: "1v1 Challenge"
  chip, reward, action, deadline countdown, "1 slot".
- Claim is a single atomic action — first eligible claim wins.
- On claim success the claimer stays on Find tasks and sees the same post-accept
  panel shipped in the Find tasks PR: **Open task** immediately, **Submit proof**
  when available, link to My tasks.

### Private access

- `/challenge/{id}` shows only title + "password required" until the correct
  password is entered. Password verified server-side; details are never sent to
  the client before verification.

### After claim

- Challenge leaves public availability (slot consumed).
- Both participants see it in My tasks (claimer: submit/track; creator: review
  queue) and My campaigns (creator).
- Claimer's My tasks row gets the same expiry/ordering rules as campaign tasks.

## Data model

### Why a dedicated `Challenge` model, not a one-slot `Campaign`

`Campaign` is an open-marketplace listing: `totalSlots`/`pendingSlots` pools,
multi-completer semantics, targeting filters, browse ranking, and campaign-level
economics (`totalCost = totalSlots × creditPerTask`). Forcing `totalSlots = 1`
would inherit all of that and still miss what challenges need:

- **Different discovery**: challenges are personal duels, not inventory — they
  need their own card treatment, expiry countdown, and "1 slot" affordance, not
  slot-pool math.
- **Different lifecycle**: a campaign's slot pool refills implicitly; a
  challenge's single slot is consumed permanently on claim (see reopen rule
  below). Campaign status transitions don't express OPEN → CLAIMED →
  COMPLETED/EXPIRED.
- **Different economics**: campaign fees are computed on `totalCost` at
  creation; challenge fee is on a single reward with its own snapshot fields.
- **Different access control**: private challenges need password gating on the
  resource itself — campaigns have no visibility/password concept.
- **Different abuse surface**: claim atomicity, self-claim, and
  password-guess limits are challenge-specific invariants that would be bolted
  onto campaign paths otherwise.

The completion side **does** reuse `TaskCompletion` (proof pipeline, review,
dispute, expiry) — only the offer side is new.

```prisma
model Challenge {
  id           String   @id @default(cuid())
  creatorId    String   @map("creator_id")
  creator      User     @relation(fields: [creatorId], references: [id])
  title        String
  actionText   String   @map("action_text") @db.Text
  taskType     TaskType @map("task_type")
  targetUrl    String   @map("target_url")
  rewardCredits Int     @map("reward_credits")
  requiresProof Boolean @default(true) @map("requires_proof")
  proofInstructions String? @map("proof_instructions") @db.Text
  visibility   ChallengeVisibility @default(PUBLIC)
  passwordHash String?  @map("password_hash") // bcrypt/argon2, never plaintext
  status       ChallengeStatus @default(OPEN)
  // economics — snapshotted at publish
  feeRateSnapshot Float  @map("fee_rate_snapshot")
  feeAmount      Int     @map("fee_amount")      // computed, locked at publish
  reservedCredits Int    @map("reserved_credits") // reward + fee
  claimId      String?  @unique @map("claim_id")  // set atomically on claim
  claim        TaskCompletion? @relation(fields: [claimId], references: [id])
  claimedAt    DateTime? @map("claimed_at")
  expiresAt    DateTime  @map("expires_at")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
}

enum ChallengeVisibility { PUBLIC PRIVATE }
enum ChallengeStatus { OPEN CLAIMED COMPLETED EXPIRED CANCELLED }
```

`TaskCompletion` gains `challengeId String? @unique` so the single claim is
enforced by the same @@unique([challengeId])-style constraint pattern (a
completion can reference either a campaign or a challenge, never both —
CHECK constraint or app-level invariant).

## Lifecycle rules

| Event | Slot / reserved credits |
|---|---|
| Publish | `reservedCredits = reward + fee` held from creator's credit balance (escrow-style debit, same wallet ledger path as campaign `totalCost`). |
| Claim | Atomic: `UPDATE challenges SET status='CLAIMED', claimId=... WHERE id=? AND status='OPEN'` — one winner under concurrency (row lock / conditional update, not check-then-act). Self-claim blocked (`creatorId != claimerId`). |
| Submit proof | Same proof upload + hash pipeline as campaigns. |
| Creator approves | Reward released to claimer; fee recorded separately in the ledger (`PlatformRevenue` source `CHALLENGE_FEE`, or a dedicated ledger entry type). Completion → VERIFIED. |
| Creator rejects | Claimer may dispute (existing `DISPUTED` status) → admin review, same as campaign rejections. On final rejection: challenge → COMPLETED (slot consumed). **Decision needed**: whether the slot reopens for a new claimer (see Open decisions). |
| Abandonment (claimer never submits before `expiresAt`) | Expiry job marks challenge EXPIRED; reserved credits return to creator in full (reward + fee — nothing was earned). **Decision needed**: whether the challenge reopens to a new claimer or closes (see Open decisions). |
| Creator cancels before claim | CANCELLED; full reserve returned. |
| Creator cancels after claim | Not allowed — claim is binding; creator must review or let `reviewDeadline` escalate to admin (existing mechanism). |

## Platform fee

- Configurable fee rate (platform setting), **0% at launch** for both public and
  private challenges.
- Creator pays the fee **on top of** the advertised reward.
- Fee rate **snapshotted at publish** (`feeRateSnapshot`) — later settings changes
  cannot alter an existing challenge.
- Collected **only when the reward settles** (approval). If the challenge closes
  without an award, both reserved reward and fee return to the creator.
- Recorded separately in the ledger — never commingled with the reward payout.
- **Rounding**: fee = `ceil(reward * rate)` in whole credits so the platform never
  rounds a fee down to zero on small rewards; minimum advertised reward 10 credits
  keeps math trivial at launch rates. At 5%: 100 → fee 5, reserve 105, player gets 100.
- **Duplicate settlement**: approval goes through the same idempotent
  completion-transition path as campaign verification (`status` transition guard:
  only SUBMITTED→VERIFIED once). Concurrent approve/reject requests serialize on
  the completion row; ledger entries keyed by completion id make retries safe.

## Server-side enforcement

- Claim atomicity via conditional update (single statement, `RETURNING`).
- Private challenges: `passwordHash` verified server-side with per-IP + per-challenge
  attempt limiting (e.g. 5 failures → 15 min lockout, logged to `AbuseFlag`).
- Target URL validated against the same platform allowlist; YouTube-engagement
  restrictions (`DISABLED_TASK_TYPES`) apply unchanged.
- Trust-score / abuse checks reuse `TrustScore`, `IpRecord`, `DeviceFingerprint`.
- Min/max reward bounds from platform config.

## Acceptance test plan

1. **Unauthorized access**: unauthenticated claim → 401; private challenge detail
   without password → 403/no details; wrong password → generic failure + attempt
   counter; brute-force lockout triggers.
2. **Simultaneous claims**: N parallel claim requests on one OPEN challenge →
   exactly one 201, rest 409; exactly one TaskCompletion created.
3. **Self-claim**: creator claims own challenge → 403.
4. **Duplicate settlement**: two concurrent approve calls → one VERIFIED
   transition, one reward credit, one fee ledger entry; retry-safe.
5. **Lifecycle**: expiry returns full reserve; cancel-before-claim returns full
   reserve; reject → dispute → admin path mirrors campaign behavior.
6. **Fee snapshot**: publish at rate R, change platform rate, approve → fee
   charged at R.
7. **Private discovery**: private challenge absent from Find tasks listing and
   from any public search; share link works after password.
8. **UI**: create → review (reward/fee/total) → publish; claim → Open task →
   submit proof → creator review → credits, at 390px and 1440px.

## Decisions needed before implementation

1. **Slot reopening** — when a claimed slot ends without an award (claimer
   abandonment/expiry, creator rejection, or dispute lost by claimer), does the
   challenge reopen to a new claimer or close permanently?
   - *Proposal*: close permanently in v1 — reopening enables reward farming
     (creator + rotating alt claimers) and complicates the "one duel" mental
     model. Revisit if testers want retries.
2. **Reserved credits after rejection/dispute** — on final rejection the
   reserved *reward* returns to the creator (they never owed it — the claimer
   failed to deliver), and the *fee* is also returned because fees are only
   collected at settlement. On a dispute the reserve stays held until admin
   resolves; admin uphold-rejection releases it the same way.
   - *Confirm*: return both reward and fee to creator on any non-award close.
3. **Re-listing vs new challenge** — if a challenge closes unawarded, the
   creator can always create a fresh one; we do not mutate the original.
4. **Private challenge redemption** — link-only, or also targeted to specific
   users?
5. **Reward bounds** — proposal: 10–500 credits at launch.
6. **Discovery placement** — mixed into Find tasks with a "1v1" chip + filter,
   vs a dedicated Challenges tab (proposal: mixed + filter).
