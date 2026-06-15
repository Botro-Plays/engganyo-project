# Engganyo Gamification Master Plan

> **Status:** Sprint 1 Implemented | VIP Tiers + VP Tracking live | Sprints 2–7 pending
>
> **Goal:** Transform the platform from a "task marketplace" into a "daily destination" — something users check every morning even when no campaigns are available.

---

## 1. The Problem

Right now users come to Engganyo for one reason: **to find and complete tasks**. When the task marketplace is thin (new platform, few campaigns), users have nothing to do. They leave. They don't come back until they remember to check for new tasks.

**We need a "second reason to log in"** — activities that are always available, rewarding, and habit-forming.

---

## 2. What's Already Built (Inventory)

| System | Status | Notes |
|--------|--------|-------|
| XP + Levels | ✅ | Users gain XP from tasks, level up unlocks nothing yet |
| Daily Reward | ✅ | Claim once per day, streak multiplier |
| Login Streak | ✅ | Tracked (current / longest), broken if missed |
| Achievements | ✅ | 14 seeded, static list, one-time unlock |
| Daily Missions | ✅ | 4 seeded, reset daily, progress tracked |
| Leaderboards | ✅ | XP, achievements, missions — weekly + all-time |
| Trust Score / Gates | ✅ | Affects task limits, campaign creation |
| Notifications | ✅ | Real-time socket events for all major actions |
| Deposit System | ✅ | Buy credits with real money |
| Platform Fees | ✅ | 10% fee on campaign creation |
| **VIP Tiers** | **✅ Sprint 1** | **6 tiers (Bronze→Legend), VP tracking, tier perks** |
| **VP (VIP Points)** | **✅ Sprint 1** | **Earned from tasks, deposits, daily login, campaigns, level-ups** |

**Missing:** Credit sinks (store), social competition, time-limited events, referral rewards, collections.

---

## 3. Guiding Principles

1. **Effort = Reward** — No free lunch. Even small actions should feel earned.
2. **Always Something to Do** — When tasks are scarce, gamification fills the gap.
3. **Social Proof** — Leaderboards, profiles, guilds make progress visible and meaningful.
4. **Credit Sink = Platform Health** — Credits must leave the economy (store, fees, boosts) or inflation kills motivation to earn.
5. **F2P Friendly, P2W Optional** — Free users can earn everything through effort. Paying users get convenience, cosmetics, and time savings.
6. **Anti-Abuse First** — Any reward system will be farmed. Design with abuse detection from day one.

---

## 4. System Architecture

### 4.1 The Daily Loop ("Always Something to Do")

**The 60-Second Morning Ritual:**

```
Login → Claim Daily Reward → Check Missions → Spin the Wheel
      → Browse Store (limited daily offers) → Check Guild Progress
      → See Event Timer → Decide: Do Tasks or Play Mini-Game
```

#### 4.1.1 Daily Reward 2.0 (Upgrade)

| Streak | Base Credits | XP Bonus | Special |
|--------|-------------|----------|---------|
| Day 1 | 10 | +0% | — |
| Day 2 | 12 | +5% | — |
| Day 3 | 15 | +10% | — |
| Day 5 | 20 | +15% | Common Loot Box |
| Day 7 | 30 | +20% | Rare Loot Box |
| Day 14 | 50 | +30% | Epic Loot Box + Profile Badge (temporary) |
| Day 30 | 100 | +50% | Legendary Loot Box + Permanent Badge |

- **Miss a day:** Streak resets to 0 (harsh but effective for retention).
- **Streak freeze item:** Bought from store for 50 credits. One use = preserves streak if missed.
- **Milestone badges:** Permanent profile badges at 7, 30, 100, 365 days.

#### 4.1.2 Daily Missions 2.0 (Expansion)

Current missions are static (complete 3 tasks, etc). Expand to:

