# Gamification Audit & Progressive Content Proposal

Status: **proposal - pending owner approval before any progression
economics change or new payout activation.** Audit performed against
`apps/api` @ `7d77940` (2026-11-20).

## 1. Current-state audit

### 1.1 Progression formula - NO CAP (confirmed)

```ts
getLevelFromXp  = floor(sqrt(xp / 100)) + 1   // gamification.service.ts:16
getXpForLevel   = (level-1)^2 * 100
```

- Level is unbounded. XP keeps accumulating forever.
- Every level-up pays `VP_REWARDS.LEVEL_UP_MULTIPLIER * level` = **20 ×
  level VP** - also unbounded, so VP inflation grows linearly with level
  while VIP tiers top out at LEGEND (25,000 VP).
- MILESTONE achievements only cover Level 5 and Level 10 - nothing
  acknowledges levels beyond that.

### 1.2 XP sources (authoritative)

| Source | XP | Handler |
|---|---|---|
| `task_completion` | 50 (+boost) | `processTaskCompletionOutcome` → `awardXp`, dedupe `(user, source, completionId)` |
| `daily_login` | 20 | `claimDailyReward`, dedupe per UTC date |
| `mission_complete` | per-mission `xpReward` | `updateMissionProgress`, dedupe `(mission, date)` + `mission_progress_events(sourceId)` |
| `achievement` | per-achievement `xpReward` | `unlockAchievement`, unique `(user, achievement)` |
| `level_up` | 0 (VP only) | inside `awardXp` when level increases |
| `campaign_create` | **30 defined, never awarded** | `XP_REWARDS.CAMPAIGN_CREATE` is dead - `campaigns.service` only calls `awardVp` |

### 1.3 Decorative content found (violates "no decorative missions")

`updateMissionProgress` is invoked from exactly **one** production call
site - the task-outcome processor, always with
`MissionType.COMPLETE_N_TASKS`. Therefore:

- `Daily Grind`, `Task Sprint` (COMPLETE_N_TASKS) - **functional**.
- `Credit Rush` (EARN_N_CREDITS) - **can never progress**.
- `Campaign Builder` (CREATE_CAMPAIGN) - **can never progress**.

MissionType enum has 7 values (`LOGIN_STREAK`, `REFER_USER`,
`CONNECT_SOCIAL`, `VISIT_DISCOVER` additionally) - all unwired.

### 1.4 Achievement check coverage

`checkAchievements` runs only inside task-outcome processing (plus
`checkStreakAchievements` on daily claim). Consequences:

- ENGAGEMENT/FINANCIAL/MILESTONE/CREATOR achievements evaluate on the
  user's next **task completion** - a user who only logs in, creates
  campaigns, or earns via other paths sees delayed unlocks. Not broken,
  but progress feels stale.
- DEDICATION streak achievements are handled immediately by
  `checkStreakAchievements` inside `claimDailyReward`.

### 1.5 Seed mechanism - `update: {}` confirmed

`seedAchievements`/`seedMissions` upsert by slug/name with
`update: {}` - **content edits in code never reach installed databases**
(`gamification.service.ts:179-198`). `seedVipTiers` is the only partial
exception (updates displayName/requirementVp/perks).

### 1.6 Infrastructure worth reusing (already correct)

- `missionPeriodTerm` - per-(mission, UTC day) frozen catalog; display,
  progress, and settlement all read it. Mid-period edits cannot change
  payouts; new missions can't join retroactively.
- `mission_progress_events` - `(mission, source_type, source_id)`
  dedupe; outcome recovery cannot double-count.
- Advisory-lock + per-mission transaction payout; reward outbox;
  `taskCompletionOutcome` durable settlement with per-effect flags.
- `ActivityRewardService.evaluateWeeklyGrant` - entitlement
  `(user, iso_week)`; compatible: new missions pay via existing
  `walletService.credit(EARN_MISSION_COMPLETE)` + `awardXp`, neither of
  which touches the weekly entitlement.
- Trust limits: `TrustScore` gates campaign creation (NEW can't create;
  LOW capped at 100cr budgets) - catalog requirements must not depend
  on trust-gated or deposit-gated actions.

## 2. Proposed level cap & progression table

**Proposal - requires owner approval before implementation.**

- `LEVEL_CAP = 100`. `getLevelFromXp` clamps: `min(floor(sqrt(xp/100))+1, 100)`.
  XP continues to accumulate past the cap (leaderboards/tiebreaks keep
  meaning); only the *level* saturates.
