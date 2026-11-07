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

---

## Final decisions — v1 implementation (PR: feat/1v1-p2p-challenges)

All open decisions resolved as follows:

1. **Slot reopening** — **Close permanently in v1.** Abandonment, expiry, and
   final rejection all end the challenge; the creator publishes a fresh one.
   Prevents reward farming via rotating alt claimers.
2. **Non-award close refund** — **Both reward and fee return to the creator**
   (`REFUND_CHALLENGE_CLOSE` ledger entry for `reservedCredits`). Fees are only
   collected at settlement.
3. **Re-listing** — A fresh `Challenge` row is created; closed challenges are
   never mutated or reopened.
4. **Private redemption** — **Share link + password.** `POST /challenges/:id/preview`
   returns only `{id, visibility, requiresPassword}` before verification;
   `POST /challenges/:id/access` verifies the argon2 hash (rate-limited:
   5 failures/IP → 15 min lockout via Redis) and returns details. Private
   challenges never appear in public listings or `GET /challenges/:id` for
   non-participants (404 — no existence oracle).
5. **Reward bounds** — Configurable via `platform_configs`, defaults
   **10–500 credits**; deadline default **48h**, max **168h (7d)**;
   review window **48h** (`reviewDeadline` on the completion, admin escalation
   via the existing pending-submissions queue).
6. **Discovery placement** — **Dedicated "1v1 Challenges" tab** under Find
   tasks (`/tasks?tab=challenges`), alongside Browse and My tasks. Creator
   entry points: My campaigns → "1v1 challenge" button and the tab's
   "Create challenge" — both open the same `ChallengeFormModal`.
7. **Platform fee** — Configurable `challenge_fee_rate`, **0% at launch**.
   `feeAmount = ceil(reward * rate)` snapshotted at publish
   (`feeRateSnapshot`, `feeAmount`, `reservedCredits`); fee recorded as
   `PlatformRevenue` source `CHALLENGE_FEE` only on approval.
8. **Claim security** — Atomic conditional `UPDATE ... WHERE status='OPEN'
   AND expires_at > NOW()` inside a transaction + `TaskCompletion.challengeId`
   `@unique` DB backstop + `CHECK (num_nonnulls(campaign_id, challenge_id) = 1)`
   XOR constraint. Self-claims, expired, and closed challenges rejected.
   Private claims re-verify the password server-side on every attempt.
9. **Review authorization** — Proof submittable only by the claimant;
   reviewable by the creator (`PATCH /challenges/:id/submissions/:cid/review`)
   or admin escalation (`AdminService.reviewSubmission` challenge branch).
   Approve/reject both serialize on `status=SUBMITTED → terminal` guarded
   `updateMany` — exactly-once settlement, no double payout.
10. **Expiry sweep** — `@Cron(EVERY_5_MINUTES)`: OPEN past `expiresAt` →
    EXPIRED + full refund; CLAIMED with abandoned (ASSIGNED/IN_PROGRESS past
    expiry) completion → both EXPIRED + full refund; SUBMITTED stays CLAIMED
    with reserve held for creator/admin review.
11. **Visitor analytics** — Explicitly out of scope for this PR.

### Implementation map

- Schema: `Challenge` model + `ChallengeStatus`/`ChallengeVisibility` enums,
  `TaskCompletion.challengeId @unique`, `PlatformRevenue.challengeId`,
  `TransactionType` +`SPEND_CHALLENGE_CREATE`/`REFUND_CHALLENGE_CLOSE`/
  `PLATFORM_FEE_CHALLENGE`. Migration `20261105170000_add_1v1_challenges`.
- API: `modules/challenges/` (DTOs, service, controller, module);
  challenge-aware branches in `TasksService.submitProof`,
  `AdminService.reviewSubmission`/`listPendingSubmissions`,
  `proof-access.middleware`, `CampaignsService` browse exclusion.
- Web: `tasks?tab=challenges` tab + cards + pinned accepted panel;
  `ChallengeFormModal` (shared create flow); `MyChallenges` creator section
  on My campaigns; `/challenge/[id]` share-link page with password gate.
- Tests: `challenges.service.spec.ts` (24 unit tests),
  `challenges.integration.spec.ts` (real-PostgreSQL, CI-gated).

---

# v2 Proposal: Mutual 1v1 Challenge Rooms (design for review — NOT implemented)

Status: **design proposal — awaiting approval before implementation**

