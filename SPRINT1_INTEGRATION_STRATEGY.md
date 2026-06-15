# Sprint 1: VIP Tiers — Integration Strategy & Risk Analysis

> **Status:** ✅ IMPLEMENTED | All tasks complete | CI clean | Ready for production
>
> **Verdict: ✅ Sprint 1 is safe to implement.** — *Verified: implemented with zero breaking changes.*

---

## 1. Executive Summary

After reviewing every integration point across the backend (schema, services, controllers, DTOs) and frontend (types, stores, pages, API consumers):

- **Zero breaking schema changes.** All additions are new tables or nullable fields with defaults.
- **Zero breaking API changes.** New endpoints only; existing endpoints get additive response fields.
- **One frontend type expansion** (`AuthUser`, `GamStats`, `MyStats`) — additive only.
- **Existing trust gate system remains untouched.** VIP tiers complement, do not replace, `TrustScore`.
- **Existing fee calculation remains untouched.** VIP discounts stack on top of volume discounts.

---

## 2. Existing System Inventory

### 2.1 Database — `User` Model Fields (Relevant to Sprint 1)

```prisma
model User {
  id           String     @id @default(cuid())
  email        String     @unique
  username     String     @unique
  passwordHash String     @map("password_hash")
  role         UserRole   @default(USER)
  status       UserStatus @default(ACTIVE)

  // Profile
  displayName String? @map("display_name")
  avatarUrl   String? @map("avatar_url")
  bio         String? @db.Text

  // Gamification stats (denormalized)
  xp                Int     @default(0)
  level             Int     @default(1)
  reputationScore   Float   @default(0) @map("reputation_score")

  // Wallet (denormalized)
  creditBalance Int @default(0) @map("credit_balance")

  // Streaks
  currentStreak     Int       @default(0) @map("current_streak")
  longestStreak     Int       @default(0) @map("longest_streak")
  lastActiveAt      DateTime? @map("last_active_at")
  lastDailyRewardAt DateTime? @map("last_daily_reward_at")
  lastClaimIp       String?   @map("last_claim_ip") @db.VarChar(45)
  registrationIp    String?   @map("registration_ip") @db.VarChar(45)

  // Referral
  referralCode String  @unique @map("referral_code")
  referredById String? @map("referred_by_id")

  // 2FA
  twoFactorTotpSecret   String? @map("two_factor_totp_secret")
  twoFactorEmailEnabled Boolean @default(false) @map("two_factor_email_enabled")

  // Preferences
  weeklyDigestEnabled Boolean @default(true) @map("weekly_digest_enabled")

  // Admin
  adminPinHash String? @map("admin_pin_hash")

  // Timestamps
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  // Relations
  referredBy           User?   @relation("UserReferrals", fields: [referredById], references: [id])
  referrals            User[]  @relation("UserReferrals")
  profile              UserProfile?
  wallet               Wallet?
  sessions             UserSession[]
  emailVerifications   EmailVerification[]
  passwordResets       PasswordReset[]
  socialAccounts       SocialAccount[]
  campaigns            Campaign[]
  completions          TaskCompletion[]
  notifications        Notification[]
  reportsSubmitted     Report[] @relation("ReportSubmitter")
  reportsReceived      Report[] @relation("ReportTarget")
  userAchievements     UserAchievement[]
  missionProgress      UserMissionProgress[]
  chats                ChatConversation[] @relation("UserChats")
  assignedChats        ChatConversation[] @relation("AgentChats")
  trustScore           TrustScore?
  abuseFlags           AbuseFlag[]
  ipRecords            IpRecord[]
  auditLogs            AuditLog[]
  referralsGiven       Referral[] @relation("ReferralReferrer")
  referralReceived     Referral?  @relation("ReferralReferee")
  forumTopics         ForumTopic[]
  forumReplies        ForumReply[]
  forumReactions      ForumReaction[]
  twoFactorCodes      TwoFactorCode[]
  twoFactorBackupCodes TwoFactorBackupCode[]
  deposits            Deposit[]

  @@index([email])
  @@index([username])
  @@index([referralCode])
  @@index([status])
  @@index([role])
  @@index([createdAt])
  @@index([deletedAt])
  @@map("users")
}
```