| Category | Example | Reward |
|----------|---------|--------|
| Task Missions | Complete 5 YouTube tasks today | 25 credits + 50 XP |
| Social Missions | Follow 3 creators | 15 credits + 30 XP |
| Creator Missions | Create 1 campaign with ≥50 credits budget | 40 credits + 60 XP |
| Engagement Missions | Reply to 2 forum topics | 10 credits + 20 XP |
| Streak Missions | Maintain 3-day streak | 20 credits + 40 XP |
| Random Missions | "Surprise Mission: Verify 1 email" (one-time for inactive users) | 50 credits |

- **Mission reroll:** First reroll free daily, subsequent cost 10 credits.
- **Mission difficulty scaling:** Higher-level users get harder missions with better rewards.

#### 4.1.3 Spin the Wheel (New)

**Cost:** Free once per day. Additional spins: 20 credits each.

| Prize | Weight | Description |
|-------|--------|-------------|
| 5 Credits | 30% | Small credit drop |
| 10 Credits | 20% | Medium credit drop |
| 25 Credits | 10% | Large credit drop |
| XP Boost (1h) | 10% | +50% XP for 1 hour |
| Credit Boost (1h) | 8% | +25% credits from tasks for 1 hour |
| Common Loot Box | 7% | Cosmetic item or small credit pack |
| Rare Loot Box | 3% | Better cosmetic or medium credit pack |
| Streak Freeze | 1.5% | Save your streak |
| 100 Credits | 0.5% | Jackpot |

- **Wheel visual:** Branded Engganyo wheel with satisfying animation.
- **Abuse guard:** Spins tracked per user per day. Max 10 paid spins/day.

#### 4.1.4 Loot Boxes (New)

**Types:** Common, Rare, Epic, Legendary

| Type | Contents | Source |
|------|----------|--------|
| Common | Profile frames, small credit packs (5–15), XP tokens | Daily reward, missions, wheel |
| Rare | Animated profile frames, medium credit packs (20–50), name colors | Streak milestones, events |
| Epic | Exclusive badges, large credit packs (50–100), boost bundles | 7-day streak, competitions |
| Legendary | Unique titles, huge credit packs (200–500), VIP trial (3 days) | 30-day streak, major events |

- **Duplicate handling:** Duplicates convert to "shards" (crafting currency) at 50% value.
- **Collection system:** Each cosmetic belongs to a "set." Completing a set grants a permanent profile background.

---

### 4.2 VIP / Membership Tiers ("Effort = Status")

**Not pay-to-win.** VIP tiers are earned through **platform activity** (tasks completed, campaigns created, deposits made, streak maintained). Paying accelerates progress but doesn't gate content.

#### 4.2.1 Tier System

| Tier | Name | Requirement | Perks |
|------|------|-------------|-------|
| 0 | Newcomer | Default | Basic access, 5 tasks/day |
| 1 | Bronze | Complete 10 tasks OR deposit $5 | 10 tasks/day, bronze badge |
| 2 | Silver | Complete 50 tasks OR $25 total deposits | 20 tasks/day, silver badge, 5% campaign fee discount |
| 3 | Gold | Complete 200 tasks OR $100 deposits | Unlimited tasks, gold badge, 10% fee discount, priority campaign review |
| 4 | Platinum | Complete 500 tasks OR $500 deposits | All above + platinum badge, 15% fee discount, exclusive store items |
| 5 | Diamond | Complete 1,000 tasks OR $1,000 deposits | All above + diamond badge, 20% fee discount, early access to new features, direct support channel |
| 6 | Legend | Top 100 users by XP (monthly) | All above + legend badge, 25% fee discount, featured on homepage, custom title |

**Tier Benefits Stack:** Higher tiers keep all lower-tier perks.

#### 4.2.2 VIP Points (VP)

Separate from XP. VP is the currency of status.

| Action | VP Earned |
|--------|-----------|
| Complete a task | 1 VP |
| Create a campaign | 5 VP |
| Deposit $1 | 10 VP |
| Maintain 7-day streak | 50 VP (one-time per week) |
| Achieve a new level | 20 VP × level |
| Win a competition | 100–1,000 VP |

