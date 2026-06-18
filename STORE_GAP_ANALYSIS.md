# Store System — Gap Analysis & Improvement Roadmap

> **Date:** 2026-06-17  
> **Context:** Sprint 2 (In-App Store) shipped. This document captures the delta between "shipped" and "production-ready", prioritized by severity.  
> **Status:** Store system is now production-trustworthy. All 🔴 Critical and 🟡 High items are resolved. Only 🟢 Polish remains.

---

## Legend

| Priority | Meaning |
|---|---|
| 🔴 Critical | Breaks correctness, security, or user trust. Must fix before meaningful traffic. |
| 🟡 High | Significant UX gap or missing business logic. Fixes are high-impact. |
| 🟠 Admin / Ops | Needed for day-to-day operations. Can be deferred if manual DB access is acceptable. |
| 🟢 Polish | Nice-to-have. Tackle after all 🔴🟡 items are complete. |

---

## � Bug Fixes (Post-Deploy)

### F1. `import type` caused "Invalid data provided" on purchase

- **Date:** 2026-06-16
- **Problem:** `StoreController.purchaseItem` used `import type { PurchaseItemDto }`. In the Docker production build, TypeScript strips `import type` entirely, so the `PurchaseItemDto` class was unavailable at runtime. NestJS `ValidationPipe` could not instantiate/validate the DTO, leaving `dto.itemId` as `undefined`. This caused a `PrismaClientValidationError` when passed to Prisma queries, which the global exception filter mapped to 400 "Invalid data provided".
- **Fix:** Changed `import type` to `import { PurchaseItemDto }` in `apps/api/src/modules/store/store.controller.ts`.
- **Verification:** After deploy, user 'botro' (SUPER_ADMIN) successfully purchased items without error. Server logs showed no Prisma validation errors.
- **Lesson:** Never use `import type` for DTOs consumed by `ValidationPipe` or any runtime decorator that needs the actual class reference. The ts-jest test environment handles `import type` differently than the compiled Docker build, so local Jest tests can pass while production fails.

### F2. Cosmetics `is_consumable` = true in production DB (wrong default migration)

- **Date:** 2026-06-16
- **Problem:** Migration `20260616025608` added `is_consumable` column with `DEFAULT true`. Since seed ran before this migration, all existing items (including cosmetics) had `is_consumable = true` in production. This meant cosmetics like "Profile Theme: Neon" could be "used" via the `useItem` endpoint, getting marked as consumed with `consumedAt` and quantity=0, but the row was never deleted. This caused: (1) item still visible in inventory with "Used" tag, (2) cosmetic dedup guard used `consumedAt: null` filter, which no longer matched, allowing re-purchase, (3) two duplicate inventory rows for same cosmetic.
- **Fix:** New migration `20260616100000` updates `is_consumable = false` for all `COSMETIC` category items. It also repairs cosmetic inventory rows that were erroneously consumed (`consumed_at = NULL`, `quantity = 1`) and auto-equips them.
- **Files:** `apps/api/prisma/migrations/20260616100000_add_equipped_and_fix_cosmetics/migration.sql`

### F3. Inventory ghost rows after use + active-effect duplication

- **Date:** 2026-06-16
- **Problem:** `useItem` decremented quantity and set `consumedAt` when reaching zero, but did NOT delete the row. This left ghost rows (`quantity = 0`, `consumedAt = Date`) that were still returned by `getUserInventory`, cluttering the UI. Additionally, there was no guard against using multiple XP Boosts or Task Limit Boosts simultaneously — a user could stack the same effect by using multiple identical items, breaking balance.
- **Fix:** `useItem` now `DELETE`s the inventory row when quantity reaches 0 (no ghost rows). Added active-effect guards: if an `xp_boost` or `task_limit_boost` is already active in Redis, reject the `useItem` call with a clear message. `getUserInventory` now filters with `quantity > 0` to exclude any pre-existing ghost rows.
- **Files:** `apps/api/src/modules/store/store.service.ts`

### F4. Cosmetic dedup guard was too narrow