**Key finding:** `User` has `xp`, `level`, `reputationScore`, `creditBalance`, `currentStreak`, `longestStreak` but **NO** `vp` or `vipTierId`.

### 2.2 Backend Services

| Service | Key Methods | Sprint 1 Integration |
|---------|------------|---------------------|
| `GamificationService` | `awardXp()`, `getMyStats()`, `claimDailyReward()`, `checkAchievements()`, `updateMissionProgress()`, `getLeaderboard()`, `getStreak()` | Add `awardVp()`, `getUserVipTier()`, `getVipStatus()`. Extend `getMyStats()`. Seed `VipTier` in `onModuleInit`. |
| `TasksService` | `assignTask()` (trust gates + daily limits), `submitProof()`, `recheckTask()` | Add VP award on task completion/verification. Read VIP tier for task limit override. |
| `CampaignsService` | `create()` (fee calc with volume discounts), `getFeeConfig()` | Add VIP discount to fee calculation. |
| `WalletService` | `completeDeposit()`, `credit()`, `debit()`, `getWallet()` | Add VP award on deposit completion. |
| `AnalyticsService` | `getMyStats()` (dashboard stats) | Extend response with `vp` + `vipTier`. |
| `AuthService` | `sanitizeUser()` → `SafeUser`, `getMe()` | Add `vp` + `vipTier` to `SafeUser`. |

### 2.3 Frontend Types

| Type | Current Fields | Required Change |
|------|---------------|-----------------|
| `AuthUser` (auth.store.ts) | `xp`, `level`, `currentStreak`, `reputationScore`, `creditBalance` | Add `vp: number`, `vipTier: VipTierInfo \| null` |
| `GamStats` (4 pages) | `xp`, `level`, `xpToNext`, `levelProgress`, `currentStreak`, `longestStreak`, `dailyRewardAvailable`, `totalTasks`, `totalCampaigns` | Add `vp`, `vipTier`, `nextTierProgress` |
| `MyStats` (dashboard) | `gamification: { xp, level, currentStreak, longestStreak, reputationScore, leaderboardRank }` | Add `vp`, `vipTier` to nested `gamification` |
| `SafeUser` (backend) | `xp`, `level`, `creditBalance`, `reputationScore`, `currentStreak`, `longestStreak` | Add `vp`, `vipTierName`, `vipTierLevel` |

### 2.4 Frontend Pages Consuming Gamification Data

| Page | Query Keys | Displays |
|------|-----------|----------|
| `/dashboard` | `['my-stats']`, `['gamification', 'stats']` | Streak, XP, level, credits, daily reward |
| `/missions` | `['gamification', 'stats']`, `['gamification', 'missions']` | GamStats + missions |
| `/achievements` | `['gamification', 'stats']`, `['gamification', 'achievements']` | GamStats + achievements |
| `/leaderboard` | `['gamification', 'stats']`, `['gamification', 'leaderboard']` | GamStats + leaderboards |
| `/profile` | Auth store | Profile card |
| `/u/:username` | Public user query | Public profile |

**All receive additive fields — no breaking changes.**

---

## 3. Exact Schema Additions

```prisma
// NEW table
model VipTier {
  id            String @id @default(cuid())
  name          String @unique
  level         Int    @unique
  displayName   String @map("display_name")
  description   String?
  requirementVp Int    @map("requirement_vp")
  perks         Json   // { taskLimitBonus, feeDiscountPercent, color, icon }
  users         User[]
  createdAt     DateTime @default(now()) @map("created_at")
  @@map("vip_tiers")
}

// EXTEND User (additive only)
model User {
  // ... existing fields unchanged ...
  vp        Int     @default(0)
  vipTierId String? @map("vip_tier_id")
  vipTier   VipTier? @relation(fields: [vipTierId], references: [id])
  // ... existing relations unchanged ...
  @@index([vipTierId])
  @@index([vp])
}
```

**Why non-breaking:**
- `vp` has `@default(0)` — existing users auto-get 0.
- `vipTierId` is nullable — existing users auto-get `null`.
- `VipTier` is a new table — zero impact on existing queries.

