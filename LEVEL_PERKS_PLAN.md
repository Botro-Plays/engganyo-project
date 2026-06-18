# Level Perks & Progressive Feature Unlock System

**Status:** Design Proposal — Pending Review  
**Date:** 2026-06-18  
**Next Sprint Candidate:** Phase 13 — Gamification 2.0 (adapted)  
**Scope:** Internal feature (no external API approvals required)

---

## 1. Current Progression Landscape (What Already Exists)

You already have **three** progression systems:

| System | Governs | Metric | Current Enforcement |
|--------|---------|--------|-------------------|
| **Trust Gates** | Volume limits | Trust score (0-100) | `TasksService.assignTask()` — daily task caps; `CampaignsService.create()` — campaign budget caps |
| **VIP Tiers** | Quality-of-life perks | VP (Vip Points) | `CampaignsService` — fee discounts; `ChannelsService` — chat rooms, tipping, VIP channels |
| **Level** | Nothing (cosmetic only) | XP | Frontend display only; no backend enforcement |

**The problem:** Users hit max level usefulness immediately. Trust gates feel like punishment. VIP is paywalled. There is no positive progression loop that says "keep playing to unlock cool stuff."

---

## 2. Proposed Philosophy: Dual-Track Progression

| Track | Governs | How You Progress | Feeling |
|-------|---------|------------------|---------|
| **Level** (engagement) | What features you unlock | Complete tasks, daily logins, missions | "I'm getting stronger" |
| **Trust** (legitimacy) | How much you can do | Link socials, good behavior, account age | "I'm becoming trusted" |
| **VIP** (monetization) | Quality-of-life perks | Deposit money | "I'm being rewarded for spending" |

**Key principle:** Level unlocks *features*. Trust governs *volume*. VIP improves *quality*.

---

## 3. Level Progression Timeline

Using the existing formula: `level = floor(sqrt(xp / 100)) + 1`

| Level | Total XP Required | Approx. Tasks* | Realistic Timeline |
|-------|--------------------|----------------|------------------|
| 1 | 0 | 0 | Registration |
| 2 | 100 | 2 | First task + daily reward |
| 3 | 400 | 8 | ~2 days (at 5/day) |
| 5 | 1,600 | 32 | ~7 days (at 5/day) or ~2 days (at 20/day) |
| 8 | 4,900 | 98 | ~3 weeks |
| 10 | 8,100 | 162 | ~5 weeks |
| 15 | 19,600 | 392 | ~3 months |
| 20 | 36,100 | 722 | ~5 months |

**\*** Assumes 50 XP/task + daily/mission bonuses. At LOW trust (20/day), progression is 4x faster.

**Why this curve works:** A user who completes just **one task** and claims daily reward hits Level 2 within minutes. This creates an immediate dopamine hit. But reaching Level 5 requires sustained engagement — a natural anti-abuse mechanism.

---

## 4. Feature Unlock Matrix

Currently ALL of these are available at registration. Proposal: gate them.

| Feature | Current Status | **Proposed Level** | Rationale |
|---------|---------------|--------------------|-----------|
| Browse tasks | Available | **1** | Core loop; never gate |
| Complete tasks | Available | **1** | Core loop; never gate |
| Daily reward | Available | **1** | Core loop; never gate |
| YouTube/Google social link | Available | **1** | Foundation; OAuth verified |
| View leaderboard | Available | **1** | Motivation |
| Basic profile editing | Available | **1** | Personalization |
| **Store access** | Available | **2** | Must earn credits first before spending |
| **Inventory / use items** | Available | **2** | Follows store |
| **Twitch/Spotify social link** | Available | **2** | Also OAuth verified; early reward |
| **Wheel spin** | Available | **3** | "You've earned a spin!" — milestone reward |
| **Twitter/X social link** | Available | **3** | Popular platform; moderate engagement |
| **Forum read + reply** | Available | **3** | Community participation; need some trust |
| **Create campaigns** | Trust-gated (LOW) | **5 + Trust LOW** | Must understand platform before creating |
| **Chat (public channels)** | Available | **5** | Real-time community; need maturity |
| **TikTok/Instagram social link** | Available | **5** | Major platforms; more trust needed |
| **Create private chat channels** | VIP Gold+ | **8** OR VIP Gold+ | Engagement alternative to paid VIP |
| **Facebook/Telegram/Discord social link** | Available | **8** | Community platforms; higher bar |
| **Advanced store items** | Available | **10** | Higher-tier boosts for dedicated users |
| **TrustPilot social link** | Available | **12** | Niche business platform |
| **Campaign analytics** | Available | **15** | Advanced creator feature |
| **Priority campaign listing** | Available | **15** | Reward for platform veterans |