- **Date:** 2026-06-16
- **Problem:** The cosmetic dedup guard in `purchaseItem` checked `{ userId, itemId, consumedAt: null }`. After the `is_consumable` fix (F2), cosmetics are no longer consumed, so this guard would always find a match and correctly block. But it was fundamentally wrong — cosmetics should be checked by `itemId` alone, not by `consumedAt`.
- **Fix:** Changed cosmetic dedup guard to `findFirst({ where: { userId, itemId } })` with no `consumedAt` filter. Cosmetics are permanent and never consumed; ownership is binary (owned or not).
- **Files:** `apps/api/src/modules/store/store.service.ts`

---

## New Features (Implemented in this session)

### N1. Cosmetic equip/unequip system

- **Problem:** Cosmetics had no mechanism to be "active" on a user's profile. Buying "Profile Theme: Neon" did nothing visible.
- **Fix:** Added `equipped` boolean field to `UserInventory`. New `PATCH /store/inventory/:id/equip` endpoint toggles equip state. Auto-equip on purchase. Only one cosmetic per `cosmeticType` can be equipped at a time; equipping one auto-unequips the other.
- **Frontend:** Inventory page shows "Equipped" badge and Equip/Unequip button for cosmetics (replacing the incorrect "Use" button). Store page shows "Owned" badge for any cosmetic the user already has.
- **Profile display:** Both `/profile` (own) and `/users/:username` (public) now show equipped cosmetic badges with color-coded styling (violet for themes, amber for frames).
- **Files:**
  - `apps/api/prisma/schema.prisma` — `equipped` field on `UserInventory`
  - `apps/api/src/modules/store/store.service.ts` — `equipCosmetic`, auto-equip in `purchaseItem`
  - `apps/api/src/modules/store/store.controller.ts` — `PATCH /store/inventory/:id/equip`
  - `apps/api/src/modules/users/users.service.ts` — `equippedCosmetics` in `getMe` and `getPublicProfile`
  - `apps/web/src/app/(dashboard)/store/inventory/page.tsx` — equip/unequip UI
  - `apps/web/src/app/(dashboard)/store/page.tsx` — owned badge logic fix
  - `apps/web/src/app/(dashboard)/profile/page.tsx` — render equipped cosmetics
  - `apps/web/src/app/(dashboard)/users/[username]/page.tsx` — render equipped cosmetics

---

## �� Critical

### C1. No rate limit on `POST /store/purchase` ✅ DONE

- **Problem:** Users can spam-purchase in a tight loop. Even with optimistic locking, timing exploits can drain credits or trigger unnecessary DB contention.
- **Fix:** Add `@Throttle` to `StoreController.purchaseItem` — 10 req/min is reasonable.
- **File:** `apps/api/src/modules/store/store.controller.ts`
- **Est:** 15 min
- **Status:** ✅ Complete — `@Throttle({ default: { limit: 10, ttl: 60 } })` already on `purchaseItem`.

### C2. Limited-quantity race condition ✅ DONE

- **Problem:** Current flow: `count(purchases)` → `check remaining` → `create(purchase)`. Under concurrent load, two users can both see 1 remaining and both buy it, overselling the limit.
- **Fix:** Added `SELECT ... FOR UPDATE` on the `StoreItem` row inside the Prisma `$transaction` before counting purchases. This serializes concurrent purchase attempts for the same limited item — the second transaction blocks until the first commits, then sees the updated count.
- **File:** `apps/api/src/modules/store/store.service.ts` (`purchaseItem`)
- **Status:** ✅ DONE 2026-06-17 — `tx.$executeRaw` `SELECT id FROM store_items WHERE id = ${itemId} FOR UPDATE` added before `tx.storePurchase.count()`.

### C3. Purchased items have zero functional effect ✅ DONE

- **Problem:** Users pay credits but boosts don't boost XP, streak freezes don't protect streaks, and task limit boosts don't add slots. The `UserInventory` records exist but nothing reads them. This is the #1 production trust risk.
- **Fix:** All three effects are wired and live:
  - `StoreService.useItem()` decrements inventory, calls `applyEffect()`, and writes Redis keys with TTL (`boost:xp:${userId}`, `boost:task_limit:${userId}`, `boost:streak_freeze:${userId}`).
  - `GamificationService.awardXp()` @ `gamification.service.ts:141` reads the active XP boost from Redis and applies the multiplier.
  - `TasksService.assignTask()` @ `tasks.service.ts:156` reads the active task-limit boost from Redis and adds bonus slots to the daily limit.
  - `GamificationService.claimDailyReward()` @ `gamification.service.ts:675` reads streak-freeze charges from Redis and protects the streak before breaking it.
  - Frontend inventory page has a working "Use" button calling `POST /store/inventory/:id/use`.