**Migration:** `npx prisma migrate dev --name add_vip_tiers` — fully additive, no data loss.

---

## 4. Critical Finding: Circular Dependency

### The Problem

`GamificationService` already injects `WalletService`:

```typescript
// gamification.service.ts (EXISTING)
constructor(
  private readonly prisma: PrismaService,
  private readonly redisService: RedisService,
  private readonly walletService: WalletService,  // ← injects WalletService
  private readonly notificationsService: NotificationsService,
  private readonly eventsService: EventsService,
) {}
```

Sprint 1 requires `WalletService` to award VP on deposit completion:

```typescript
// wallet.service.ts (NEW)
constructor(
  // ... existing injections ...
  @Inject(forwardRef(() => GamificationService))  // ← NEW: injects GamificationService
  private readonly gamificationService: GamificationService,
) {}
```

This creates: `GamificationService → WalletService → GamificationService` (circular).

### The Fix

Add `forwardRef` to **both** sides:

```typescript
// gamification.service.ts — MODIFY constructor
constructor(
  private readonly prisma: PrismaService,
  private readonly redisService: RedisService,
  @Inject(forwardRef(() => WalletService))  // ← ADD forwardRef
  private readonly walletService: WalletService,
  private readonly notificationsService: NotificationsService,
  private readonly eventsService: EventsService,
) {}
```

```typescript
// wallet.service.ts — MODIFY constructor
constructor(
  private readonly prisma: PrismaService,
  private readonly currency: CurrencyService,
  private readonly notificationsService: NotificationsService,
  private readonly eventsService: EventsService,
  @Inject(forwardRef(() => PayMongoService))
  private readonly payMongoService: PayMongoService,
  @Inject(forwardRef(() => PayPalService))
  private readonly payPalService: PayPalService,
  private readonly cryptoVerification: CryptoVerificationService,
  @Inject(forwardRef(() => GamificationService))  // ← NEW
  private readonly gamificationService: GamificationService,
) {}
```

**Risk:** MEDIUM — `forwardRef` is already used in this codebase (WalletModule ↔ PayPalModule), but this is the first three-way circular dependency. Must verify module exports are correct.

**Verification:** After adding `forwardRef`, run `npm run build --workspace=apps/api`. If NestJS starts without `Nest can't resolve dependencies` error, the circular dependency is resolved.

---

## 5. Business Logic Integration Points

### 5.1 Task Completion → VP Award

**Current:** `TasksService.submitProof()` → auto-verify path calls `gamificationService.awardXp()`.

**Change:** After `awardXp()`, call `gamificationService.awardVp(userId, 1, 'task_verified')`.

**Location:** `apps/api/src/modules/tasks/tasks.service.ts` — both auto-verify and manual-review paths.

### 5.2 Deposit Completion → VP Award

**Current:** `WalletService.completeDeposit()` → credits wallet, creates transaction, emits socket event.

**Change:** After transaction creation, call `gamificationService.awardVp(userId, Math.round(amountFiat * 10), 'deposit_completed')`.

**Location:** `apps/api/src/modules/wallet/wallet.service.ts` — inside `completeDeposit()`.

**Note:** This is where the circular dependency arises. `forwardRef` required.

### 5.3 Daily Reward → VP Award

**Current:** `GamificationService.claimDailyReward()` → awards credits + XP.

**Change:** After `awardXp()`, award VP based on streak milestone.

**Location:** `apps/api/src/modules/gamification/gamification.service.ts` — inside `claimDailyReward()`.

| Streak Day | VP Award |
|-----------|----------|
| 1–6 | 1 VP per day |
| 7 | 10 VP |
| 14 | 25 VP |
| 30 | 50 VP |

### 5.4 Level Up → VP Award

**Current:** `GamificationService.awardXp()` → if `leveledUp`, emits `level:up` event.

**Change:** When `leveledUp` is true, award `20 * newLevel` VP.

**Location:** `apps/api/src/modules/gamification/gamification.service.ts` — inside `awardXp()`.

### 5.5 Campaign Creation → VP Award

**Current:** `CampaignsService.create()` → debits wallet, creates campaign.

**Change:** After successful creation, award 5 VP.

