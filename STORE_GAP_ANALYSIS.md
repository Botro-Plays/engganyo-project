# Store System — Gap Analysis & Improvement Roadmap

> **Date:** 2026-06-16  
> **Context:** Sprint 2 (In-App Store) shipped. This document captures the delta between "shipped" and "production-ready", prioritized by severity.  
> **Status:** Ready for implementation

---

## Legend

| Priority | Meaning |
|---|---|
| 🔴 Critical | Breaks correctness, security, or user trust. Must fix before meaningful traffic. |
| 🟡 High | Significant UX gap or missing business logic. Fixes are high-impact. |
| 🟠 Admin / Ops | Needed for day-to-day operations. Can be deferred if manual DB access is acceptable. |
| 🟢 Polish | Nice-to-have. Tackle after all 🔴🟡 items are complete. |

---

## 🔴 Critical

### C1. No rate limit on `POST /store/purchase`

- **Problem:** Users can spam-purchase in a tight loop. Even with optimistic locking, timing exploits can drain credits or trigger unnecessary DB contention.
- **Fix:** Add `@Throttle` to `StoreController.purchaseItem` — 10 req/min is reasonable.
- **File:** `apps/api/src/modules/store/store.controller.ts`
- **Est:** 15 min

### C2. Limited-quantity race condition

- **Problem:** Current flow: `count(purchases)` → `check remaining` → `create(purchase)`. Under concurrent load, two users can both see 1 remaining and both buy it, overselling the limit.
- **Fix:** Wrap the entire purchase in a Prisma `$transaction` with `Serializable` isolation, or use `$executeRaw` with `SELECT ... FOR UPDATE` on `StoreItem` before counting. Alternatively, recheck count inside the same transaction block and throw if exceeded.
- **File:** `apps/api/src/modules/store/store.service.ts` (`purchaseItem`)
- **Est:** 30 min

### C3. Purchased items have zero functional effect

- **Problem:** Users pay credits but boosts don't boost XP, streak freezes don't protect streaks, and task limit boosts don't add slots. The `UserInventory` records exist but nothing reads them. This is the #1 production trust risk.
- **Fix phases:**
  1. Add `isConsumable` + `maxOwnedPerUser` + `effectType` fields to `StoreItem` metadata schema (or dedicated JSON shape).
  2. Implement `POST /store/inventory/:id/use` endpoint that:
     - Validates ownership and unconsumed state.
     - Sets `consumedAt` (or decrements `quantity` for stackables).
     - Writes a Redis key with TTL for time-based effects (e.g. `xp_boost:{userId}`).
  3. Wire effect reads into existing flows:
     - `GamificationService.awardXp()` → check Redis for active XP boost multiplier.
     - `TasksService.assignTask()` → check Redis for active task limit boost.
     - `GamificationService.claimDailyReward()` → check Redis for active streak freeze before breaking streak.
- **Files:**
  - `apps/api/src/modules/store/store.service.ts`
  - `apps/api/src/modules/store/store.controller.ts`
  - `apps/api/src/modules/gamification/gamification.service.ts`
  - `apps/api/src/modules/tasks/tasks.service.ts`
- **Est:** 3–4 hours

---

## 🟡 High

### H1. No cosmetic deduplication guard

- **Problem:** A user can buy "VIP Badge: Gold Frame" twice, wasting 500 credits. The second purchase just increments `quantity` on an already-owned cosmetic.
- **Fix:** In `purchaseItem`, if `item.category === 'COSMETIC'` and `UserInventory` already has an unconsumed row for this item, throw `BadRequestException('You already own this cosmetic')`.
- **File:** `apps/api/src/modules/store/store.service.ts`
- **Est:** 20 min

### H2. No "Owned" state in frontend `/store`

- **Problem:** The store grid always shows "Buy" even if the user already owns the cosmetic. Bad UX.
- **Fix:** Frontend `/store` page should call `GET /store/inventory` in parallel with `GET /store/items`, then overlay owned/consumed state on each card.
- **File:** `apps/web/src/app/(dashboard)/store/page.tsx`
- **Est:** 30 min

### H3. Mystery Gift Box loot reveal not implemented

- **Problem:** Purchasing a Mystery Box just adds an unconsumed inventory row. There's no endpoint or logic to "open" it and receive a random reward. A box that can't be opened is confusing.
- **Fix:**
  1. Add `POST /store/inventory/:id/open` endpoint.
  2. Randomly select a reward from `metadata.possibleRewards`.
  3. If credits: call `walletService.credit()` (type = `EARN_ACHIEVEMENT` or new `EARN_LOOTBOX`).
  4. If boost or cosmetic: create a new `UserInventory` entry for that item.
  5. Mark original box as consumed.
  6. Return the reward details to the frontend so it can show a reveal animation.
- **Files:**
  - `apps/api/src/modules/store/store.service.ts`
  - `apps/api/src/modules/store/store.controller.ts`
  - `apps/web/src/app/(dashboard)/store/inventory/page.tsx`
- **Est:** 1.5 hours

### H4. No purchase success notification / socket event