- **Files:**
  - `apps/api/src/modules/store/store.service.ts`
  - `apps/api/src/modules/store/store.controller.ts`
  - `apps/api/src/modules/gamification/gamification.service.ts`
  - `apps/api/src/modules/tasks/tasks.service.ts`
- **Status:** ✅ DONE — all effects wired and verified in code.

---

## 🟡 High

### H1. No cosmetic deduplication guard ✅ DONE

- **Problem:** A user can buy "VIP Badge: Gold Frame" twice, wasting 500 credits. The second purchase just increments `quantity` on an already-owned cosmetic.
- **Fix:** In `purchaseItem`, if `item.category === 'COSMETIC'` and `UserInventory` already has an unconsumed row for this item, throw `BadRequestException('You already own this cosmetic')`.
- **File:** `apps/api/src/modules/store/store.service.ts`
- **Est:** 20 min
- **Status:** ✅ Complete — cosmetic dedup guard already implemented in `purchaseItem`.

### H2. No "Owned" state in frontend `/store` ✅ DONE

- **Problem:** The store grid always shows "Buy" even if the user already owns the cosmetic. Bad UX.
- **Fix:** Frontend `/store` page calls `GET /store/inventory` in parallel with `GET /store/items`. The `ownedItemIds` set now correctly detects any inventory entry for an item (not just unconsumed). Non-consumable items (cosmetics) show "Owned" badge and a disabled "Owned" button.
- **File:** `apps/web/src/app/(dashboard)/store/page.tsx`
- **Est:** 30 min
- **Status:** ✅ Complete — `InventoryEntry` type updated with nested `item` field, `ownedItemIds` built from all inventory entries.

### H3. Mystery Gift Box loot reveal ✅ DONE

- **Problem:** Purchasing a Mystery Box just adds an unconsumed inventory row. There's no endpoint or logic to "open" it and receive a random reward. A box that can't be opened is confusing.
- **Fix:** `StoreService.openLootBox()` exists and rolls rewards: 50% credits (50–500), 30% XP boost (12h), 20% cosmetic. The `useItem` endpoint routes `effectType === 'loot_box'` to `openLootBox()`. Credits are credited to wallet, XP boost is written to Redis, or a cosmetic name is returned. The frontend "Use" button on the inventory page triggers this flow.
- **Files:**
  - `apps/api/src/modules/store/store.service.ts`
  - `apps/api/src/modules/store/store.controller.ts`
  - `apps/web/src/app/(dashboard)/store/inventory/page.tsx`
- **Status:** ✅ DONE — loot box open logic implemented and wired to `useItem`.

### H4. No purchase success notification / socket event ✅ DONE

- **Problem:** After a successful purchase, the user only knows it worked if the React Query invalidation refreshes the data before they navigate away. No explicit feedback.
- **Fix:**
  - API: In `StoreService.purchaseItem`, after the transaction commits, call `notificationsService.createNotification` (type `CREDIT_SPENT` or new `ITEM_PURCHASED`) and `eventsService.emitToUser(userId, 'store:purchased', { itemName, quantity, totalCost })`.
  - Frontend: `useSocketEvent('store:purchased', ...)` shows a toast or confetti animation.
- **Files:**
  - `apps/api/src/modules/store/store.service.ts`
  - `apps/web/src/app/(dashboard)/store/page.tsx`
- **Est:** 30 min
- **Status:** ✅ Complete — notification and socket event already emitted after successful purchase.

### H5. `getItems` leaks internal metadata to clients ✅ DONE

- **Problem:** `GET /store/items` returns `metadata` as-is. For the Mystery Box, this includes `possibleRewards` pool, revealing the odds. For boosts, it reveals internal multiplier values that could be exploited if frontend validation is ever added.
- **Fix:** `getItems` now returns an empty `{}` for `metadata` on all items. The store frontend does not consume any metadata fields — it only uses top-level item fields (`name`, `description`, `category`, `creditCost`, etc.).
- **File:** `apps/api/src/modules/store/store.service.ts`
- **Status:** ✅ DONE 2026-06-17 — `metadata: {}` returned for all public store items.