- Level-up VP bonus becomes `20 × min(level, LEVEL_CAP)` → max **2,000
  VP** per level-up (was unbounded).
- Rationale: level 100 needs 980,100 XP ≈ ~15–19k verified tasks at
  current rates - an aspirational multi-month ceiling, not a launch
  blocker; caps VP emission and gives MILESTONE achievements room.

| Level | XP required | Cumulative tasks* | Suggested recognition |
|---|---|---|---|
| 1 | 0 | 0 | onboarding tour |
| 5 | 1,600 | ~32 | Rising Star (exists) + feature tour |
| 10 | 8,100 | ~162 | Veteran (exists) + feature tour |
| 15 | 19,600 | ~392 | new MILESTONE achievement |
| 20 | 36,100 | ~722 | new MILESTONE achievement |
| 30 | 84,100 | ~1,682 | new MILESTONE achievement |
| 50 | 240,100 | ~4,802 | new MILESTONE achievement |
| 75 | 547,600 | ~10,952 | new MILESTONE achievement |
| 100 | 980,100 | ~19,602 | new MILESTONE achievement (cap) |

\* at ~50 XP/task ignoring missions/boosts - order-of-magnitude only.

## 3. Beginner-to-cap content catalog (prepared, NOT enabled)

Stable IDs = slug (new `slug` unique column proposed); every objective
maps to a **functioning authoritative handler**. Rewards deliberately
modest. All credit rewards are **new credit issuance** - see §5 before
activating (`isActive` stays false until owner approves the supply
summary).

### 3.1 Daily missions - COMPLETE_N_TASKS only (handler exists today)

| slug | name | req | cr | xp | notes |
|---|---|---|---|---|---|
| `mission-first-task` | First Task | 1 | 15 | 25 | easier on-ramp vs Daily Grind (20/30) |
| `mission-task-5` | Five Tasks | 5 | 80 | 120 | extends Task Sprint ladder |
| `mission-task-10` | Ten Tasks | 10 | 150 | 200 | ambitious daily ceiling |

Handler: task-outcome `missionSettled` effect → snapshot + period terms.
Repeatable daily via `(userId, missionId, date)` progress rows. No new
code needed.

### 3.2 Missions requiring NEW handler wiring (Phase 2 - do not seed yet)

| type | proposed call site | dedupe sourceId |
|---|---|---|
| `LOGIN_STREAK` | `claimDailyReward` (newStreak known) | `daily_login:{date}` |
| `CREATE_CAMPAIGN` | `campaigns.service.create` success | `campaign:{id}` |
| `CONNECT_SOCIAL` | `linkVerifiedAccount` / `manualLink` success | `{platform}:{platformUserId}` |
| `REFER_USER` | `referralsService.checkMilestones` | referral id |
| `EARN_N_CREDITS` | **deferred** - needs amount-aware variant + semantics (does mission payout count? loops?) | - |
| `VISIT_DISCOVER` | analytics pipeline - lowest value, defer | - |

Each wiring is a small additive call to `updateMissionProgress` with a
stable `sourceId`; until wired, **no mission of that type may be seeded**.

### 3.3 Achievements - all categories have live handlers

| slug | name | category | req | cr | xp |
|---|---|---|---|---|---|
| `level-15` | Rising Veteran | MILESTONE | level 15 | 300 | 0 |
| `level-20` | Dedicated | MILESTONE | level 20 | 400 | 0 |
| `level-30` | Centurion Path | MILESTONE | level 30 | 600 | 0 |
| `level-50` | Halfway Hero | MILESTONE | level 50 | 1,000 | 0 |
| `level-75` | Elite | MILESTONE | level 75 | 1,500 | 0 |
| `level-100` | Engganyo Legend | MILESTONE | level 100 (cap) | 3,000 | 0 |
| `tasks-250` | Task Centurion | ENGAGEMENT | 250 completions | 750 | 250 |
| `tasks-500` | Task Legend | ENGAGEMENT | 500 completions | 1,500 | 500 |
| `earn-50k` | Credit Baron | FINANCIAL | 50,000 lifetime | 1,000 | 300 |

Handler: `checkAchievements` (runs on task outcomes; MILESTONE entries
also benefit from being evaluated on level-up - see §4 fix).

### 3.4 Explicitly excluded

