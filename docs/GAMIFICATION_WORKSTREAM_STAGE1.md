# Gamification Workstream — Stage 1: Source Audit, Inventory Invariants, Marketplace Launch Plan

Status: Stage 1 inventory-safety fix **merged and deployed** — PR #69 → main `0fa7a07`, Deploy run `42979865842` all jobs green, containers healthy, `engganyo.com` + `/api/health` OK (db+redis ok) as of 2026-11-11T07:45Z. Migration `20261111000000_user_inventory_unique` applied by deploy. Marketplace/progression economics remain unimplemented pending owner approval.

---

## 1. Source audit — reward creation, stacking, repeatability

Traced on `main` @ `a1153e8`. Full path list below; defects marked ⚠.

### Wallet / ledger foundation
- `wallet.service.ts` — `credit()`/`debit()` via `executeWithOptimisticLock` (version CAS, 5 retries → `WalletContentionException`), ledger `Transaction` + `user.creditBalance` mirror in same tx. **No idempotency key on `Transaction`** — exactly-once relies entirely on upstream row-transition guards.
- `completeDeposit()` — strong CAS guard on `status ∈ {PENDING,PROCESSING}` + `paymentRef @unique`; all rails (PayMongo/PayPal/USDT/admin) converge here. ⚠ **VP bug**: `amountFiat × 10` uses gateway currency — PHP PayMongo deposits earn ~58× intended VP (`wallet.service.ts:755,785`). ⚠ VP awarded post-commit, fire-and-forget — crash loses it.

### Reward sources and rates
| Source | Credits | XP | VP | Repeatable? | Guard |
|---|---|---|---|---|---|
| Welcome bonus (`auth.service.ts`) | 200 | — | — | once | registration tx |
| Daily reward (`gamification.service.ts:673`) | `min(50+(streak−1)×10, 200)` | 20 | 1/10/25/50 @ streak 1/7/14/30 | daily | CAS on `lastDailyRewardAt` — solid |
| Auto-verify task (`tasks.service.ts:507`) | pool amount | 50 | 1 | per user/campaign | `@@unique(campaignId,userId)` + claim CAS — solid |
| Manual review (campaign creator `campaigns.service.ts:384`, admin `admin.service.ts:686`) | same | **none** ⚠ | 1 | per completion | claim CAS solid; ⚠ **missing XP/mission/achievement/milestone side-effects** vs auto-verify |
| Challenge approve (`challenges.service.ts:642`) | reward | **none** ⚠ | yes | once | CAS solid; ⚠ no XP, no referral/milestone |
| Admin challenge review (`admin.service.ts:769`) | reward/refund | none | 1 | once | CAS solid; ⚠ gamification gaps |
| Campaign create (`campaigns.service.ts:202`) | — | `XP_REWARDS.CAMPAIGN_CREATE=30` **never awarded** ⚠ | 5 VP | per campaign | debit+fee+revenue in tx |
| Wheel spin (`gamification.service.ts:1093`) | 5/10/25/100 prizes | — | — | free daily + paid 20cr | `WheelSpinAttempt @@unique(userId,key)` in settlement tx — excellent idempotency; ⚠ paid debit mislabeled `SPEND_STORE_PURCHASE` |
| Mission complete | `EARN_MISSION_COMPLETE` | via awardXp | — | per mission | ⚠ `updateMissionProgress` read-modify-write, **double-pay + lost payout windows** |
| Achievement unlock | per config | — | — | once | ⚠ `unlockAchievement` commits row before credit — `WalletContentionException` loses payout permanently |
| Referral milestones (`referrals.service.ts`) | 10–200 | — | — | once each | `FOR UPDATE` + flag + credits in tx + retry — solid ⚠ sign_up fire-and-forget can be lost |
| Tips/rain (`channels.service.ts`) | transfers | — | — | repeatable | debit+credit in one tx ⚠ no idempotency key (retry double-tips); budget is Redis-only TOCTOU |
| Store purchase (`store.service.ts`) | — | — | — | repeatable | `store_items FOR UPDATE` + all guards under lock — solid |
| Loot box (`useItem`→`openLootBox`) | 50–500 (50%) | xp_boost 12h (30%) | — | per item | ⚠ **was non-atomic — fixed in PR #69** |

