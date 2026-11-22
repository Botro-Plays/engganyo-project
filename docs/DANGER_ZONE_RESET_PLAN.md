# Danger Zone - Production Reset Replacement Plan

**Status: AUDIT & PLAN ONLY - nothing in this document has been executed.**
The existing `POST /admin/system/reset` endpoint remains **unavailable for launch use**
until the replacement designed here is reviewed and implemented. This phase
authorizes audit and planning only; no production cleanup or reset was performed.

---

## 1. Why the current reset is unsafe

`AdminService.resetDatabase` (`apps/api/src/modules/admin/admin.service.ts`) has
five disqualifying defects:

1. **Username-based preservation.** Owner accounts are selected by
   `username IN ('admin','botro')`. Usernames are mutable and unverified as
   identity - a renamed account loses preservation, and a squatted username
   gains it. Preservation must key on immutable user IDs.
2. **Incomplete table coverage.** The delete list predates rooms/P2P,
   marketplace, inventory, social reservations, rewards outbox, tours, channels,
   and visitor analytics. Newer tables are silently skipped - and several carry
   `RESTRICT` foreign keys to `users`, so the reset now likely **fails
   mid-transaction** (safe failure, but the tool is broken) or, worse, leaves
   orphaned financial/room state behind.
3. **No dry-run.** The only preview is the literal token `RESET` - there is no
   row-count manifest, dependency validation, or reviewed-plan binding.
4. **No operational guardrails.** No maintenance mode, no worker/webhook pause,
   no verified backup, no Redis/session/upload scoping, no post-reset
   reconciliation.
5. **Reset economics are implicit.** Owner wallets are rewritten to
   `initial_credits` with a synthetic `EARN_ADMIN_GRANT` transaction, but VP,
   VIP, inventory, effects, achievements, streaks, and social links have no
   declared policy.

---

## 2. Inventory - every resource and its dependency class

Schema models (70) grouped by subsystem. FK direction noted where it drives
ordering.

### 2.1 Identity & access
| Model | Notes |
|---|---|
| `User` | Root entity. `creditBalance`, `xp`, `level`, streaks denormalized here. |
| `UserProfile` | 1:1 profile data. |
| `UserSession` | Auth sessions - cascades on user delete. |
| `EmailVerification`, `PasswordReset` | Auth flows. |
| `TwoFactorCode`, `TwoFactorBackupCode` | 2FA state. |
| `OAuthConfig` | Platform-level OAuth app config (seeded secrets). |
| `SocialAccount` | Linked identities; verified rows are exclusive (partial unique index). |
| `SocialIdentityReservation` | 24h handoff reservations; **no user FK by design** - survives user deletion. |
| `TourCompletion` | Milestone tour state per user/version. |
| `DeviceFingerprint`, `IpRecord` | Abuse/rate-limit signals. |

### 2.2 Money
| Model | Notes |
|---|---|
| `Wallet` | Per-user balance ledger root (optimistic `version`). |
| `Transaction` | Append-only ledger entries; references `walletId`. |
| `Deposit`, `DepositPackage` | Payment intents; packages are seeded config. |
| `PlatformRevenue` | Fee revenue per campaign settlement. |
| `WalletChallenge` | Wallet-funded challenges. |
| `VisitorEvent`, `VisitorVisit`, `AnalyticsDailyVisit`, `AnalyticsSnapshot` | Traffic analytics (public + authed). |