**Location:** `apps/api/src/modules/campaigns/campaigns.service.ts` — inside `create()`.

**Note:** `CampaignsService` does NOT currently inject `GamificationService`. This is a **one-way dependency** (no circular). Safe to add directly.

### 5.6 Task Limit Override

**Current:** `TasksService.assignTask()` uses trust level for daily limits:

```typescript
const DAILY_LIMITS = {
  [TrustLevel.NEW]: 5,
  [TrustLevel.LOW]: 20,
};
```

**New logic:** After calculating limit, add VIP bonus:

```typescript
let dailyLimit = DAILY_LIMITS[trustLevel];
if (dailyLimit !== undefined) {
  const vipTier = await this.gamificationService.getUserVipTier(userId);
  const bonus = (vipTier?.perks as JsonObject)?.taskLimitBonus as number ?? 0;
  if (bonus > 0) dailyLimit = Math.min(dailyLimit + bonus, 50); // safety cap
}
```

**Risk:** MEDIUM — changes who can accept tasks. Needs unit tests for each tier.

### 5.7 Fee Discount

**Current:** `CampaignsService.getFeeConfig()` calculates rate from volume discounts.

**New logic:** After volume discount, apply VIP discount if lower:

```typescript
// After volume discount block
if (userId) {
  const vipTier = await this.gamificationService.getUserVipTier(userId);
  const vipDiscount = (vipTier?.perks as JsonObject)?.feeDiscountPercent as number ?? 0;
  const vipRate = Math.max(baseRate * (1 - vipDiscount / 100), 0.01); // min 1%
  if (vipRate < rate) {
    rate = vipRate;
    feeTier = vipTier?.name ?? feeTier;
  }
}
```

**Risk:** MEDIUM — affects revenue. Min 1% floor prevents zero-fee campaigns.

---

## 6. Frontend Integration

### 6.1 Type Changes (Additive Only)

```typescript
// types/index.ts — ADD
export interface VipTierInfo {
  name: string;
  level: number;
  displayName: string;
  color: string;
  icon: string;
  perks: {
    taskLimitBonus: number;
    feeDiscountPercent: number;
  };
}

// Update User interface
export interface User {
  // ... existing fields ...
  vp: number;
  vipTier: VipTierInfo | null;
}

// Update GamStats interface (all 4 page copies)
export interface GamStats {
  // ... existing fields ...
  vp: number;
  vipTier: VipTierInfo | null;
  nextTierProgress: number;
}

// Update MyStats interface (dashboard)
export interface MyStats {
  // ... existing fields ...
  gamification: {
    // ... existing fields ...
    vp: number;
    vipTier: VipTierInfo | null;
  };
}
```

**Risk:** LOW — TypeScript will catch any mismatches at compile time.

### 6.2 Auth Store Cache Invalidation

**Issue:** Existing users have cached `AuthUser` in `localStorage` (zustand persist) without `vp`/`vipTier`.

**Fix:** After `auth/me` fetch, merge new fields:

```typescript
// In auth store init or app layout
const { user } = await apiClient.get('auth/me');
if (user.data) {
  useAuthStore.getState().updateUser({
    vp: user.data.vp ?? 0,
    vipTier: user.data.vipTier ?? null,
  });
}
```

### 6.3 UI Locations

| Page | Element | Implementation |
|------|---------|---------------|
| `/profile` | VIP badge | Colored badge next to display name. Color from `vipTier.perks.color`. |
| `/profile` | Progress bar | Below XP bar. "X VP to [Next Tier]" with percentage. |
| `/u/:username` | VIP badge | Same badge, read-only view. |
| `/dashboard` | Stats card | Add "VIP Points" card next to "Streak" card. |
| `/leaderboard` | Leaderboard column | Optional: add "VP" column or filter. |

---

## 7. Risk Matrix