### Dead/unreachable reward config
- `XP_REWARDS.CAMPAIGN_CREATE` defined, never awarded.
- 6 of 7 `MissionType`s never incremented — only `COMPLETE_N_TASKS` is ever passed (always via `'COMPLETE_N_TASKS' as never` cast); seeded `EARN_N_CREDITS`/`CREATE_CAMPAIGN` missions can never progress.

### ⚠ Demonstrated defects (prioritized)

| # | Sev | Defect | Status |
|---|---|---|---|
| 1 | High | `useItem` non-atomic apply-then-consume → double rewards | **Fixed PR #69** |
| 2 | High | `updateMissionProgress` race → double-pay/lost payout | Open — next PR |
| 3 | High | `awardXp`/`awardVp` lost-update on `user.xp`/`user.vp` | Open |
| 4 | High | `unlockAchievement` row-before-credit → lost payout | Open |
| 5 | Med | Deposit VP uses PHP `amountFiat` × per-dollar rate → ~58× VP inflation | Open |
| 6 | Med | Manual-review paths skip XP/mission/achievement/milestone | Open |
| 7 | Med | Only `COMPLETE_N_TASKS` missions progress; campaign XP dead | Open |
| 8 | Med | No campaign-completion expiry sweep → `pending_slots` leak blocks refunds | Open |
| 9 | Low | Tip/rain budget TOCTOU + no tip idempotency | Open |
| 10 | Low | `UserActiveEffect` no `(userId,type)` unique; cosmetic purchase P2002 → rollback not 409; `P2pPointEvent.reversedAt` never written | Documented follow-ups |

---

## 2. Inventory invariants (enforced by PR #69)

Schema: `@@unique(userId,itemId)` on `user_inventory` — **one row per user per item**; `quantity` is the stack depth. `consumedAt`/`equipped` are row flags.

| # | Invariant | Mechanism |
|---|---|---|
| I1 | A unit cannot be both consumed and sellable | All mutators serialize on the inventory row (`SELECT … FOR UPDATE`) or the `(userId,itemId)` upsert key |
| I2 | Effect application and consumption commit atomically | `useItem`/`openLootBox` run inside the caller's `$transaction`; any failure rolls back both |
| I3 | Redis is never authoritative | Effect caches sync post-commit from DB (`syncEffectCaches`); cache failure cannot consume an item without delivering benefit — readers fall back to DB |
| I4 | One stack per (user,item) | Unique index + upsert in `purchaseItem`, `grantStoreItem`, daily/wheel loot-box grants |
| I5 | Cosmetic equip state is consistent | `equipCosmetic` tx unequips same-`cosmeticType` rows and sets target under one row lock |
| I6 | Purchase guards re-validate under lock | VIP tier, `maxOwnedPerUser`, dedup, limited qty, active window all checked after `store_items FOR UPDATE` |

**Marketplace-facing invariants (to enforce when listings land):**
- I7: listing reservation = conditional decrement/flag inside the same tx discipline — a listed unit is invisible to `useItem`/`equip`/other listings.
- I8: terminal listings (`SOLD_OUT`/`CANCELLED`/`EXPIRED`/`REMOVED`) are never deleted; orders link listing+buyer+seller+tx ids permanently.
- I9: purchase = claim stock + debit buyer + credit seller − fee + transfer inventory + ledger rows in ONE tx; buyer-scoped idempotency key enforced atomically; same key + different params → `409 IDEMPOTENCY_KEY_REUSED`.
- I10: marketplace settlement awards **no** XP/VP/P2P points/trading-volume rewards.

---

## 3. Item provenance & binding spec