### 2.3 Tasks, campaigns, rewards
| Model | Notes |
|---|---|
| `Campaign` | Task campaigns; holds budget/slots. |
| `TaskCompletion`, `TaskCompletionOutcome` | Completion records + settlement outcomes. |
| `Challenge` | Challenge tasks. |
| `Referral` | Referral graph + rewards. |
| `Achievement`, `UserAchievement` | Catalog (seeded) + earned rows. |
| `DailyMission`, `UserMissionProgress` | Daily missions + progress. |
| `XpEvent` | XP ledger. |
| `RewardOutboxEvent` | Async reward delivery queue - **must be drained/paused, not silently dropped**. |
| `RewardEntitlement` | Granted-but-unclaimed rewards. |
| `ActivityRewardEntitlement` | Weekly earned-item grants. |
| `MissionPeriodCatalog`, `MissionPeriodTerm`, `MissionProgressEvent` | Frozen mission-period terms - **must be preserved or archived, never rewritten**. |
| `VpEvent`, `VipTier`, `TrustScore` | Reputation/economy state. |
| `AbuseFlag` | Moderation flags. |
| `Report` | User reports (FKs to users/campaigns/forum). |
| `AuditLog` | Admin action trail - **retain/archive, never clear**. |
| `PlatformConfig` | Seeded runtime config (fees, limits, tour interval). |
| `Notification` | Per-user notifications. |

### 2.4 Store, inventory, marketplace
| Model | Notes |
|---|---|
| `StoreItem` | Catalog (seeded). |
| `UserInventory` | Owned stacks (bound/tradable provenance). |
| `InventoryMovement` | Append-only inventory ledger. |
| `StorePurchase` | Purchase records. |
| `UserActiveEffect` | Active boosts/consumable effects. |
| `MarketplaceListing`, `MarketplaceOrder` | P2P player-item listings + escrow orders; **financial state - retain/archive or settle first**. |
| `WheelSpin`, `WheelSpinAttempt`, `WheelDailyAllowance` | Spin wheel state. |
| `DailyRewardLog` | Daily login reward history. |

### 2.5 Rooms / P2P
| Model | Notes |
|---|---|
| `ChallengeRoom` | Mutual-room sessions with deadlines. |
| `RoomOffer`, `RoomSubmission`, `RoomParticipation` | Offers, proofs, membership. |
| `RoomNudge`, `RoomRating`, `RoomDispute` | Interaction + dispute records. |
| `P2pPointEvent` | P2P points ledger. |
| `Friendship` | Friend graph. |

### 2.6 Chat & forum
| Model | Notes |
|---|---|
| `ChatConversation`, `ChatMessage` | Legacy/direct chat. |
| `Channel`, `ChannelMember`, `ChannelMessage`, `ChannelMessageMention` | Community channels. |
| `ForumTopic`, `ForumReply`, `ForumReaction` | Forum content. |

### 2.7 Non-DB resources
| Resource | Scope |
|---|---|
| **Redis** | Sessions cache, rate-limit counters, socket/pub-sub state, outbox locks. Flush only keys under the app's key prefixes; never `FLUSHALL`. |
| **Uploads** | Proof images, avatars, listing media on disk/S3. Must be enumerated and deleted by manifest, not by directory wipe. |
| **Background jobs** | Reward outbox worker, weekly digest emailer, mission-period settlement, socket reconnect state. Pause before reset; drain or checkpoint after. |
| **Webhooks** | PayMongo/PayPal/crypto callbacks - pause ingress during reset; replay or explicitly void in-flight payments per §6. |
| **reCAPTCHA** | No interaction - keys stay configured; never mint tokens. |

---

## 3. Reset manifest - classification per resource

Legend: **PRESERVE** (untouched) · **CLEAR** (delete all rows) · **RESEED**
(delete + re-run idempotent seed) · **ARCHIVE** (export to cold storage, then
clear) · **OWNER-SCOPED** (handled per preserved-owner policy in §4).

### PRESERVE
- `OAuthConfig` - platform app credentials.
- `DepositPackage` - payment package catalog.
- `StoreItem`, `Achievement`, `DailyMission` - **catalogs**: reseed path only
  if definitions change; normally PRESERVE.
- `MissionPeriodCatalog`, `MissionPeriodTerm` - frozen commercial terms;
  archive historical periods, never edit.
- `AuditLog` - append-only; **ARCHIVE** older entries, retain recent + all
  reset-related entries.
- `PlatformConfig` - runtime config.
- `VipTier` - tier definition thresholds.