**Migration risk:** Existing active users are likely Level 5+ already (100+ tasks = 5,000+ XP = Level 8). Most won't be affected. New users get a guided progression.

---

## 5. Social Platform Unlock Matrix

You requested this specifically. Here is the proposed progression:

| Level | Platforms Unlocked | Verification Status |
|-------|--------------------|---------------------|
| **1** | **YouTube**, **Google Reviews** | ✅ OAuth API verified |
| **2** | **Twitch**, **Spotify** | ✅ OAuth API verified |
| **3** | **Twitter / X** | Manual proof |
| **5** | **TikTok**, **Instagram** | Manual proof |
| **8** | **Facebook**, **Telegram**, **Discord** | Manual proof |
| **12** | **TrustPilot** | Manual proof |

**Why this order:**

1. **YouTube first** — Only platform with full OAuth verification (like/subscribe/comment). Lowest fraud risk.
2. **Twitch/Spotify second** — Also have OAuth verification. Reward early engagement.
3. **Twitter/X third** — Manual proof only, but widely used. Requires some platform maturity.
4. **TikTok/Instagram fifth** — Highest-value platforms. Require trust + engagement.
5. **Facebook eighth** — You correctly flagged this as risky for API bans. Manual proof only. Gated behind level to reduce abuse surface.
6. **TrustPilot twelfth** — Niche. Business users only.

---

## 6. Level Perks (The "Why" Behind Grinding)

From your original ROADMAP Phase 13, here are the proposed perks:

| Level | Perk | Mechanic |
|-------|------|----------|
| **5** | Task earning multiplier: **1.0x → 1.1x** | `awardXp()` and credit() apply 1.1x to task completion rewards |
| **5** | Platform fee discount: **15% → 12%** | `CampaignsService.getFeeConfig()` checks level |
| **10** | Task earning multiplier: **1.1x → 1.2x** | Stack with Level 5 (total 1.2x) |
| **10** | Platform fee discount: **12% → 10%** | Stack with Level 5 (total 10%) |
| **10** | **Custom profile badge** | Unlock first badge selection in profile |
| **15** | **Exclusive campaign access** | High-credit campaigns marked "Level 15+" visible in browse |
| **20** | Task earning multiplier: **1.2x → 1.3x** | Total 1.3x |
| **20** | Platform fee discount: **10% → 8%** | Total 8% |
| **20** | **Priority support** | Fast-track flag on reports/help requests |

---

## 7. The Critical Conflict: VIP Tiers vs. Level Perks

You currently have **VIP tiers** (BRONZE → LEGEND) that give fee discounts (5% → 30%), task limit bonuses (+5 → +15), chat perks (badges, room creation, tipping), and rate multipliers.

**If both Level and VIP give fee discounts, they stack.** A LEGEND VIP (30% off) + Level 20 (8% base → effectively 20.8% fee instead of 30%) gets massive discounts.

**Three ways to resolve this. You must pick one:**

### Option A: Separate Domains (Recommended)
- **Level perks** = Task earning multipliers + feature unlocks
- **VIP perks** = Campaign fee discounts + chat perks + cosmetic badges

**Why:** Clean separation. Free grinders earn more credits. Paying users pay less in fees. Both feel valuable without overlap.

### Option B: Stack with Diminishing Returns
- Level gives base discount. VIP gives bonus discount.
- Formula: `finalRate = baseRate * (1 - levelDiscount) * (1 - vipDiscount)`
- Example: Level 10 (10% off) + SILVER VIP (10% off) = 19% total discount, not 20%.

**Why:** Rewards both engagement and spending. But complex to explain to users.

### Option C: Replace VIP Fee Discounts with Level
- VIP becomes purely cosmetic + chat + convenience.
- Level becomes the only source of fee discounts and earning multipliers.

**Why:** Simpler mental model. But devalues VIP tier purchases.

**My recommendation: Option A.** Keep fee discounts in VIP (monetization incentive) and move earning multipliers to Level (engagement incentive). A user who grinds to Level 20 but is F2P earns 30% more credits per task. A user who pays for LEGEND VIP pays 30% less in campaign fees. Both win, no overlap.

---

## 8. Data Model Changes

Minimal additions required:

```prisma
// New: Perk configuration (admin-configurable)
model LevelPerkConfig {
  id        String   @id @default(cuid())
  level     Int      @unique
  perkType  String   // 'EARNING_MULTIPLIER', 'FEE_DISCOUNT', 'FEATURE_UNLOCK', etc.
  value     Float    // 1.1 for 10% multiplier, 0.10 for 10% discount
  metadata  Json?    // { feature: 'CAMPAIGN_CREATE' }, { platforms: ['TIKTOK'] }, etc.
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
}

// OR: simpler approach — compute everything from level, no new table
// Just add level checks in services
```