- Anything requiring deposits, trust-gated campaign budgets, disabled
  platforms (TikTok/IG manual-proof supply is unreliable), or
  EARN_N_CREDITS semantics.
- No decorative entries: catalog ships only types with wired handlers.

## 4. Required code changes (implementation PR, after approval)

1. `LEVEL_CAP` const + clamp in `getLevelFromXp` callers (single source:
   export `getEffectiveLevel(xp)`; keep raw XP for leaderboards) +
   `min(level, CAP)` in the level-up VP bonus.
2. `checkAchievements` invocation on level-up inside `awardXp` (today a
   level-up only notifies; MILESTONE achievements wait for the next
   task outcome - with cap-100 achievements this matters).
3. Optional Phase-2 mission wiring per §3.2.
4. Award the dead `XP_REWARDS.CAMPAIGN_CREATE` or remove the constant.

## 5. Versioned, repeatable seeding with dry-run diff

Proposal:

- Add `slug` (unique) + `seed_version INT` to `achievements` and
  `daily_missions`; catalog moves to a versioned `CONTENT_SEED_VERSION`
  constant per domain.
- Upsert by `slug`: `create` full row; `update` applies **only**
  seed-managed fields (name, description, requirement, rewards,
  sortOrder, category/type) **when `seed_version` increases** - `isActive` stays admin-controlled after first seed (documented:
  seeding never re-enables admin-disabled content).
- `SEED_DRY_RUN=1` env (or `--dry-run` script arg): computes creates /
  updates / no-ops per slug and logs a diff table; writes nothing.
- Repeat seeding is idempotent: same version → zero writes.
- Preserves: `user_achievements`, `user_mission_progress`,
  `mission_progress_events`, `mission_period_terms`,
  `task_completion_outcomes.reward_snapshot`, wallets/ledger - none are
  touched by content seeds (progress keys are row IDs, not slugs;
  renaming a mission keeps its ID).

## 6. Economy / supply summary (for payout approval)

New-credit issuance per fully-active user per day (worst case, all
missions complete):

| Source | Max/day |
|---|---|
| 3 new missions (15+80+150) | 245 cr |
| Existing 4 missions | 200 cr |
| Daily login credits | ~20–50 cr (existing) |
| **New catalog total** | **≤ 245 cr/day/user** |

Weekly bounded: ≤ 1,715 cr/user from missions. Compare: a single
verified task typically pays its campaign budget share (tens–hundreds
of credits); the catalog adds <5% marginal emission for engaged users
and ~0 for casual ones. XP emission: ≤ ~345 XP/day from missions - ~7 task-equivalents, negligible vs level curve.

Achievement one-time payouts: ~8.7k cr + ~1.6k XP total across the
whole catalog per user - bounded, one-time.

**Recommendation:** seed content `isActive=false` (or behind
`GAMIFICATION_CATALOG_V2` flag) until owner approves this summary;
existing missions stay live unchanged.

## 7. Test plan (CI, real PostgreSQL)

- Repeat seeding: same version → no writes; version bump → content
  fields update, `isActive` preserved, progress/terms/snapshots intact.
- Dry-run: zero writes, diff output correct.
- Level cap: XP beyond cap → level stays 100, VP bonus capped at 2,000,
  XP still recorded; leaderboard ordering unaffected.
- Boundary: exact cap-crossing XP → single level-up event.
- Duplicate/concurrent events: existing `mission_progress_events` +
  advisory-lock specs extended to new missions.
- Delayed processing: outcome recovery pays frozen snapshot terms.
- UTC periods: mission progress attributes to verifiedAt's UTC day.
- Weekly grant compatibility: mission/achievement XP+credits do not
  create `activity_reward_entitlements` rows.
- Handler coverage guard test: every seeded mission's `type` has a
  registered production call site (static check over call graph or
  explicit registry) - prevents future decorative seeds.

## 8. Open decisions for owner

1. Approve `LEVEL_CAP = 100` and capped level-up VP (economics change).
2. Approve catalog contents/rewards, or adjust amounts.
3. Activate immediately (`isActive=true`) or behind flag pending
   economy review.
4. Phase-2 mission types: wire LOGIN_STREAK/CREATE_CAMPAIGN/
   CONNECT_SOCIAL/REFER_USER now, or keep COMPLETE_N_TASKS-only.
5. EARN_N_CREDITS semantics (which credit sources count; exclude
   mission/payout recursion?) - needs a decision before any wiring.