### CLEAR (test/ephemeral data)
- `UserSession`, `EmailVerification`, `PasswordReset`, `TwoFactorCode`,
  `TwoFactorBackupCode`, `Notification`, `DeviceFingerprint`, `IpRecord`
- `ChatConversation`, `ChatMessage`, `ChannelMember`, `ChannelMessage`,
  `ChannelMessageMention`, `ForumTopic`, `ForumReply`, `ForumReaction`
- `Report`, `AbuseFlag`
- `AnalyticsSnapshot`, `VisitorEvent`, `VisitorVisit`, `AnalyticsDailyVisit`
- `XpEvent`, `DailyRewardLog`, `WheelSpin`, `WheelSpinAttempt`,
  `WheelDailyAllowance`, `UserMissionProgress`, `MissionProgressEvent`,
  `UserAchievement`, `P2pPointEvent`, `TrustScore`, `Referral`
- `RewardOutboxEvent` - only after worker pause + drain decision (§6).
- `RewardEntitlement`, `ActivityRewardEntitlement` - unclaimed grants:
  **decision required** (§7-D3) - default ARCHIVE references then CLEAR.
- Redis session/rate-limit/socket keys under app prefixes.
- Uploads belonging to cleared entities (proof images, listing media).

### RESEED
- Channels/community structure if launch requires a clean canonical set.
- `initial_credits` and launch `PlatformConfig` values reviewed at reset time.

### OWNER-SCOPED (preserved accounts, §4)
Everything else for preserved users: `User`, `UserProfile`, `Wallet`,
`Transaction`, `SocialAccount`, `SocialIdentityReservation`, `UserInventory`,
`InventoryMovement`, `StorePurchase`, `UserActiveEffect`, `TourCompletion`,
`MarketplaceListing`, `MarketplaceOrder`, `ChallengeRoom` + room children,
`Friendship`, `Campaign`, `TaskCompletion`, `Challenge`, `Deposit`,
`PlatformRevenue`, `WalletChallenge`, `VpEvent`, `VipTier` assignments,
`DailyMission` progress - each classified per-owner as PRESERVE /
RESET-TO-LAUNCH / CLEAR by the reviewed plan.

### ARCHIVE (retain before clear)
- `AuditLog` (full export).
- `Transaction` + `Deposit` + `PlatformRevenue` + `MarketplaceOrder` - **any row touching real money MUST be archived, never deleted.** If real
  payments exist, targeted cleanup is the only safe path (§5).
- `MissionPeriodTerm` history.
- `Report`, `AbuseFlag` (moderation history).
- `SocialIdentityReservation` - survives user deletion by design; archive
  before any mass clear so cooldown evidence isn't lost.

---

## 4. Preserved owner accounts - immutable identity

Replace username matching with an explicit allowlist:

```ts
// platform_config key: launch_reset_owner_ids - set ONLY via reviewed plan
const OWNER_USER_IDS: string[] = [...]; // immutable CUIDs, never usernames
```

For each preserved account the reviewed plan must declare:

| Aspect | Policy (proposed default) |
|---|---|
| Credentials / password hash | **PRESERVE** - owner keeps login; no reset. |
| 2FA (TOTP + backup codes) | **PRESERVE** - required for admin surfaces. |
| Sessions | CLEAR then owner re-logs in (forces fresh sessions post-reset). |
| `creditBalance` / `Wallet.balance` | Reset to launch `initial_credits` with a single opening `Transaction` (`EARN_ADMIN_GRANT`, `balanceBefore: 0`). |
| `lifetimeEarned` / `lifetimeSpent` | Reset to match opening balance (fresh-launch accounting). |
| XP / level / streaks | **Decision D2** - proposed: reset to level 1 (clean progression for launch), preserving `UserAchievement` as earned-history or clearing per D2. |
| VP / VIP tier | **Decision D2** - proposed: reset VP to 0, VIP to base tier. |
| Inventory / active effects | **Decision D3** - proposed: CLEAR + grant launch starter pack via normal grant path. |
| Social accounts | **Decision D4** - proposed: PRESERVE verified links (owner convenience); reservations preserved. |
| `TourCompletion` | CLEAR - owner sees milestone tours fresh (validates the feature). |
| Notifications | CLEAR, then re-seed welcome notification. |
| Onboarding/profile fields | PRESERVE profile content; reset `lastActiveAt`, `lastDailyRewardAt`. |