v1 (above, deployed in PR #42) is a **one-sided bounty**: one creator posts a
task + credit reward, one claimer earns credits. v2 introduces **mutual rooms**:
two players each reserve an equal credit contribution, each proposes a task
for the other to perform, and the room pays out in **P2P points** — never
wallet credits. When both players accept the same offer version, Engganyo
collects the combined 2X as the **room charge**. v1 challenges and their
reserves remain untouched under their original terms; room contributions use
separate ledger types and separate tables.

## 1. Audit — what already exists (verified against `main` @ `6d4ae0b`)

| Concern | Existing asset | Reuse decision |
|---|---|---|
| Reserve/ledger | `walletService.debit/credit` + typed `Transaction` ledger; v1 pattern (`SPEND_CHALLENGE_CREATE` debit at publish, `REFUND_CHALLENGE_CLOSE` credit on non-award close) | Same pattern, new types `SPEND_ROOM_CREATE` / `SPEND_ROOM_CLAIM` / `REFUND_ROOM_CLOSE` / `REFUND_ROOM_RESOLUTION`. At AGREED the combined 2X is recorded as `PlatformRevenue` (`ROOM_CHARGE`) — **no wallet is debited at capture**, so collection can never debit twice |
| Atomic single-slot claim | Conditional `UPDATE ... WHERE status='OPEN'` inside tx + `RETURNING` (v1 `claim`) | Same for room claim, **plus** the claimant's `debit` inside the same transaction — a losing or underfunded claimant pays nothing |
| Password-gated private listing | `passwordHash` (argon2), `POST /challenges/:id/preview` + `/access`, 5-fail/IP → 15-min Redis lockout, 404 no-oracle for private detail | Same pattern, per-room |
| Proof pipeline | Upload → hash → `TaskCompletion` states (ASSIGNED→IN_PROGRESS→SUBMITTED→VERIFIED/REJECTED/DISPUTED), `reviewDeadline` → admin escalation | Reuse upload/hash helpers and the review-deadline escalation pattern, but **new `RoomSubmission` table** — room proof needs *peer* review (each player reviews the other's work), which `TaskCompletion`'s creator-reviews-claimer semantics don't express |
| Chat | `Channel` (`PRIVATE` type) + `ChannelMember` + `ChannelMessage` + `ChannelsGateway` (socket.io) + `Report.messageId` + `ChannelMessageMention` | **Auto-provision one PRIVATE `Channel` per room** (`slug = room-{id}`) with exactly the two participants as members. Inherits socket auth, history, mentions, message reports, soft-delete. Moderators get read access via a server-side check, never membership |
| Moderation | `Report` model (user/campaign/topic/reply/message targets), admin queues (`admin/queues`), `AbuseFlag`, `AuditLog` | Add `roomId` target to `Report` (or report via room messages); new admin queue views for room disputes + overdue room reviews; every moderator read/action writes `AuditLog` |
| Abuse infra | `TrustScore`, `IpRecord`, `DeviceFingerprint`, shared-IP guard (v1 claim path) | Reuse; room claim adds the same-IP self-farm check **plus** a same-pair-frequency check (see §7) |
| Leaderboard | `user.xp` + `XpEvent` (alltime/weekly), `VpEvent` → `VipTier` perks | **P2P points are a new, separate ledger** (`P2pPointEvent`) — explicitly NOT XP, VP, or credits. New `/leaderboard/p2p` endpoint, same pagination/cache pattern |
| Platform restrictions | `TaskType` enum + `DISABLED_TASK_TYPES` (e.g. YouTube engagement) + target-URL allowlist validation | Enforced on **both** room offers at submit and re-validated at agreement lock |

## 2. Data model

```prisma
enum RoomStatus {
  OPEN          // published, awaiting claimant; A's X reserved
  CLAIMED       // B claimed + B's X reserved; negotiation window open
  NEGOTIATING   // offers being proposed/edited/approved (same as CLAIMED, explicit for UX)
  AGREED        // both approved the same offer version; work locked, deadlines set
  IN_PROGRESS   // at least one submission made (derived; kept for query simplicity)
  COMPLETED     // terminal — both directions verified, points awarded
  DISPUTED      // terminal-in-effect — frozen pending admin resolution
  CLOSED        // terminal — closed pre-agreement, both reserves refunded
  EXPIRED       // terminal — deadline elapsed pre-agreement, both refunded
}

enum RoomOfferStatus { PROPOSED APPROVED LOCKED REJECTED }
enum RoomSubmissionStatus { SUBMITTED APPROVED REJECTED DISPUTED }

model ChallengeRoom {
  id                  String   @id @default(cuid())
  creatorId           String   @map("creator_id")
  creator             User     @relation("RoomCreator", fields: [creatorId], references: [id])
  claimerId           String?  @map("claimer_id")
  claimer             User?    @relation("RoomClaimer", fields: [claimerId], references: [id])
  contributionCredits Int      @map("contribution_credits") // X per player, snapshot
  roomCharge          Int      @map("room_charge")          // 2X — collected at AGREED
  title               String                               // public card title (no task details for private)
  visibility          ChallengeVisibility @default(PUBLIC)
  passwordHash        String?  @map("password_hash")        // argon2, never plaintext
  status              RoomStatus @default(OPEN)
  channelId           String?  @unique @map("channel_id")   // auto-provisioned private Channel
  // negotiation
  agreedVersion       Int?     @map("agreed_version")       // offer version both approved
  creatorApprovedVersion Int?  @map("creator_approved_version")
  claimerApprovedVersion Int?  @map("claimer_approved_version")
  // deadlines (all UTC, server-set)
  claimExpiresAt      DateTime @map("claim_expires_at")
  negotiationEndsAt   DateTime? @map("negotiation_ends_at")
  workEndsAt          DateTime? @map("work_ends_at")        // set at AGREED
  // economics
  creatorTxId         String?  @map("creator_tx_id")        // SPEND_ROOM_CREATE txn
  claimerTxId         String?  @map("claimer_tx_id")        // SPEND_ROOM_CLAIM txn
  chargeCollectedAt   DateTime? @map("charge_collected_at") // set at AGREED — 2X → PlatformRevenue
  closedAt            DateTime? @map("closed_at")
  closeReason         String?  @map("close_reason")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  offers       RoomOffer[]
  submissions  RoomSubmission[]
  pointEvents  P2pPointEvent[]
  disputes     RoomDispute[]

  @@index([status, visibility, createdAt])
  @@index([creatorId]) @@index([claimerId])
  @@map("challenge_rooms")
}

model RoomOffer {
  id           String   @id @default(cuid())
  roomId       String   @map("room_id")
  room         ChallengeRoom @relation(fields: [roomId], references: [id])
  version      Int                                   // increments on any edit
  proposerId   String   @map("proposer_id")           // who proposed this task
  proposer     User     @relation(fields: [proposerId], references: [id])
  // The PERFORMER is always the counterparty (the other room player) — derived
  // from proposerRole, never stored, so it cannot disagree with room membership.
  proposerRole RoomRole @map("proposer_role")          // CREATOR | CLAIMER — who proposed
  actionText   String   @map("action_text") @db.Text  // clear action, e.g. "Follow @x on TikTok"
  taskType     TaskType @map("task_type")
  targetUrl    String   @map("target_url")
  deadline     DateTime                            // per-offer work deadline (≤ room.workEndsAt)
  requiresProof Boolean @default(true) @map("requires_proof")
  proofInstructions String? @map("proof_instructions") @db.Text
  status       RoomOfferStatus @default(PROPOSED)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  submissions  RoomSubmission[]
  @@unique([roomId, version, proposerRole])
  @@index([roomId, status])
  @@map("room_offers")
}

enum RoomRole { CREATOR CLAIMER }

model RoomSubmission {
  id          String   @id @default(cuid())
  roomId      String   @map("room_id")
  room        ChallengeRoom @relation(fields: [roomId], references: [id])
  offerId     String   @map("offer_id")
  offer       RoomOffer @relation(fields: [offerId], references: [id])
  submittedById String @map("submitted_by_id")       // must equal offer's performer
  submittedBy User     @relation(fields: [submittedById], references: [id])
  // proof references reuse the existing upload + sha256 pipeline (proof_url, proof_hash)
  proofUrl    String?  @map("proof_url")
  proofHash   String?  @map("proof_hash")
  note        String?  @db.Text
  status      RoomSubmissionStatus @default(SUBMITTED)
  reviewedById String? @map("reviewed_by_id")        // the peer reviewer (or admin)
  reviewedAt  DateTime? @map("reviewed_at")
  reviewNote  String?  @map("review_note") @db.Text
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([roomId, status])
  @@map("room_submissions")
}

model P2pPointEvent {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id])
  roomId    String   @map("room_id")
  room      ChallengeRoom @relation(fields: [roomId], references: [id])
  role      RoomRole                            // CREATOR | CLAIMER — breakdown for leaderboard
  points    Int      @default(1)
  reversedAt DateTime? @map("reversed_at")       // audited reversal path
  reversalReason String? @map("reversal_reason")
  createdAt DateTime @default(now()) @map("created_at")

  @@unique([userId, roomId])    // exactly-once point award per player per room
  @@index([userId, reversedAt])
  @@map("p2p_point_events")
}

model RoomDispute {
  id          String   @id @default(cuid())
  roomId      String   @map("room_id")
  room        ChallengeRoom @relation(fields: [roomId], references: [id])
  openedById  String   @map("opened_by_id")
  openedBy    User     @relation(fields: [openedById], references: [id])
  reason      String   @db.Text
  evidence    Json?                              // links to submissions/messages
  status      ReportStatus @default(OPEN)
  resolution  String?  @db.Text
  resolvedById String? @map("resolved_by_id")
  resolvedAt  DateTime? @map("resolved_at")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([status, createdAt])
  @@map("room_disputes")
}
```

`TransactionType` additions: `SPEND_ROOM_CREATE`, `SPEND_ROOM_CLAIM`,
`REFUND_ROOM_CLOSE` (pre-agreement full refund), `REFUND_ROOM_RESOLUTION`
(post-agreement refund of a player's own contribution — original payer only).
`PlatformRevenue` gains `roomId String? @unique` + `source: 'ROOM_CHARGE'`
for the 2X collected at agreement.

`Report` gains `roomId String?` so in-room reports land in the existing admin
queue with a room context link.

## 3. Lifecycle

```
A publishes (debit X)                B claims (debit X, same tx)
      │                                    │
      ▼                                    ▼
   OPEN ──────────────────────────────► CLAIMED/NEGOTIATING
   claimExpiresAt (default 72h)        negotiationEndsAt (default 48h)
                                               │
              ┌── negotiation timeout ─────────┤ both approve same version
              ▼                                ▼
        EXPIRED (refund each own X)         AGREED — offers LOCKED,
                                           workEndsAt set, 2X collected as
                                           room charge (PlatformRevenue)
              ┌── dispute / admin ────────────┤
              ▼                                ▼
           DISPUTED                        IN_PROGRESS
                                           each submits proof for OWN work,
                                           reviews peer's proof
              │                                │
              │                    both directions APPROVED
              │                                ▼
              │                            COMPLETED
              │                            +1 P2pPointEvent per player
              │                            (unique userId+roomId)
              ▼
        admin resolves → refund/award/points per decision table
```

### Deadlines (all server-set, UTC)

| Phase | Deadline | On elapse |
|---|---|---|
| Claim window | `claimExpiresAt` = publish + **72h** (config) | Sweep → EXPIRED, refund A's X (`REFUND_ROOM_CLOSE`) |
| Negotiation | `negotiationEndsAt` = claim + **48h** (config) | Sweep → EXPIRED, refund A's X + B's X |
| Work | `workEndsAt` = agreement + **72h** default, per-offer `deadline` ≤ workEndsAt | Per-offer: unsubmitted direction → that player "abandoned"; room → DISPUTED for admin (see section 5) |
| Review | submission + **48h** (`reviewDeadline`, same as v1) | Escalates to admin pending-submissions queue |

A silent participant can therefore strand a room for at most ~48h in
negotiation or ~72h+48h in work/review before admin escalation — never forever.

## 4. Equal contributions, reserve & room-charge semantics

The rules are identical at every stage — reservation, collection, and refund:

- `contributionCredits` X is **snapshotted at publish** and shown identically to
  both players. `roomCharge = 2X` is displayed at agreement ("the room charge
  is 50 credits").
- **Reserve A**: `walletService.debit(A, X, SPEND_ROOM_CREATE)` inside the publish
  tx — insufficient balance → publish fails, no room row.
- **Reserve B**: inside the claim tx — `UPDATE rooms SET status='CLAIMED',
  claimerId=B WHERE id=? AND status='OPEN' AND claimExpiresAt>now` **then**
  `debit(B, X, SPEND_ROOM_CLAIM)`; any failure rolls back both. Loser pays nothing.
- **Collect the room charge**: when both players approve the same offer version,
  one transaction sets `chargeCollectedAt` and writes a single
  `PlatformRevenue` row (`source: 'ROOM_CHARGE'`, `amount: 2X`, `roomId`) —
  Engganyo collects the combined 2X as the room charge. **No wallet is debited
  at this step**: both X debits already settled at reserve time, so capture
  cannot debit either balance a second time. The approval update is conditional
  on the matched version, so concurrent approvals collect the charge exactly once.
- **Refunds return credits only to the original payer.** Pre-agreement close
  (expiry, cancel, negotiation timeout) credits each player's own X back via
  `REFUND_ROOM_CLOSE`. Post-agreement refunds (admin resolution only) credit
  the affected player's own X via `REFUND_ROOM_RESOLUTION` — never another
  player's contribution, never a different account.
- **Proposed launch price: X = 25 credits** (matches a mid-tier wheel prize;
  meaningful but not punishing). **Needs approval** — configurable via
  `platform_configs` (`room_contribution_credits`) before launch.

## 5. Mutual offers, proof, completion, ranking

- Each player authors **one active offer per direction** — the task they propose
  for the *other* player to perform. Editing either offer increments `version`
  and clears
  **both** `creatorApprovedVersion`/`claimerApprovedVersion` — approvals are
  always against the exact version both saw.
- Offer fields: `actionText`, `taskType` (platform-restricted types rejected),
  `targetUrl` (same allowlist as campaigns/challenges), `deadline` (≤ room
  `workEndsAt`), `requiresProof` + instructions.
- Agreement requires `creatorApprovedVersion = claimerApprovedVersion = V` where
  V is the max version of **both** directions — enforced in one conditional
  update; stale-version approvals are rejected server-side.
- Each player submits proof **for their own work** (`submittedById` must equal
  the offer's performer — server-enforced) and **reviews the peer's** proof.
  Rejection may be disputed once → `DISPUTED` → admin queue.
- **Points**: only when the room reaches COMPLETED — both tasks verified,
  including verification granted through moderation. Insert two
  `P2pPointEvent` rows (one per player, `role` = CREATOR/CLAIMER) inside the
  completion tx. `@@unique([userId,roomId])` makes double-award impossible;
  reversal sets `reversedAt` + reason (audited). An incomplete room — one-sided
  abandonment, rejected proof, invalid terms — awards **zero points**.
- **Leaderboard**: `GET /leaderboard/p2p?type=alltime|weekly` — sums
  non-reversed `P2pPointEvent`, paginated + Redis-cached like `getLeaderboard`.
  Breakdown shows total completions + creator/claimant split per user.

### Refund & dispute decision table (PROPOSED — needs approval)

| Situation | Who can close | Evidence required | Refund | Points |
|---|---|---|---|---|
| Pre-agreement: claim/negotiation expiry, either player cancels | System / either player | n/a | **Each player's own X refunded** to the original payer | none |
| Post-agreement, both tasks verified (including via moderation) | System / admin | both submissions APPROVED | none — the 2X room charge stands | **+1 each** |
| Post-agreement, one side abandons (no submission by workEndsAt) | Either player → DISPUTED → admin | room state + deadlines + peer's completed work | **Affected player's own X refunded** (`REFUND_ROOM_RESOLUTION`); abandoner's X stays as room charge — **no player ever receives the other's contribution** | **zero — incomplete room awards no points** |
| Post-agreement, proof rejected, dispute lost | Admin | submission evidence | per admin ruling — refunds only ever return a player's own X | per ruling; points only if both directions end verified |
| Invalid terms (offer violated platform rules / self-dealing detected) | Admin | offer + proof review | **Each player's own X refunded**; abuse flags on both | none; points reversed if already awarded |
| Confirmed abuse (alt-account pair farming, recycled proof) | Admin | AbuseFlag/IpRecord/DeviceFingerprint correlation | each player's own X refunded per ruling + flags | reversed via `reversedAt` |

**Post-agreement rule callout for approval**: once AGREED, the 2X room charge
is collected and contributions are **non-refundable by default** — the only
exits are mutual verified completion (points awarded), mutual cancel *before
any submission* (each own X refunded), or admin dispute resolution (refunds
return only the affected player's own contribution; an incomplete room never
awards points).

## 6. Route map (proposed)

```
GET    /rooms                      public OPEN rooms (visibility-filtered, paginated)
POST   /rooms/quote                { contributionCredits } → fee/reserve preview
POST   /rooms                      publish (reserve A) — title, X, visibility, password?, claim window
GET    /rooms/:id                  detail — private returns {requiresPassword} until /access
POST   /rooms/:id/preview|access   password gate (argon2, 5-fail/IP lockout)
POST   /rooms/:id/claim            atomic claim + reserve B
GET    /rooms/:id/room-state       negotiation state: offers, approvals, my obligations
PUT    /rooms/offers/:direction    propose/edit my offer (bumps version, clears approvals)
POST   /rooms/:id/approve          approve current version (both must match)
POST   /rooms/:id/offers/:oid/submit-proof   upload proof for MY offer
POST   /rooms/submissions/:sid/review       peer approve/reject
POST   /rooms/:id/dispute          open dispute (freezes room)
POST   /rooms/:id/cancel           cancel — pre-agreement only
GET    /rooms/mine                 my rooms (creator/claimant, all statuses)
GET    /leaderboard/p2p            P2P points leaderboard
Admin: GET /admin/rooms/disputes, /admin/rooms/overdue, POST /admin/rooms/:id/resolve
WS     channel events via existing ChannelsGateway (room-{id} private channel)
```

## 7. Chat & moderation

- Room chat = auto-provisioned `PRIVATE` `Channel` (`slug=room-{id}`) created in
  the claim tx; exactly two `ChannelMember` rows. History, mentions, soft-delete,
  and socket fan-out come free from `ChannelsGateway`.
- **Access**: message history/send/subscription require room participation —
  enforced by channel membership (only the two players are ever members) **plus**
  a server-side room-status check (chat read-only or closed post-COMPLETED per
  retention policy). Moderators read via admin API with `AuditLog` entry per
  access; they are never channel members.
- **Report**: in-room "Report" action → `Report` with `messageId` (existing) or
  `roomId` (new) → admin reports queue. Room-level dispute → `RoomDispute` → new
  admin queue tab alongside pending submissions.
- **Passwords**: argon2 `passwordHash`, same 5-fail/IP→15-min Redis lockout as v1.
- **Retention (proposed)**: room messages **90 days** post-COMPLETED/CLOSED,
  then purge (channel soft-delete + content scrub); proof files retained per
  existing upload policy; `P2pPointEvent` and ledger rows retained permanently
  (financial record). **Needs approval.**

## 8. Abuse & accounting

- All money movement is conditional-update + ledger-entry-idempotent:
  claim (`status='OPEN'` guard), approval (`version` match guard), completion
  (`@@unique(userId,roomId)` on points), refunds (`closeReason` set once inside
  the close tx — repeated sweeps/refund calls write 0 rows).
- Self-claim blocked (`creatorId != claimerId`); creator cannot claim own room.
- Same-IP guard from v1 applies; **plus** same-pair rule: a user pair may run at
  most **N=3 rooms per 7 days** (config) — beyond that, claims require elevated
  trust or are flagged for review. Legitimate shared-connection users (household,
  campus NAT) are handled by: the limit being pair-scoped not IP-scoped, a
  one-click "we know each other" trust bypass after manual review, and
  `IpRecord`/`DeviceFingerprint` used as *signals* for admin review, never as
  automatic bans.
- Recycled proof: `proofHash` check across a user's prior submissions.
- Alternate accounts: existing `TrustScore`/`AbuseFlag` review queue; room
  completion with a flagged pair → points withheld pending review.

## 9. Wireframes

### Discovery card — Find tasks → "Rooms" filter (390px / 1440px)

```
390px                                    1440px
┌──────────────────────────────┐   ┌──────────────────────────────────────────────────────┐
│ 🎲 Mutual Room          OPEN │   │ 🎲 Mutual Room                          OPEN · 1 slot  │
│ "Trade TikTok follows"       │   │ "Trade TikTok follows"        by @player_one        │
│ 25 cr each · charge 50 cr    │   │ 25 cr each · room charge 50 cr · claim by in 2d 4h │
│ Public · TikTok · ⏳ 46h left │   │ Public · TikTok · ⏳ 46h left · 🔒 optional password │
│ [ View room ]                │   │ [ View room ]                                         │
└──────────────────────────────┘   └──────────────────────────────────────────────────────┘
```

### Room lobby — negotiation (both players)

```
┌──────────────────────────────────────────────────────────────┐
│ Room: Trade TikTok follows              Status: NEGOTIATING   │
│ You pay 25 · they pay 25 · charge 50 · agree by Nov 9         │
├───────────────────────────────┬──────────────────────────────┤
│ REQUEST you proposed          │ REQUEST they proposed       │
│ (they perform)  v3            │ (you perform)   v2          │
│ "Follow @player2"             │ "Like my latest video"      │
│ TikTok · due Nov 8 · proof ✓  │ YouTube · due Nov 8 · proof✓ │
│ [ Edit offer ]  [ Approve v3 ]│ awaiting their approval      │
├───────────────────────────────┴──────────────────────────────┤
│ 💬 Room chat (private)                          [ Report ⚑ ] │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ player_one: sounds good, I can do the follow tonight     │ │
│ │ player_two:  same — approve when ready                   │ │
│ └──────────────────────────────────────────────────────────┘ │
│ [ Dispute room ] [ Leave room — both contributions refunded ] │
└──────────────────────────────────────────────────────────────┘
```

### Work phase — "what I owe / what they owe / what I can do"

```
┌──────────────────────────────────────────────────────────────┐
│ AGREED · charge 50 collected · work due Nov 10               │
├───────────────────────────────┬──────────────────────────────┤
│ YOU OWE (they requested)      │ THEY OWE (you requested)     │
│ "Like my latest video" YouTube│ "Follow @player2"   TikTok  │
│ Due Nov 9 · proof required    │ Due Nov 9 · proof required   │
│ [ Upload proof ]              │ status: not submitted        │
├───────────────────────────────┴──────────────────────────────┤
│ Their proof for your request (when submitted):               │
│ [ Approve ] [ Reject ]                                       │
│ Your proof status: SUBMITTED → awaiting their review         │
└──────────────────────────────────────────────────────────────┘
```

## 10. Test plan

**Two players (player_one / player_two, controlled env):**
1. Publish → reserve debit visible; insufficient-balance publish → 400, no row.
2. Simultaneous claims (N parallel) → exactly one 201, one `SPEND_ROOM_CLAIM`;
   underfunded claimant → 400, zero ledger rows.
3. Offer edit → version bump + approvals cleared; stale-version approve → 409;
   both approve same version → AGREED, `chargeCollectedAt` set + one
   `PlatformRevenue` (ROOM_CHARGE, 2X) row, **no second debit**
   (balance deltas asserted).
4. Each submits proof for own offer only (`submittedById` enforcement — player
   cannot submit for peer's offer → 403); peer reviews; both APPROVED →
   COMPLETED + exactly 2 `P2pPointEvent` rows.
5. Pre-agreement expiry → both `REFUND_ROOM_CLOSE` credits, balances restored.

**Outsider:** cannot read room detail/state/chat history/send messages/subscribe
to channel (403/404); private room invisible in listings + no existence oracle;
password brute-force → lockout.

**Moderator:** dispute queue visibility; resolve actions audited (`AuditLog`);
points reversal path (`reversedAt` + leaderboard excludes reversed).

**Abuse:** same-IP self-claim → 403; same-pair >N rooms/7d → flagged;
recycled `proofHash` → rejected; expiry-vs-proof-submission race → exactly one
outcome; repeated refund/sweep runs → 0 extra ledger rows; alternate-account
pair → points withheld pending review.

## 11. Decisions needed before implementation

1. **Launch price X = 25 credits per player** — approve or adjust
   (`room_contribution_credits`). The room charge is then 50 credits.
2. **Post-agreement refund rule** — approve the decision table in section 5:
   the 2X room charge stands once AGREED; one-sided abandonment may refund the
   affected player's own X (original payer only) with zero points for the
   incomplete room.
3. **Additional platform fee on rooms** — proposal: **none beyond the 2X room
   charge** at launch (the charge itself is the platform's take; a separate
   `room_fee_rate` on top would double-charge the mental model). Optional later.
4. **Chat retention 90 days** post-close — approve or adjust.
5. **v1 coexistence** — rooms live under `/rooms` + a "Rooms" filter/tab;
   v1 `Challenge` flow unchanged. No data migration.
6. **Pair-frequency limit N=3 rooms/7d** — approve threshold.

---

# v3 Revision — owner requirements (design for review — NOT implemented)

Status: **revised design proposal — awaiting approval before implementation**

This section revises v2 where the owner's new requirements change lifecycle,
accounting, API, wireframes, or tests. Where v3 is silent, v2 stands. Items
marked **[OWNER DECISION]** are unresolved and listed again in §11.

## V3.1 Active-room duration: 30 minutes, server-timed

- **Two distinct clocks.** `claimExpiresAt` (unclaimed listing expiry, default
  72h, unchanged) governs only OPEN rooms. Once the second player accepts
  (transition to NEGOTIATING), one transaction atomically persists
  `startedAt = now()` and `expiresAt = startedAt + 30 minutes` (config:
  `room_active_minutes`, default 30). `expiresAt` is **never recomputed** —
  reloads, reconnects, socket drops, and page refreshes cannot restart it.
- **Countdown UX.** Both players see a persistent countdown + the exact UTC
  deadline ("Room closes at 14:32 UTC") in the room header on every phase:
  negotiating, agreed, in-progress, submitted, disputed. Under 5 minutes the
  countdown turns warning-colored.
- **Deadline consequence (stated before agreement).** At `expiresAt`, any room
  not COMPLETED closes as **EXPIRED**. Pending proof/review does **not**
  survive the deadline in v1: submissions still SUBMITTED at expiry are closed
  with the room (reviewers see "expired — no payout"). The agreement screen
  must display this plainly: *"You have 30 minutes from acceptance to finish
  both tasks and reviews. Anything unfinished at the deadline expires and
  refunds both contributions."*
- **Exactly-once unwind.** The expiry transition is a single conditional
  `UPDATE ... WHERE status IN (active states) AND expiresAt <= now()` that sets
  status=EXPIRED, `closedAt`, `closeReason='ACTIVE_TIMEOUT'` — repeated sweep
  runs and concurrent manual expiry calls match 0 rows thereafter. Refunds
  inside the same tx: each player's own X via `REFUND_ROOM_CLOSE`-family
  entries **and** reversal of the `PlatformRevenue ROOM_CHARGE` (2X) row
  collected at AGREED — record `PlatformRevenue.reversedAt`/`reversalReason`
  (or an offsetting `ROOM_CHARGE_REVERSAL` row if revenue rows are immutable —
  **[OWNER DECISION: reversal representation]**). Net platform revenue from an
  expired room is zero.
- **Completion racing expiry — deterministic rule.** All terminal transitions
  (peer approval → COMPLETED, expiry sweep → EXPIRED, player cancel → CLOSED,
  dispute freeze) execute as conditional updates evaluated against **server
  time inside the same transaction**: a completion commit includes
  `AND expiresAt > now()` in its WHERE clause. Whichever statement acquires the
  row lock first wins; the loser matches 0 rows and returns 409
  `ROOM_CLOSED`. There is no read-then-write window — the database decides.
  Both players' balances, ledger, room state, and points are asserted in tests
  for each interleaving.
- **Enforcement points.** Every room action (offer edit, approve, submit
  proof, review, dispute, cancel, notify, rate) first checks
  `status ∈ active AND expiresAt > now()` server-side — expired rooms reject
  mutations with 409 even before the sweep runs.
- **Recovery sweep.** Extend the existing `@Cron` sweep: rooms past
  `expiresAt` in any non-terminal state → EXPIRED + unwind (idempotent).
  Sweep cadence 1–5 min; worst-case overstay is one interval.
- **Expired rooms leave discovery.** `GET /rooms` lists only OPEN rooms;
  EXPIRED/CLOSED/COMPLETED never appear. `GET /rooms/mine` retains them with
  status + refund outcome.

## V3.2 One active room per user (atomic)

- **Rule.** A user may hold at most **one non-terminal room** across both
  roles: created (OPEN) or joined (NEGOTIATING/AGREED/IN_PROGRESS/SUBMITTED/
  DISPUTED-unresolved). Terminal states — COMPLETED, CLOSED, EXPIRED, and
  DISPUTED-after-admin-resolution — release eligibility.
- **Atomic enforcement.** New table `RoomParticipation`:
  `@@unique([userId]) WHERE released_at IS NULL` implemented as a partial
  unique index on `(user_id) WHERE released_at IS NULL`. Create and claim
  insert the participation row **inside the same transaction** as the room
  row / claim update + credit reserve. Postgres serializes on the unique
  index — simultaneous create/create, create/join, and join/join losers get
  `23505` → 409 `ACTIVE_ROOM_EXISTS` **before** any debit executes, so losers
  reserve no credits and gain no room access. Release = set `released_at`
  in the terminal-transition tx.
- **UX.** Create/join buttons are disabled with "You already have an active
  room" + **Resume room** deep link (`/rooms/:id`) when `GET /rooms/mine`
  shows a non-terminal room. Server remains authoritative — UI is advisory.
- **Scope question — v1 challenges.** **[OWNER DECISION]** Proposal: the
  restriction applies to **rooms only** in v1 — existing 1v1 `Challenge`
  claims are unchanged (a user may hold one room + any number of v1
  challenges). Extending the guard to v1 would change shipped behavior and
  needs explicit approval.

## V3.3 Notify other player

- **Action.** "Notify" button in the room header (both phases, while room is
  active). Sends a private in-app notification to the other participant +
  a socket event `room:ping` on the room's private channel.
- **Delivery.** Reuses `notificationsService.createNotification`
  (type `ROOM_NUDGE`, deep link `/rooms/:id`) — persists for the recipient's
  notification center. Socket event carries `{ roomId, fromUserId, pingId }`
  for real-time toast.
- **Sound.** Client plays a short two-tone chime via WebAudio **only if**:
  (a) `navigator.mediaDevices`/AudioContext allowed after a user gesture,
  (b) the recipient's sound preference is on (new user setting
  `room_nudge_sound`, default on), and (c) no `prefers-reduced-motion`-style
  accessibility flag suppresses it. If audio is blocked/denied, a visible
  "🔇 sound blocked — check browser permissions" hint appears once per
  session; the in-app notification still arrives.
- **Server enforcement.** Cooldown **60s per sender per room** (Redis
  `room:nudge:{roomId}:{userId}` TTL, fail-open to DB check if Redis down —
  cooldown is anti-spam, not financial). Dedup: client supplies `pingId`
  (uuid); `RoomNudge` row `@@unique([roomId, pingId])` makes retries
  idempotent. Limits: max **10 nudges/room/day/sender**, max **50
  nudges/room total** — beyond that 429 `NUDGE_LIMIT`. Requires room
  membership + active status + `expiresAt > now()`.
- **Feedback.** Button shows "Sent · next in 0:42" countdown; on 429/409 the
  remaining cooldown or closed-state reason is displayed.

## V3.4 Participant actions

Row in room header (both players, active room):

| Action | Behavior |
|---|---|
| **View profile** | Link to `/users/{username}` — existing public profile page |
| **Add friend** | **[OWNER DECISION / scope]** No friendship primitive exists in the codebase today (verified: no Friend/UserConnection model). Proposal: v1 ships **View profile + Report user**; a minimal `FriendRequest` (PENDING/ACCEPTED/DECLINED, mutual-consent) is a fast-follow if wanted — it is a new social graph, not a room feature. Alternative: omit entirely. |
| **Report user** | Opens report dialog pre-scoped to the room: `Report.targetUserId` = participant, `reason`, `description`, `evidence` JSON auto-attached with `{ roomId, roomStatus, offerVersions, submissionIds, lastMessages }` — private, admin-queue only (`reports` admin view + room context). Confirmation dialog warns the report is private and reviewed by moderators. Rate-limited via existing report abuse checks. |

Block/mute: if a user-block primitive is added later it gates room chat +
notifications; not required for v1.

## V3.5 Post-completion ratings

- **When.** Only after room COMPLETED (both directions verified). Each
  participant may submit **one rating per room**: `score` 1–5 + optional
  `review` text (≤280 chars).
- **Schema.** `RoomRating { roomId, raterId, rateeId, score, review,
  createdAt, @@unique([roomId, raterId]) }` — one rating per rater per room;
  `raterId != rateeId` CHECK; both must be room participants (server-verified
  against `RoomParticipation`/room membership, never client-supplied).
- **Anti-retaliation window.** Ratings are **hidden until both players have
  rated or the window closes**: `ratingRevealAt = completedAt + 24h`
  (config `room_rating_window_hours`). Before reveal, players see "rating
  pending"; after reveal (or when both submitted early), both see each
  other's score+review. A player who never rates simply doesn't appear.
- **Presentation.** Average + count shown on the public profile
  (`/users/{username}`) as a separate "Room ratings" line — **never mixed**
  with XP/VP/reputation score or P2P points.
- **Moderation.** Reviews are reportable (existing `Report` with
  `targetUserId` + evidence `{roomId, ratingId}`); admin can hide a review
  (`hiddenAt`) without deleting the rating row (audit preserved). Profanity/
  scam filters reuse existing text moderation if present.
- **Anti-farming.** One rating per room per rater (unique), rooms require
  real dual completion, pair-frequency limit (§V3.2/v2 §8) caps rating
  volume, new accounts (<7d or <N completions) can receive but their ratings
  carry a "new player" flag. Rating does not affect credits, points, or
  wallet — purely reputational.

## V3.6 Revised lifecycle (supersedes v2 §3 timing)

```
A publishes (debit X, claimExpiresAt = +72h)
      │
      ▼
   OPEN ──B claims (debit X, same tx)──► NEGOTIATING
                                        negotiationEndsAt = claim + 48h (v2)
                                        startedAt/expiresAt set at
                                        AGREED (second-player acceptance)
      ┌── claim/negotiation expiry ──────┤ both approve same offer version
      ▼                                 ▼
   EXPIRED (refund each own X)      AGREED — 2X room charge collected,
                                    expiresAt = now + 30min
      ┌── dispute/admin ────────────────┤
      ▼                                 ▼
   DISPUTED                        IN_PROGRESS → SUBMITTED → COMPLETED
   (frozen, admin queue)           any unfinished state at expiresAt
                                   → EXPIRED: refund each own X +
                                   reverse ROOM_CHARGE 2X
```

Terminal states release the §V3.2 active-room slot. `DISPUTED` holds the slot
until admin resolution (a frozen room still occupies the player — prevents
dispute-spam slot-hopping).

## V3.7 Revised API plan (deltas to v2 §6)

```
POST   /rooms/:id/accept-agreement   second-player acceptance → AGREED,
                                     startedAt/expiresAt persisted atomically,
                                     2X ROOM_CHARGE collected (v2 approve flow
                                     split: version-match approval → this)
GET    /rooms/:id/state              adds: expiresAt, secondsRemaining,
                                     myActiveRoom flag, nudgeCooldownRemaining
POST   /rooms/:id/nudge              { pingId } — 60s cooldown, daily caps
GET    /rooms/mine                   adds activeRoom boolean per room;
                                     client derives "Resume room" target
POST   /rooms/:id/ratings            { score, review? } — COMPLETED rooms only,
                                     one per rater, hidden until reveal
GET    /users/:username/room-ratings public average + count (post-reveal)
Admin: unchanged + rating hide action (Report evidence links ratingId)
```

All room mutations enforce `expiresAt > now()` server-side; expiry enforced on
reads too (state endpoint reports EXPIRED truthfully before sweep runs).

## V3.8 Revised wireframes (deltas)

### Room header — countdown + participant actions (390px)

```
┌──────────────────────────────────────────────┐
│ Mutual Room · NEGOTIATING                    │
│ ⏱ 14:32 UTC · 23:41 left        [Notify 🔔]  │
│ @player_one  [Profile] [Report]              │
│ @player_two  [Profile] [Report]              │
└──────────────────────────────────────────────┘
```

### Agreement screen — consequence disclosure (both players, before approve)

```
┌──────────────────────────────────────────────┐
│ ⚠ 30-minute room                               │
│ The clock starts when you both accept. Finish  │
│ both tasks AND reviews before 14:32 UTC.       │
│ Unfinished rooms expire — both 25 cr          │
│ contributions are refunded, no points.         │
│ [ I understand — approve offers ]             │
└──────────────────────────────────────────────┘
```

### Post-completion — rating (after COMPLETED + reveal)

```
┌──────────────────────────────────────────────┐
│ Room completed! 🎉 You both earned +1 P2P pt  │
│ Rate @player_two:  ★★★★☆                    │
│ [ optional review, 280 chars ]  [ Submit ]    │
│ Their rating of you: pending (reveals 24h)    │
└──────────────────────────────────────────────┘
```

## V3.9 Expanded acceptance tests (supersedes/extends v2 §10)

**Timing & expiry**
1. AGREED persists `startedAt`/`expiresAt` atomically; reload/reconnect shows
   identical deadline (no restart).
2. Expiry before agreement (OPEN/NEGOTIATING) → EXPIRED, each own X refunded,
   zero revenue rows.
3. Expiry after agreement with pending proof → EXPIRED, each own X refunded
   **and** ROOM_CHARGE 2X reversed; net platform revenue = 0.
4. Expiry after agreement with both verified but completion commit racing
   deadline → exactly one outcome (COMPLETED+points XOR EXPIRED+refunds);
   assert balances/ledger/points for both interleavings.
5. Recovery sweep idempotent: run twice → second run writes 0 rows; expired
   rooms absent from `GET /rooms`.

**Active-room uniqueness**
6. Simultaneous create/create, create/join, join/join → exactly one wins;
   losers: no debit, no participation row, 409 `ACTIVE_ROOM_EXISTS`.
7. User in DISPUTED (unresolved) cannot create/join; after admin resolution →
   eligibility released.
8. `/rooms/mine` + Resume room deep link works at 390px/1440px.

**Notify**
9. Nudge → recipient gets in-app notification + socket event; sender sees
   cooldown countdown; retry within 60s → 429 with remaining time.
10. Spam: >10/day or >50/room → 429; duplicate `pingId` retry → deduped;
    outsider nudge → 403; expired-room nudge → 409.
11. Sound: blocked AudioContext → visible fallback hint; mute setting off →
    no chime but notification still arrives.

**Participant actions**
12. View profile link resolves; Report user → `Report` row with room
    evidence JSON visible only in admin queue; report rate-limit enforced.

**Ratings**
13. Rate before COMPLETED → 409; outsider rates → 403; self-rating → 400;
    second rating same room → 409 (unique); both rate → both revealed;
    window close → revealed; hidden review → profile shows average without it.

**Accounting (all outcomes)** — for each terminal path assert both wallets,
ledger rows, room status, and point events agree: publish-insufficient →
no row; claim-insufficient → rollback; pre-agreement close → refunds only;
post-agreement expiry → refunds + revenue reversal; mutual completion →
charge stands + 2 points; dispute resolutions per v2 table.

## V3.10 Remaining owner decisions (updated list)

1. **Contribution price X** — v2 proposed 25cr/player (charge 50). Approve/adjust.
2. **Unclaimed listing expiry** — v2 proposed `claimExpiresAt` = 72h; approve/adjust.
3. **Pending-review timeout policy** — v3 proposes: proof/review does NOT
   survive the 30-min active deadline (expires with room). Confirm, or allow
   a post-deadline review grace period (adds a second timer + accounting path).
4. **Rating window** — proposed 24h (`room_rating_window_hours`); approve/adjust.
5. **Active-room restriction scope** — rooms only (v1 challenges exempt), or
   extend to v1 `Challenge` claims (changes shipped behavior).
6. **Revenue reversal representation** — `reversedAt` on the ROOM_CHARGE row
   vs offsetting `ROOM_CHARGE_REVERSAL` entry; depends on whether revenue
   rows are treated as immutable.
7. **Friendship primitive** — ship View profile + Report only, or build
   `FriendRequest` now (new social graph).
8. Carried from v2: post-agreement refund table, no fee beyond room charge,
   90-day chat retention, `/rooms` navigation alongside v1, pair limit N=3/7d.