- **Problem:** After a successful purchase, the user only knows it worked if the React Query invalidation refreshes the data before they navigate away. No explicit feedback.
- **Fix:**
  - API: In `StoreService.purchaseItem`, after the transaction commits, call `notificationsService.createNotification` (type `CREDIT_SPENT` or new `ITEM_PURCHASED`) and `eventsService.emitToUser(userId, 'store:purchased', { itemName, quantity, totalCost })`.
  - Frontend: `useSocketEvent('store:purchased', ...)` shows a toast or confetti animation.
- **Files:**
  - `apps/api/src/modules/store/store.service.ts`
  - `apps/web/src/app/(dashboard)/store/page.tsx`
- **Est:** 30 min

### H5. `getItems` leaks internal metadata to clients

- **Problem:** `GET /store/items` returns `metadata` as-is. For the Mystery Box, this includes `possibleRewards` pool, revealing the odds. For boosts, it reveals internal multiplier values that could be exploited if frontend validation is ever added.
- **Fix:** Strip `metadata` from the public `getItems` response, or define a `StoreItemPublic` DTO with a whitelist of safe keys (e.g. `assetUrl`, `themeId`, `durationHours`).
- **File:** `apps/api/src/modules/store/store.service.ts`
- **Est:** 20 min

---

## 🟠 Admin / Operations

### A1. No admin CRUD for store items

- **Problem:** To add, edit, or deactivate a store item, someone must write raw SQL or Prisma seed scripts. No admin UI or API exists.
- **Fix:** Add admin endpoints under `AdminController`:
  - `POST /admin/store/items` — create item
  - `PATCH /admin/store/items/:id` — update price, qty, dates, active flag
  - `GET /admin/store/items` — list all items (including inactive)
- **File:** `apps/api/src/modules/admin/admin.controller.ts`, `admin.service.ts`
- **Est:** 1 hour

### A2. No "grant item to user" support endpoint

- **Problem:** Customer support cannot manually compensate a user with an item (e.g. refund in credits vs. items, or promotional giveaway).
- **Fix:** Admin endpoint `POST /admin/store/grant` that creates `UserInventory` and optionally a zero-credit `StorePurchase` record for audit.
- **File:** `apps/api/src/modules/admin/admin.controller.ts`
- **Est:** 30 min

### A3. No store purchase analytics

- **Problem:** No visibility into which items sell, revenue per item, conversion rate from store page to purchase.
- **Fix:** Track in `AnalyticsSnapshot` or create a new `StoreAnalytics` table with daily rollups per item. Also expose on the admin dashboard.
- **Files:**
  - `apps/api/prisma/schema.prisma` (new model or column additions)
  - `apps/api/src/modules/analytics/`
  - `apps/web/src/app/(admin)/admin/store/page.tsx`
- **Est:** 2 hours

---

## 🟢 Polish

### P1. No quantity selector in frontend

- **Problem:** User can only buy 1x at a time. For stackables like Streak Freeze, buying 3 in a row is tedious.
- **Fix:** Add a `<select>` or +/- stepper in the store item card for `quantity` (1–99), bounded by `maxOwnedPerUser` and `limitedQty`.
- **File:** `apps/web/src/app/(dashboard)/store/page.tsx`
- **Est:** 30 min

### P2. No VIP tier gating on store items

- **Problem:** Any user can buy any item. Premium cosmetics and guild perks should be gated behind VIP tiers to create aspiration.
- **Fix:** Add `requiredVipTierLevel: Int?` to `StoreItem`. In `purchaseItem`, check user's VIP tier and reject if below.
- **Files:**
  - `apps/api/prisma/schema.prisma`
  - `apps/api/src/modules/store/store.service.ts`
  - `apps/web/src/app/(dashboard)/store/page.tsx` (lock icon + tier requirement)
- **Est:** 45 min

### P3. No item image/icon assets

- **Problem:** All items currently show a generic Lucide icon. Visual identity is weak.
- **Fix:** Add `imageUrl` to `StoreItem` metadata or schema. Use fallback Lucide icons until art is ready.
- **File:** `apps/api/prisma/schema.prisma` (optional `imageUrl` field)
- **Est:** 10 min

### P4. No discount / promo code system

- **Problem:** No way to run a "20% off all boosts this weekend" promotion.
- **Fix:** Out of scope for Sprint 2. Documented for future sprint.
- **Est:** N/A (future)

---

## Recommended Execution Order (Today)

If proceeding, tackle in this order for maximum user trust and correctness:

1. **C1** — Rate limit on purchase (15 min)
2. **C2** — Fix limited qty race condition (30 min)
3. **C3** — Implement `useItem` + functional boost effects (3–4 hours)
4. **H1** — Cosmetic dedup guard (20 min)
5. **H2** — "Owned" state in `/store` frontend (30 min)
6. **H3** — Mystery Box open logic (1.5 hours)
7. **H4** — Purchase notification + socket event (30 min)
8. **H5** — Strip sensitive metadata from public API (20 min)

Total estimate: ~6.5 hours of focused work.

---

*Document created: 2026-06-16 | Next review: before starting Sprint 3 (Daily Reward 2.0 + Spin Wheel)*