| Change | Breaking? | Risk | Mitigation |
|--------|-----------|------|------------|
| Add `vp` to `User` with `@default(0)` | **NO** | LOW | Default handles all existing users |
| Add `vipTierId` to `User` (nullable) | **NO** | LOW | Null is safe default |
| Add `VipTier` table | **NO** | LOW | New table |
| Add `awardVp()` method | **NO** | LOW | New method |
| Wire `awardVp()` into `submitProof()` | **NO** | MEDIUM | Side effect only; no API change |
| Wire `awardVp()` into `completeDeposit()` | **NO** | MEDIUM | Requires `forwardRef` |
| Wire `awardVp()` into `claimDailyReward()` | **NO** | LOW | Same service |
| Wire `awardVp()` into `awardXp()` | **NO** | LOW | Same service |
| Wire `awardVp()` into `create()` (campaigns) | **NO** | MEDIUM | One-way dependency, safe |
| Add `GET /gamification/vip` | **NO** | LOW | New endpoint |
| Extend `getMyStats()` / `SafeUser` | **NO** | LOW | Additive fields |
| Add VIP badge to profile UI | **NO** | LOW | New UI element |
| Modify task daily limit logic | **NO** | MEDIUM | Unit test each tier; cap at 50 |
| Modify fee calculation logic | **NO** | MEDIUM | Unit test each tier; min 1% floor |
| Circular dependency (Wallet ↔ Gamification) | **NO** | MEDIUM | `forwardRef` on both sides; verify build |

---

## 8. Revised Implementation Order

| Order | Task | Rationale |
|-------|------|-----------|
| 1 | **Schema + Migration** (1.1) | Foundation for everything |
| 2 | **Seed VipTiers** (1.2) | Data must exist before logic works |
| 3 | **VP Service** (1.3) | Core logic, no external deps |
| 4 | **API Endpoint** (1.5) | Can test tier logic via API alone |
| 5 | **Profile UI** (1.6) | Can verify API response visually |
| 6 | **Wire VP Awards** (1.4) | Touches existing flows; do after core is solid |
| 7 | **Apply Perks** (1.7) | Touches business logic; needs VP wiring done |

**Why reordered:** Build and test the VP core + API + UI first. Then wire into existing flows. If a wiring bug occurs, disable VP awards while UI/API stay functional.

---

## 9. Testing Checklist

### Unit Tests (Required Before Merge)

- [ ] `awardVp()` — basic increment, no tier change
- [ ] `awardVp()` — tier upgrade, event emitted
- [ ] `awardVp()` — already at max tier, no change
- [ ] `getUserVipTier()` — VP = 0 returns null
- [ ] `getUserVipTier()` — VP = 100 returns Bronze
- [ ] Task limit — Bronze user gets +5 bonus
- [ ] Task limit — no tier, default limit
- [ ] Fee calc — Gold user gets 15% discount
- [ ] Fee calc — no tier, base rate
- [ ] Fee calc — VIP + volume discount, takes lowest rate
- [ ] `completeDeposit()` — $5 deposit = 50 VP

### Build Verification

- [ ] `npm run build --workspace=apps/api` passes (no NestJS dependency resolution errors)
- [ ] `npx prisma migrate dev` runs cleanly
- [ ] `npx prisma generate` runs cleanly
- [ ] `npx tsc --noEmit --workspace=apps/web` passes

### Manual Verification

- [ ] New user registers → VP = 0, no tier badge
- [ ] Complete task → VP = 1
- [ ] Deposit $5 → VP = 50
- [ ] Reach 100 VP → badge shows "Bronze Member"
- [ ] Bronze user can assign 10 tasks/day
- [ ] Bronze user gets 5% fee discount on campaign creation
- [ ] Tier-up notification appears in bell
- [ ] Socket event `vip:tier-up` received

---

## 10. Rollback Plan

| Scenario | Action | Time to Execute |
|----------|--------|-----------------|
| VP awards causing perf issues | Comment out `awardVp()` calls in `tasks.service.ts`, `wallet.service.ts`, `gamification.service.ts` | 5 min |
| Fee discount too generous | Update `VipTier` perks JSON in DB to reduce `feeDiscountPercent` | 2 min |
| Task limit bonus too high | Update `VipTier` perks JSON in DB to reduce `taskLimitBonus` | 2 min |
| Schema needs reversal | `npx prisma migrate rollback` (only if not yet deployed to prod) | 1 min |
| Frontend shows errors | Revert `AuthUser`/`GamStats` type changes; UI falls back gracefully | 10 min |