---

## 5. Targeted cleanup vs. fresh launch database

| Criterion | Targeted cleanup (recommended if ANY real payment/financial record exists) | Fresh launch DB |
|---|---|---|
| Real payments (`Deposit`, `Transaction`, `MarketplaceOrder` with settled funds) | **Required** - archive + retain; delete only clearly synthetic rows by ID manifest | Loses financial records unless migrated - **not acceptable once real money moves** |
| Audit/moderation history | Retained | Lost unless exported |
| Social reservations | Must survive (24h handoff evidence) | Lost - could allow identity double-claim |
| Effort/risk | Higher - manifest-driven, dependency-ordered deletes | Lower technically, higher evidentiary cost |
| Rollback | Restore from pre-reset backup | Rebuild from seed + replay archive |

**Rule: the moment any real-money record exists, targeted cleanup is the only
compliant path.** A fresh database is acceptable only pre-launch with zero
settled payments - and even then the archive-first rule applies.

**Never classify data as disposable by username resemblance.** Every cleared
row must be enumerated by immutable ID in the reviewed manifest; "looks like a
test account" is not a criterion.

---

## 6. Proposed mechanism - `launch-reset` job (design, not built)

A dedicated admin-only, plan-bound operation - **not** an extension of the
current endpoint:

1. **Reset plan artifact.** A versioned, reviewed manifest (JSON/YAML in repo
   or admin UI draft) listing: owner IDs, per-table action
   (preserve/clear/reseed/archive), expected row counts, and a plan hash.
2. **Dry-run.** `POST /admin/system/reset/plan` returns per-table counts,
   dependency-validation results (orphans, RESTRICT blockers), owner-account
   verification, and the plan hash - **zero writes**.
3. **Verified backup.** `pg_dump` (custom format) + uploads archive + Redis
   key export, checksum recorded; **restore rehearsal on a scratch database
   must pass before the plan can be confirmed**.
4. **Maintenance mode.** Web serves a maintenance page; workers (reward
   outbox, digest emailer, mission settlement) paused; webhook ingress
   paused at nginx/provider level; in-flight payment intents voided or
   explicitly carried per plan.
5. **Explicit environment identification.** The job refuses to run unless
   `DATABASE_URL` host+name match a configured allowlist entry
   (`engganyo_prod` on the VPS) AND `APP_ENV=production` is asserted - a
   confirmation token alone is insufficient.
6. **Short-lived confirmation.** `confirmToken` = HMAC(planHash, serverSecret,
   15-minute expiry). A changed plan invalidates prior confirmations.
7. **Execution.** Single transaction where feasible; otherwise ordered
   per-FK steps with a checkpoint table. Idempotent - re-running a completed
   plan is a no-op.
8. **Scoped cleanup.** Redis flush limited to app key prefixes; uploads
   deleted only for IDs in the manifest; sessions cleared for all users
   (owners re-login).
9. **Idempotent reseed.** Catalog seeds run with content-version checks
   (the `update: {}` upsert gap must be fixed first - see gamification audit);
   reconciliation queries verify counts match the plan.
10. **Post-reset reconciliation.** Automated checks: owner balances ==
    opening entries, zero orphaned FKs (`pg_constraint` scan), reservation
    table intact, outbox drained, webhook queue empty.
11. **Protected audit record.** Immutable `AuditLog` entry + signed plan
    artifact stored outside the DB (the DB may be reseeded).
12. **Rollback.** Documented restore procedure: stop services → restore dump
    → restore uploads → reseed → restart; rehearsal evidence attached to the
    plan before confirmation is possible.