- Every inventory row should carry provenance: `acquiredVia` (`PURCHASE`/`ADMIN_GRANT`/`REWARD_DAILY`/`REWARD_WHEEL`/`REWARD_ACHIEVEMENT`/`REWARD_REFERRAL`/`WELCOME`/`MARKETPLACE`) + `sourceId` (purchase/tx id). **Not yet implemented** — requires schema column; proposed for marketplace PR.
- Binding rules (proposed, pending owner):
  - `WELCOME` + repeatable login/daily rewards → **account-bound** at launch.
  - Store-purchased and earned-task rewards → tradable only if owner approves category.
  - Audit existing inventory before assigning binding retroactively (prod has ~1 tradable row — trivial).
- Advertised attributes: listing captures an immutable `itemSnapshot` (metadata + catalog version marker); if the catalog item is later edited/deactivated, listing pauses `CATALOG_CHANGED` rather than silently transferring mutated attributes.
- Cosmetics: equipped items are not listable unless explicitly unequipped (proposed default: manual unequip required).

---

## 4. Marketplace launch plan (recommendation — economics pending approval)

- **Categories**: unused BOOST + CONVENIENCE consumables only. Loot boxes reviewed separately (RNG contents make attribute preservation complex). Cosmetics deferred.
- **Terms**: 7-day listings, manual relisting, max 5 active listings/seller, one active listing per item.
- **Fee test path**: deploy with **0% fee** first; verify with labeled test accounts (exact ledger/inventory outcomes). Then enable **5% seller fee** as a config flag.
- **5% fee rounding — proposed**: 5% of **order total**, `floor` to whole credits, **once per order** (not per unit). Examples: 1×33cr → fee 1cr, seller +32; 3×33cr=99cr order → fee 4cr (per-unit would give 3×1=3cr — rejected); 2×10cr=20cr → fee 1cr, seller +19; 100×100cr=10,000cr → fee 500cr.
- **Price bounds** (proposed defaults pending approval): 10–100,000 credits.
- **Purchase flow**: review screen shows quantity, unit price, buyer total, seller proceeds, fee, binding, effect details before confirm. Reciprocal purchases: sorted wallet-lock ordering + bounded whole-tx retry.
- **Tests required before launch** (real-PG in CI): listing-vs-use, cancel-vs-purchase, purchase-vs-use, concurrent buyers, idempotency-key reuse (same + different params), buyer caps/VIP on receipt, failed effect application, grants racing listing, catalog deactivation mid-listing.

---

## 5. Owner decision table — to start the item marketplace

| # | Decision | Proposed default |
|---|---|---|
| D1 | Launch tradable categories | Unused BOOST + CONVENIENCE consumables only; loot boxes/cosmetics deferred |
| D2 | Fee | 0% for labeled-account test, then 5% seller fee, floor per order |
| D3 | Price bounds | 10–100,000 credits per unit |
| D4 | Listing expiry | 7 days, manual relist |

Deferred (non-blocking): max active listings/seller (5), binding assignment for welcome/daily rewards (account-bound), legal/accounting review owner, cosmetic tradability.

---

## 6. Stage status

- **Deployed SHA**: `0fa7a07` on main (squash of PR #69, head `440260b`), deployed 2026-11-11 ~07:42Z via Deploy run `42979865842` — CI API/Web/E2E green, all containers healthy.
- **Branch CI**: run `42978454459` green after one fix round (test-double repairs + advisory-lock serialization of same-type active effects).
- **Local verification**: `tsc --noEmit` clean; `store.service.spec.ts` + `gamification.service.spec.ts` 39/39; integration spec compiles and ran green in CI against real Postgres.
- **Remaining gaps**: defects #5–#10 above (deposit-VP currency bug, manual-review gamification gaps, mission/XP/achievement atomicity, campaign slot sweep, tip idempotency); provenance column; marketplace implementation.
- **Next concrete decision**: owner approval of D1–D4 (or amendments) unblocks marketplace PR; defects #2–#4 (`updateMissionProgress`, `awardXp`/`awardVp`, `unlockAchievement`) are the recommended next fix PR regardless.