---

## 🟠 Admin / Operations

### A1. No admin CRUD for store items ✅ DONE

- **Problem:** To add, edit, or deactivate a store item, someone must write raw SQL or Prisma seed scripts. No admin UI or API exists.
- **Fix:** Add admin endpoints under `AdminController`:
  - `POST /admin/store/items` — create item
  - `PATCH /admin/store/items/:id` — update price, qty, dates, active flag
  - `GET /admin/store/items` — list all items (including inactive)
- **File:** `apps/api/src/modules/admin/admin.controller.ts`, `admin.service.ts`
- **Est:** 1 hour
- **Status:** ✅ Complete — full CRUD UI at `/admin/store` with create, edit, toggle active, effect type templates, metadata JSON editor, and purchase count stats.

### A2. No "grant item to user" support endpoint ✅ DONE

- **Problem:** Customer support cannot manually compensate a user with an item (e.g. refund in credits vs. items, or promotional giveaway).
- **Fix:** Admin endpoint `POST /admin/store/grant` that creates `UserInventory` and optionally a zero-credit `StorePurchase` record for audit.
- **File:** `apps/api/src/modules/admin/admin.controller.ts`
- **Est:** 30 min
- **Status:** ✅ Complete — `POST /admin/store/grant` with user search typeahead, quantity selector, and audit log + notification. UI in `/admin/store` "Grant Item" modal.

### A3. No store purchase analytics ✅ DONE

- **Problem:** No visibility into which items sell, revenue per item, conversion rate from store page to purchase.
- **Fix:** Track in `AnalyticsSnapshot` or create a new `StoreAnalytics` table with daily rollups per item. Also expose on the admin dashboard.
- **Files:**
  - `apps/api/prisma/schema.prisma` (new model or column additions)
  - `apps/api/src/modules/analytics/`
  - `apps/web/src/app/(admin)/admin/store/page.tsx`
- **Est:** 2 hours
- **Status:** ✅ Complete — added `storePurchases`, `storeCreditsSpent`, `storeTopItemId/Name/Count` to `AnalyticsSnapshot`. Daily snapshot cron rolls up store data. Admin endpoint `GET /admin/store/analytics` returns totals, per-item breakdown, and 30-day trends. Frontend `/admin/store` has Analytics tab with stat cards, revenue-by-item table, and daily trends table.

---

## 🟢 Polish

### P1. No quantity selector in frontend

- **Problem:** User can only buy 1x at a time. For stackables like Streak Freeze, buying 3 in a row is tedious.
- **Fix:** Add a `<select>` or +/- stepper in the store item card for `quantity` (1–99), bounded by `maxOwnedPerUser` and `limitedQty`.
- **File:** `apps/web/src/app/(dashboard)/store/page.tsx`
- **Est:** 30 min

### P2. No VIP tier gating on store items ✅ DONE

- **Problem:** Any user can buy any item. Premium cosmetics and guild perks should be gated behind VIP tiers to create aspiration.
- **Fix:** `requiredVipTierLevel` field already exists on `StoreItem`. `purchaseItem()` checks the user's VIP tier and rejects with a clear message if below the requirement. The frontend shows a lock icon and VIP requirement label.
- **Files:**
  - `apps/api/prisma/schema.prisma`
  - `apps/api/src/modules/store/store.service.ts`
  - `apps/web/src/app/(dashboard)/store/page.tsx`
- **Status:** ✅ DONE — backend enforcement live; frontend lock icon displays.

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

## Recommended Execution Order (Remaining Polish)

All critical, high, and admin items are complete. The store system is production-trustworthy. Remaining work is 🟢 polish only:

1. **P1** — Quantity selector in frontend (30 min)
2. **P3** — Item image/icon assets (10 min)
3. **P4** — Discount / promo code system (future sprint)

Total estimate: ~40 min of focused work for P1 + P3.

---

*Document created: 2026-06-16 | Next review: before starting Sprint 3 (Daily Reward 2.0, Spin Wheel)*