Social platform gating needs a new config:

```prisma
// Add to existing OAuthConfig or new table
model PlatformUnlockConfig {
  platform      SocialPlatform @id
  requiredLevel Int            @default(1)
  enabled       Boolean        @default(true)
}
```

---

## 9. Backend Changes Overview

| File | Change |
|------|--------|
| `users.service.ts:upsertSocialLink()` | Check `user.level >= platform.requiredLevel` before creating/updating social link |
| `gamification.service.ts:awardXp()` | Apply `earningMultiplier` from level perks to XP grants |
| `tasks.service.ts:assignTask()` | After trust check, verify user level >= required for task platform type |
| `campaigns.service.ts:create()` | After trust check, verify user level >= 5 |
| `channels.service.ts` | Check user level for chat access (public channels = 5+, private creation = 8+) |
| `store.service.ts` | Check user level for advanced item purchases |
| `users.controller.ts` | Add `GET /users/level-gates` endpoint returning unlocked features/platforms for current user |
| New `level-gate.guard.ts` | Reusable guard: `@RequireLevel(5)` on controller methods |

---

## 10. Frontend Changes Overview

| File | Change |
|------|--------|
| `layout.tsx` (sidebar) | Grey out locked nav items with lock icon + level requirement tooltip |
| `page.tsx` (social form) | Filter `PLATFORMS` dropdown — show locked platforms as disabled with "Unlock at Level X" |
| `store/page.tsx` | Grey out advanced items with level requirement badge |
| `tasks/page.tsx` | Show "Level 3 required for Twitter tasks" if user is below |
| `campaigns/page.tsx` | Show "Unlock campaign creation at Level 5" with progress bar |
| `chat/page.tsx` | Redirect to dashboard with "Chat unlocks at Level 5" if below |
| New `LevelProgressCard` | Show in dashboard: current level, XP to next, next unlock preview |
| New `LockedFeatureOverlay` | Reusable component: lock icon + level requirement + "X XP remaining" |

---

## 11. Integration with Existing Systems

| Existing System | How It Interacts |
|----------------|------------------|
| **Trust Gates** | Trust still governs volume (tasks/day, campaign budget). Level gates are checked after trust gates. Both must pass. |
| **VIP Tiers** | If we use Option A (separate domains), no conflict. VIP discounts apply to fees. Level multipliers apply to earnings. |
| **Store / Active Effects** | Store remains available. Advanced items (higher-tier boosts) unlock at Level 10. Basic items available at Level 2. |
| **Achievements/Missions** | Already give XP. Now they also accelerate feature unlocks. Natural synergy. |
| **Notifications** | Emit `level:up` socket event already exists. Add `feature:unlocked` event. |

---

## 12. Open Questions (You Must Answer Before Coding)

### Q1: Perk Domain Split
Which resolution do you want for the Level/VIP conflict?

- [ ] **A** — Level = earning multipliers + features. VIP = fee discounts + chat. (Recommended)
- [ ] **B** — Stack with diminishing returns
- [ ] **C** — Something else?

### Q2: Campaign Creation Gating
Currently gated by Trust LOW (21+ score). Should campaign creation require:

- [ ] **A** — Level 5 AND Trust LOW (dual gate)
- [ ] **B** — Level 5 OR Trust LOW (either one)
- [ ] **C** — Replace Trust LOW with Level 5 entirely

### Q3: Existing Users
Active users who are below proposed gates (e.g., Level < 5 but already created campaigns):

- [ ] **A** — Grandfather — existing campaigns stay active, but can't create new ones until level up
- [ ] **B** — Hard gate — lose access immediately if below level
- [ ] **C** — One-time grace period (30 days to level up)

### Q4: Social Platform Order
The proposed order is: YouTube → Twitch/Spotify → Twitter/X → TikTok/Instagram → Facebook/Telegram/Discord → TrustPilot.

- [ ] **A** — Accept as proposed
- [ ] **B** — Move Facebook to Level 10+ (higher ban-risk concern)
- [ ] **C** — Move TikTok to Level 3 (earlier, since it's a major platform)

### Q5: Store Gating
Should the entire store unlock at Level 2, or should specific item categories unlock progressively?

- [ ] **A** — Whole store at Level 2
- [ ] **B** — Cosmetics at 2, Boosts at 3, Loot Boxes at 5, Advanced boosts at 10

### Q6: Chat Gating
Chat is currently available to all logged-in users. VIP channels are already gated. Should public chat require Level 5?

- [ ] **A** — Yes — Level 5 for all chat
- [ ] **B** — No — keep public chat open, gate only private room creation

---

*Once you answer these six questions, the exact implementation plan will be produced: schema migrations, API changes, frontend wiring, and the precise level/feature matrix.*