- **VP decay:** None. Once earned, permanent. (Prevents anxiety about losing status.)
- **VP leaderboard:** Separate from XP leaderboard. "Most Dedicated Users."

#### 4.2.3 Tier Progression UI

- **Progress bar on profile:** "You're 45% to Gold! Complete 110 more tasks or deposit $55."
- **Tier comparison page:** Side-by-side perk comparison to motivate upgrades.
- **Tier-up animation:** Confetti, sound, socket notification to all friends.

---

### 4.3 In-App Store ("Credit Sink")

**Critical for economy health.** If credits only enter (deposits, tasks) and never leave (store, fees), credit value drops to zero and motivation dies.

#### 4.3.1 Store Categories

| Category | Items | Credit Cost |
|----------|-------|-------------|
| **Boosts** | XP Boost (1h), Credit Boost (1h), Task Refresh (reset daily task limit), Streak Freeze | 20–100 |
| **Cosmetics** | Profile frames, name colors, profile backgrounds, animated avatars, chat badges | 50–500 |
| **Convenience** | Extra mission reroll, extra wheel spin, instant campaign approval (skip queue) | 30–200 |
| **Credit Packs** | Buy credits with credits? No — this is a **sink**, not a faucet. But: "Credit Doubler" — next 5 tasks give 2× credits. | 150 |
| **Guild Perks** | Guild name color, guild badge, guild expansion (more members) | 100–1,000 |
| **Real Rewards** | Gift cards, crypto payouts (high credit cost = motivates earning) | 5,000–50,000 |

#### 4.3.2 Daily Deals (Scarcity = Urgency)

- **3 rotating deals every 24 hours.**
- Examples: "50% off XP Boost today only", "Legendary Loot Box — 500 credits (normally 1,000)", "Free Streak Freeze with any purchase."
- **Countdown timer:** Visible on store page. Creates FOMO.

#### 4.3.3 Store Economy Rules

1. **Everything obtainable without real money.** Store items cost credits earned from tasks.
2. **No paywalled power.** Boosts save time; they don't unlock content free users can't access.
3. **Credit cost scales with user level.** Higher-level users pay more for the same item (prevents alt-account farming).
4. **Purchase history:** Tracked for anti-abuse. Sudden large purchases = flag for review.

---

### 4.4 Social Competition ("See and Be Seen")

#### 4.4.1 Guilds / Crews (New)

- **Create or join a guild** (max 50 members).
- **Guild activities:**
  - Weekly guild missions (e.g., "Guild completes 500 tasks this week").
  - Guild leaderboard (total VP, total tasks, total deposits).
  - Guild chat (separate from main chat).
  - Guild store (perks bought with guild credits — earned from member activity).
- **Guild rewards:**
  - Top 3 guilds per week get exclusive profile badges.
  - Guild members get +5% credits from tasks (teamwork bonus).
- **Anti-abuse:** Guilds can't be used for bot coordination. Same IP limits apply.

#### 4.4.2 Competitions & Events (New)

| Event Type | Frequency | Description |
|------------|-----------|-------------|
| **Weekly Sprint** | Every Monday | Most tasks completed in 7 days. Top 10 win loot boxes. |
| **Creator Challenge** | Bi-weekly | Most campaigns created with ≥80% completion rate. |
| **Streak Wars** | Monthly | Longest streak in 30 days. Winner gets Legendary Loot Box + 500 credits. |
| **Double XP Weekend** | Random (announced 24h ahead) | All XP doubled. Encourages task completion during slow periods. |
| **Treasure Hunt** | Special | Admin hides a "treasure code" in a random task description. First to find and submit gets 1,000 credits. |
| **Referral Race** | Monthly | Most successful referrals (referred user completes ≥5 tasks). Top 5 win. |