### Schema-coverage check
A CI test enumerates every Prisma model and asserts each appears in the reset
manifest with a classification. Any new migration adding a model **fails CI**
until the manifest classifies it - preventing silent escape.

### Restore-rehearsal acceptance criteria
Before any reset plan can be confirmed, the rehearsal on a scratch database
must demonstrate **all** of the following, with evidence attached to the plan:

1. `pg_dump` taken in maintenance mode completes and verifies
   (`pg_restore --list` parses; checksum recorded).
2. Restore into a scratch DB succeeds; row counts per preserved table match
   the manifest's expected counts exactly.
3. Post-restore reconciliation queries pass: owner balances equal opening
   ledger entries, zero orphaned foreign keys, `social_identity_reservations`
   intact, reward outbox drainable, webhook queue empty.
4. The reseed step is idempotent - running it twice produces identical state.
5. Timed end-to-end: dump → restore → verify completes within the agreed
   maintenance window, with the measured duration recorded.
6. Rollback path exercised at least once: restore the dump over the scratch
   DB a second time and re-verify.

---

## 7. Open decisions (require owner sign-off before implementation)

- **D1 - Approach:** targeted cleanup (default if real payments exist) vs.
  fresh launch DB (only viable pre-revenue).
- **D2 - Owner progression:** reset XP/level/VP/VIP to launch state, or
  preserve? (Proposed: reset, for a level playing field.)
- **D3 - Owner inventory:** clear + starter grant, or preserve?
- **D4 - Owner social links:** preserve verified identities or unlink?
- **D5 - Unclaimed rewards** (`RewardEntitlement`,
  `ActivityRewardEntitlement`): honor, archive-and-clear, or expire?
- **D6 - Real-money in-flight payments** at reset time: void vs. carry.
- **D7 - Archived data retention period** and storage location.
- **D8 - Who may execute:** propose SUPER_ADMIN + second-admin approval
  (four-eyes) for production.

### Recommended defaults (for owner review - nothing executes without sign-off)

| Decision | Recommended default | Real-payment / retention impact |
|---|---|---|
| D1 approach | **Targeted cleanup** if any real payment, payout, or financial record exists; fresh launch DB only pre-revenue | Fresh DB destroys payment/ledger evidence - unacceptable once real money moved |
| D2 owner progression | Reset XP/level/VP/VIP to launch state | None - progression is not a financial record |
| D3 owner inventory | Clear + grant launch starter pack via the normal grant path | None if grants go through the audited ledger path |
| D4 owner social links | Preserve verified identities; reservations preserved | Preserves the 24h-cooldown audit trail |
| D5 unclaimed rewards | Honor already-earned entitlements where feasible; archive-and-clear the rest with a recorded reason | Unclaimed balances are user-facing value - prefer honor over silent clear |
| D6 in-flight payments | Void pending intents; completed payments are preserved records, never cleared | Completed payments MUST be retained - they are financial records |
| D7 archive retention | Retain archived tables ≥ 90 days in a separate schema/backup before any purge | Retention window is a legal/compliance call - owner decides |
| D8 execution | SUPER_ADMIN + second-admin approval (four-eyes) | Prevents single-actor production wipes |

---

## 8. Current-state safety

- `POST /admin/system/reset` is now **effectively disabled**: it requires
  `DANGER_RESET_ENABLED=true` (unset in production → `ForbiddenException`),
  shipped in PR #106. The env flag stays off; re-enabling it is a deliberate
  ops action, not a code path.
- The replacement `launch-reset` mechanism (§6) remains **design-only** - no implementation exists yet, and execution stays separately gated on the
  D1–D8 decisions above plus restore-rehearsal evidence.
- No cleanup, reset, or production data modification was performed in this
  audit.

*Prepared from `schema.prisma` (70 models), `admin.service.ts:1833`,
workflow/deploy configuration, and subsystem audits. Inventory must be
re-verified against the schema at implementation time - the CI coverage
check in §6 exists precisely because this list drifts.*