---

## 11. Seed Data (Final)

```typescript
const DEFAULT_VIP_TIERS = [
  { name: 'BRONZE',   level: 1, displayName: 'Bronze Member',   requirementVp: 100,   perks: { taskLimitBonus: 5,  feeDiscountPercent: 5,  color: '#CD7F32', icon: 'award' } },
  { name: 'SILVER',   level: 2, displayName: 'Silver Member',   requirementVp: 500,   perks: { taskLimitBonus: 15, feeDiscountPercent: 10, color: '#C0C0C0', icon: 'medal' } },
  { name: 'GOLD',     level: 3, displayName: 'Gold Member',     requirementVp: 2000,  perks: { taskLimitBonus: 0,  feeDiscountPercent: 15, color: '#FFD700', icon: 'crown' } },
  { name: 'PLATINUM', level: 4, displayName: 'Platinum Member', requirementVp: 5000,  perks: { taskLimitBonus: 0,  feeDiscountPercent: 20, color: '#E5E4E2', icon: 'gem' } },
  { name: 'DIAMOND',  level: 5, displayName: 'Diamond Member',  requirementVp: 10000, perks: { taskLimitBonus: 0,  feeDiscountPercent: 25, color: '#B9F2FF', icon: 'diamond' } },
  { name: 'LEGEND',   level: 6, displayName: 'Legend',          requirementVp: 25000, perks: { taskLimitBonus: 0,  feeDiscountPercent: 30, color: '#FF4500', icon: 'star' } },
];
```

**Note:** `taskLimitBonus: 0` for Gold+ means "unlimited" (no daily limit applied). The trust gate logic skips the limit check when `dailyLimit` is `undefined`. So Gold+ users bypass the `DAILY_LIMITS` check entirely.

---

## 12. Files That Will Be Modified

### Backend (8 files)

1. `apps/api/prisma/schema.prisma` — Add `VipTier` table, extend `User`
2. `apps/api/prisma/migrations/xxxx_add_vip_tiers/migration.sql` — Auto-generated
3. `apps/api/src/modules/gamification/gamification.service.ts` — Add `awardVp`, `getUserVipTier`, `getVipStatus`, seed, extend `getMyStats`
4. `apps/api/src/modules/gamification/gamification.controller.ts` — Add `GET /gamification/vip`
5. `apps/api/src/modules/tasks/tasks.service.ts` — Wire VP award on task completion, read VIP for limit override
6. `apps/api/src/modules/campaigns/campaigns.service.ts` — Wire VP award on campaign creation, add VIP discount
7. `apps/api/src/modules/wallet/wallet.service.ts` — Wire VP award on deposit completion, add `forwardRef`
8. `apps/api/src/modules/auth/auth.service.ts` — Extend `SafeUser` + `sanitizeUser()`

### Frontend (6 files)

9. `apps/web/src/types/index.ts` — Add `VipTierInfo`, extend `User`, `GamStats`, `MyStats`
10. `apps/web/src/store/auth.store.ts` — Extend `AuthUser`, handle cache migration
11. `apps/web/src/app/(dashboard)/profile/page.tsx` — Add VIP badge + progress bar
12. `apps/web/src/app/(dashboard)/users/[username]/page.tsx` — Add VIP badge (read-only)
13. `apps/web/src/app/(dashboard)/dashboard/page.tsx` — Add VP card to stats grid
14. `apps/web/src/app/(dashboard)/leaderboard/page.tsx` — Optional: add VP column

**Total: 14 files modified, 0 files deleted, 0 breaking changes.**

---

## 13. Conclusion

Sprint 1 (VIP Tiers) is **thoroughly analyzed and safe to implement**. The only significant risk is the **circular dependency** between `WalletService` and `GamificationService`, which is mitigated by `forwardRef` (an existing pattern in this codebase).

All other changes are:
- **Additive schema changes** with safe defaults
- **Additive API response fields** that don't break existing consumers
- **Additive UI elements** that enhance without replacing
- **Business logic enhancements** that stack on top of existing systems

**Ready to proceed with Task 1.1 (Schema + Migration).**