- **Event hub page:** `/events` — current, upcoming, past events with leaderboards.
- **Live leaderboard:** Updates in real-time during events (socket events).
- ** Participation reward:** Everyone who participates gets at least a Common Loot Box.

#### 4.4.3 Referral System 2.0 (Upgrade)

Current system: referral code exists but rewards are minimal.

| Action | Referrer Reward | Referee Reward |
|--------|---------------|--------------|
| Referee signs up | 10 credits | 25 credits (welcome bonus) |
| Referee completes first task | 25 credits | — |
| Referee completes 10 tasks | 50 credits + 50 XP | 25 credits |
| Referee deposits $10+ | 100 credits + 1 VP per $1 | 10% bonus on first deposit |
| Referee reaches Silver tier | 200 credits + Rare Loot Box | 100 credits |

- **Referral leaderboard:** Top referrers per month get exclusive badge.
- **Referral dashboard:** Track signups, completions, earnings.

---

### 4.5 Collections & Card System (New)

**Digital trading cards** earned from tasks, events, loot boxes.

- **Task Cards:** Complete a YouTube task → chance to drop "YouTube Creator Card."
- **Event Cards:** Participate in events → exclusive event cards (limited supply).
- **Rarity:** Common, Rare, Epic, Legendary, Mythic.
- **Albums:** Collect all cards in a set → permanent profile background + title.
- **Trading:** Users can trade cards (1:1, no credits involved). Anti-abuse: trade history logged, max 10 trades/day.
- **Showcase:** Profile page displays "Top 3 Cards."

**Why this works:**
- Low effort to implement (images + DB table).
- High engagement (completionism psychology).
- Social (trading creates interaction).
- No economy impact (cards don't give credits — purely cosmetic).

---

## 5. Economy Design

### 5.1 Credit Flow

```
        ┌─────────────┐
        │   DEPOSITS  │ ← Real money enters (faucet)
        │  (Pay/PayPal/USDT) │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │   USERS     │ ← Hold credits in wallet
        └──────┬──────┘
               │
     ┌─────────┴─────────┐
     │                   │
     ▼                   ▼
┌─────────┐        ┌──────────┐
│  TASKS  │        │  STORE   │ ← Credits spent (sink)
│ (earn)  │        │ (spend)  │
└────┬────┘        └────┬─────┘
     │                  │
     ▼                  ▼
┌─────────┐        ┌──────────┐
│CREATORS │        │ PLATFORM │ ← Platform keeps credits
│(spend to│        │ (fees +  │
│ create) │        │ store tax)│
└─────────┘        └──────────┘
```

### 5.2 Faucet vs Sink Balance

| Faucet (Credits Enter) | Rate | Sink (Credits Leave) | Rate |
|------------------------|------|----------------------|------|
| Task completion | ~5–20/task | Campaign creation fees | 10% of budget |
| Daily reward | 10–100/day | Store purchases | Variable |
| Mission reward | 10–50/mission | Loot box purchases | 50–500/box |
| Achievement | 25–200 each | Boosts | 20–100 each |
| Deposit (real money) | $1 = 100 credits | Guild perks | 100–1,000 |
| Referral bonus | 10–200 each | Real rewards redemption | 5,000–50,000 |

**Target:** Sinks should remove ~60–70% of credits earned from faucets. The remaining 30–40% accumulates in user wallets, motivating deposits for big purchases.

### 5.3 Anti-Abuse in Economy

| Abuse Pattern | Detection | Mitigation |
|---------------|-----------|------------|
| Alt-account farming | IP + device fingerprint clustering | Shared IP task limit (already implemented), trust gate on new accounts |
| Credit farming via referrals | Referral chain analysis (A→B→C→D all same IP) | Only count referral if referee completes ≥5 tasks on different IP |
| Store exploit (buy low, sell high) | No resale mechanism | Store items are account-bound or consumable only |
| Bot spinning wheel | Spin frequency > humanly possible | Rate limit 1 spin/10s, max 10/day paid |
| Guild collusion | All guild members same IP | Guild member IP diversity check (≥50% unique IPs) |

---

## 6. Schema Additions

Minimal additions needed. Most systems can reuse existing patterns.

```prisma
// NEW: VIP Tiers
model VipTier {
  id          String @id @default(cuid())
  name        String @unique // BRONZE, SILVER, GOLD, PLATINUM, DIAMOND, LEGEND
  level       Int    @unique // 1-6
  requirementVp Int // VP needed to reach
  perkData    Json // JSON blob of perks (discount rates, task limits, etc.)
  users       User[]
}

// NEW: Store Items
model StoreItem {
  id          String      @id @default(cuid())
  name        String
  description String
  category    StoreCategory
  creditCost  Int
  isLimited   Boolean @default(false)
  limitedQty  Int? // NULL = unlimited
  startsAt    DateTime?
  endsAt      DateTime?
  isActive    Boolean @default(true)
  metadata    Json // item-specific data (boost duration, cosmetic URL, etc.)
}

// NEW: User Inventory (purchased items)
model UserInventory {
  id        String @id @default(cuid())
  userId    String
  itemId    String
  quantity  Int @default(1)
  acquiredAt DateTime @default(now())
  consumedAt DateTime? // for consumables like boosts
}

// NEW: Loot Boxes
enum LootBoxType { COMMON RARE EPIC LEGENDARY }
model LootBoxDrop {
  id        String @id @default(cuid())
  userId    String
  type      LootBoxType
  openedAt  DateTime @default(now())
  reward    Json // what they got
}

// NEW: Guilds
model Guild {
  id          String @id @default(cuid())
  name        String @unique
  tag         String @unique // 3-letter tag [ENG]
  ownerId     String
  description String?
  avatarUrl   String?
  memberCount Int @default(1)
  maxMembers  Int @default(50)
  totalVp     Int @default(0)
  createdAt   DateTime @default(now())
}

model GuildMember {
  id        String @id @default(cuid())
  guildId   String
  userId    String
  role      GuildRole @default(MEMBER)
  joinedAt  DateTime @default(now())
}

enum GuildRole { MEMBER OFFICER LEADER }

// NEW: Collections / Cards
model Card {
  id          String @id @default(cuid())
  name        String
  setId       String
  rarity      CardRarity
  imageUrl    String
  description String
}

model UserCard {
  id        String @id @default(cuid())
  userId    String
  cardId    String
  acquiredAt DateTime @default(now())
  tradeCount Int @default(0)
}

enum CardRarity { COMMON RARE EPIC LEGENDARY MYTHIC }

// NEW: Wheel Spins (for abuse tracking)
model WheelSpin {
  id        String @id @default(cuid())
  userId    String
  result    String // prize identifier
  isFree    Boolean
  cost      Int // credits spent (0 if free)
  createdAt DateTime @default(now())
}

// NEW: Events
model PlatformEvent {
  id          String @id @default(cuid())
  name        String
  type        EventType
  description String
  startsAt    DateTime
  endsAt      DateTime
  rules       Json // scoring rules, rewards, etc.
  isActive    Boolean @default(false)
}

enum EventType { WEEKLY_SPRINT CREATOR_CHALLENGE STREAK_WARS DOUBLE_XP TREASURE_HUNT REFERRAL_RACE }
```

**Migration strategy:** Add tables incrementally. No breaking changes to existing schema.

---

## 7. Implementation — Bite-Sized Tasks

> **Rule:** Each task below is independently shippable, testable, and deployable. No multi-day bundles.

---

### Sprint 1: VIP Tiers (VP + Status)

| # | Task | Est. | Files | Notes |
|---|------|------|-------|-------|
| 1.1 | **Schema:** Add `VipTier` table + `User.vp` field + `User.vipTierId` FK | 2h | `schema.prisma`, migration | No frontend yet. Just DB. |
| 1.2 | **Seed:** Insert 6 VIP tiers (Bronze→Legend) with perk JSON | 1h | Seed script | Can verify in Prisma Studio. |
| 1.3 | **VP Service:** `awardVp(userId, amount, reason)` helper + `getUserVipTier(user)` | 2h | `gamification.service.ts` | Called from task completion, deposit, streak. |
| 1.4 | **VP Hooks:** Wire VP awards into existing flows (task complete, deposit, streak, level up) | 2h | `tasks.service.ts`, `wallet.service.ts`, `gamification.service.ts` | Existing events now give VP. |
| 1.5 | **API:** `GET /gamification/vip` — returns user's current tier, next tier, progress %, perks | 2h | `gamification.controller.ts` | Frontend can read VIP status. |
| 1.6 | **Profile UI:** Show VIP badge + progress bar on `/profile` and `/u/:username` | 3h | `profile/page.tsx`, `users/[username]/page.tsx` | Visible status = motivation. |
| 1.7 | **Perks:** Apply tier perks (task limits, fee discount) at point of use | 3h | `tasks.service.ts` (assignTask limit), `campaigns.service.ts` (fee calc) | Bronze+ gets more tasks, etc. |

**Sprint 1 total:** ~15 hours. Shippable increment: users see their VIP status and get real perks.

---

### Sprint 2: Store (Credit Sink)

| # | Task | Est. | Files | Notes |
|---|------|------|-------|-------|
| 2.1 | **Schema:** Add `StoreItem`, `UserInventory`, `StorePurchase` tables | 2h | `schema.prisma`, migration | |
| 2.2 | **Seed:** Insert initial store items (3 boosts, 3 cosmetics, 1 convenience) | 1h | Seed script | Start small, expand later. |
| 2.3 | **API:** `GET /store/items` — list active items (filter by user level, limited availability) | 2h | New `store.controller.ts`, `store.service.ts` | |
| 2.4 | **API:** `POST /store/purchase/:itemId` — debit credits, add to inventory | 3h | `store.service.ts` | Atomic credit check + deduct. Anti-abuse: max 10 purchases/day. |
| 2.5 | **API:** `GET /store/inventory` — list user's items with quantities | 1h | `store.service.ts` | |
| 2.6 | **Store Page UI:** Grid of items with credit cost, category filter, purchase button | 4h | `/store/page.tsx` | First credit sink visible to users. |
| 2.7 | **Inventory UI:** "My Items" page — use consumables (boosts), equip cosmetics | 3h | `/store/inventory/page.tsx` | |
| 2.8 | **Daily Deals:** 3 rotating deals, 24h timer, discounted prices | 3h | `store.service.ts` (deal rotation logic), UI badge | Creates urgency. |

**Sprint 2 total:** ~19 hours. Shippable increment: users can spend credits, economy has a sink.

---

### Sprint 3: Daily Reward 2.0 + Spin Wheel

| # | Task | Est. | Files | Notes |
|---|------|------|-------|-------|
| 3.1 | **Schema:** Add `LootBoxDrop` table; expand daily reward logic | 1h | `schema.prisma` | |
| 3.2 | **Backend:** Daily reward with streak milestones (day 5, 7, 14, 30 bonuses) | 3h | `gamification.service.ts` | Returns loot box type at milestones. |
| 3.3 | **Backend:** Loot box open — roll reward based on rarity table | 2h | `gamification.service.ts` | Common=70%, Rare=20%, Epic=8%, Legendary=2%. |
| 3.4 | **Schema:** Add `WheelSpin` table | 1h | `schema.prisma` | Abuse tracking. |
| 3.5 | **Backend:** Spin the wheel — free once/day, paid 20 credits/spin, max 10/day | 2h | `gamification.service.ts` | Prize weight table from plan. |
| 3.6 | **Frontend:** Daily reward claim UI with streak calendar | 3h | `dashboard/page.tsx` or `/reward/page.tsx` | Visual streak calendar, milestone highlights. |
| 3.7 | **Frontend:** Spin wheel component (animated, satisfying) | 4h | Reusable `SpinWheel` component | Can reuse for events later. |
| 3.8 | **Frontend:** Loot box open animation | 3h | Reusable `LootBox` component | Shake → burst → reveal reward. |

**Sprint 3 total:** ~19 hours. Shippable increment: daily ritual is compelling, rewards feel exciting.

---

### Sprint 4: Guilds

| # | Task | Est. | Files | Notes |
|---|------|------|-------|-------|
| 4.1 | **Schema:** `Guild`, `GuildMember` tables | 2h | `schema.prisma` | |
| 4.2 | **API:** `POST /guilds` — create guild (costs 500 credits, name + tag) | 2h | `guilds.controller.ts`, `guilds.service.ts` | Credit sink + anti-spam. |
| 4.3 | **API:** `POST /guilds/:id/join`, `POST /guilds/:id/leave` | 2h | Same | Max 50 members, auto-kick inactive after 14 days. |
| 4.4 | **API:** `GET /guilds`, `GET /guilds/:id` — list + detail | 2h | Same | |
| 4.5 | **API:** Guild leaderboard (by total VP, total tasks, total deposits) | 2h | `guilds.service.ts` | |
| 4.6 | **Frontend:** Guild list page (search, filter, join button) | 3h | `/guilds/page.tsx` | |
| 4.7 | **Frontend:** Guild detail page (members, leaderboard rank, description) | 3h | `/guilds/[id]/page.tsx` | |
| 4.8 | **Frontend:** Guild chat (simple socket room, `/guilds/[id]/chat`) | 4h | Reuse existing chat components | Low priority — can ship guilds without chat first. |
| 4.9 | **Perks:** +5% credits from tasks if in a guild | 1h | `tasks.service.ts` | Simple incentive to join. |

**Sprint 4 total:** ~21 hours (or 17h without chat). Shippable increment: social layer exists, users can join teams.

---

### Sprint 5: Events + Competitions

| # | Task | Est. | Files | Notes |
|---|------|------|-------|-------|
| 5.1 | **Schema:** `PlatformEvent` table | 1h | `schema.prisma` | |
| 5.2 | **Backend:** Event creation (admin-only API) | 2h | `admin.controller.ts` | Name, type, dates, rules, rewards. |
| 5.3 | **Backend:** Weekly Sprint scoring — most tasks completed in 7 days | 2h | `events.service.ts` | Cron runs Monday 00:00 to calculate winners. |
| 5.4 | **Backend:** Streak Wars scoring — longest streak in 30 days | 1h | Same | |
| 5.5 | **Backend:** Double XP event flag — `isDoubleXpActive()` check in `awardXp()` | 1h | `gamification.service.ts` | Simple conditional multiplier. |
| 5.6 | **Frontend:** Events hub page `/events` — current, upcoming, past | 3h | `/events/page.tsx` | |
| 5.7 | **Frontend:** Live leaderboard during events (socket updates) | 3h | Reuse leaderboard component | |
| 5.8 | **Rewards:** Auto-distribute loot boxes to top 10 winners | 2h | `events.service.ts` | |

**Sprint 5 total:** ~15 hours. Shippable increment: time-limited competitions create urgency and spikes in activity.

---

### Sprint 6: Collections (Cards)

| # | Task | Est. | Files | Notes |
|---|------|------|-------|-------|
| 6.1 | **Schema:** `Card`, `CardSet`, `UserCard` tables | 2h | `schema.prisma` | |
| 6.2 | **Seed:** Create 3 card sets (Platform Pioneers, Task Masters, Event Legends) with 5 cards each | 2h | Seed script + placeholder images | |
| 6.3 | **Drop logic:** Chance to drop a card on task completion (5% common, 1% rare) | 2h | `tasks.service.ts` | |
| 6.4 | **API:** `GET /cards` — user's collection, `GET /cards/sets` — all sets with completion % | 2h | `cards.controller.ts` | |
| 6.5 | **API:** `POST /cards/trade` — trade 1:1 with another user | 3h | `cards.service.ts` | Anti-abuse: max 10 trades/day, log all trades. |
| 6.6 | **Frontend:** Card album page — grid of cards, completion progress per set | 3h | `/cards/page.tsx` | |
| 6.7 | **Frontend:** Profile card showcase — display top 3 cards | 2h | `users/[username]/page.tsx` | |
| 6.8 | **Set completion reward:** Permanent profile background + title when set complete | 2h | `gamification.service.ts` | |

**Sprint 6 total:** ~18 hours. Shippable increment: completionist psychology engaged, trading creates social interaction.

---

### Sprint 7: Referral 2.0 + Analytics

| # | Task | Est. | Files | Notes |
|---|------|------|-------|-------|
| 7.1 | **Backend:** Tiered referral rewards (sign up → first task → 10 tasks → deposit → tier) | 3h | `auth.service.ts`, `tasks.service.ts`, `wallet.service.ts` | |
| 7.2 | **Frontend:** Referral dashboard — stats, earnings, share link | 3h | `/referrals/page.tsx` | |
| 7.3 | **Backend:** Engagement analytics (DAU, session length, feature usage) | 4h | New `analytics.service.ts` methods | Store in DB, expose to admin. |
| 7.4 | **Frontend:** Admin engagement dashboard | 3h | `/admin/analytics/engagement/page.tsx` | |

**Sprint 7 total:** ~13 hours.

---

## Total Effort Estimate

| Sprint | Hours | Shippable Increment |
|--------|-------|---------------------|
| 1 — VIP Tiers | ~15h | Status system with real perks |
| 2 — Store | ~19h | Credit sink, users spend credits |
| 3 — Daily Reward + Wheel | ~19h | Compelling daily ritual |
| 4 — Guilds | ~17h | Social teams, guild leaderboard |
| 5 — Events | ~15h | Time-limited competitions |
| 6 — Collections | ~18h | Trading cards, completionism |
| 7 — Referral + Analytics | ~13h | Growth loop + data visibility |
| **Total** | **~116h** | **~6 weeks at 20h/week** |

**Pick any sprint in any order.** Each stands alone. No dependencies between sprints.

**My recommendation:** Start with Sprint 1 (VIP) → Sprint 2 (Store) → Sprint 3 (Wheel/Reward). That trio alone transforms the platform from "task site" to "daily destination."

---

## 8. Success Metrics

| Metric | Baseline | Target (30 days after launch) |
|--------|----------|------------------------------|
| DAU / MAU ratio | ~15% | 40%+ (habit-forming) |
| Avg session length | 3 min | 8 min |
| Sessions with 0 tasks | 60% | 30% (gamification fills gap) |
| Store conversion (buyers / MAU) | 0% | 15% |
| Credit sink rate | 20% | 60% |
| 7-day retention | 25% | 50% |
| Referral rate | <1% | 10% |

---

## 9. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Economy inflation (too many faucets) | Medium | High | Monitor credit velocity weekly; adjust store prices dynamically |
| Bot farming of free rewards | High | Medium | IP/device limits, trust gates, CAPTCHA on reward claim |
| Guilds used for coordination abuse | Medium | High | IP diversity requirement, guild leader accountability |
| Store items feel pay-to-win | Low | High | No power items; cosmetics + convenience only |
| Users overwhelmed by too many systems | Medium | Medium | Progressive unlock (new systems appear as user levels up) |

---

## 10. Next Steps

1. **Review this plan** — Which systems resonate? Which feel like too much?
2. **Prioritize** — I recommend: VIP tiers → Store → Spin wheel → Guilds → Events → Cards.
3. **Schema first** — Build the DB tables before any UI.
4. **One system at a time** — Full-stack each system before moving to the next.

**Ready when you are.** Tell me which phase to start with.
