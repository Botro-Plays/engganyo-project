# Proposal: player item marketplace (user-to-user item trading)

**Status: Ready for review (rev 2) — no implementation authorized.**

> **Interpretation correction (owner, 11 Nov 2026):** Jomar's request is a
> **player item marketplace**, not a credit-resale market. Users sell
> eligible inventory earned or obtained through Engganyo (e.g. boosts);
> buyers pay with **wallet credits** and sellers receive credits. Direct
> peer resale of credits themselves is **outside this marketplace's scope**.
> (Note: credits are not literally non-transferable — chat tipping already
> moves credits between users via `SPEND_TIP`/`EARN_TIP`; what this proposal
> excludes is a general credit-trading market.) Item trading does **not**
> automatically eliminate legal/regulatory review — credits are purchasable
> with money, so stored-value/e-money and tax questions still need review
> before launch.

## Audit — what already exists (main `a1153e8`)

| Layer | Path | State |
|---|---|---|
| Items | `apps/api/prisma/schema.prisma` — `StoreItem` (category, `creditCost`, `isConsumable`, `metadata` JSON, `maxOwnedPerUser`, `requiredVipTierLevel`, limited qty, sale window, `isActive`) | Implemented, **mutable catalog** |
| Inventory | `UserInventory` (`quantity`, `consumedAt`, `equipped`, `acquiredAt`) — **no per-unit attributes, expiry, or reservation column** | Implemented |
| Purchases | `StorePurchase` → `Transaction` ledger (`SPEND_STORE_PURCHASE`) | Implemented |
| Store purchase | `store.service.ts` `purchaseItem` — single `$transaction`, `SELECT ... FOR UPDATE` on item row, guards under lock, `walletService.debit`, inventory upsert in same tx | Implemented, strong pattern |
| Item use | `store.service.ts:369` `useItem` — **NOT transactional**: `findFirst` → checks → `applyEffect` (writes `user_active_effects`, `user.streakFreezeCharges`, Redis; loot box RNG + reward grants) → then `userInventory.update/delete`. No row lock, no `$transaction` | Implemented with **known race surface** |
| Equip | `store.service.ts:531` `equipCosmetic` — **NOT transactional**: read → per-type unequip loop → `equipped` flag writes | Implemented with same race surface |
| Admin grant | `admin.service.ts:3122` `grantStoreItem` — read-then update/create on `user_inventory` | Implemented, same race surface |
| Activated effects | `UserActiveEffect` (`expiresAt`) — separate from inventory | Implemented |
| Admin | store item CRUD + grant | Implemented |
| Wallet | `wallet.service.ts` `credit`/`debit` + `Transaction` ledger | Implemented |
| Live catalog | 2 BOOST, 2 COSMETIC, 2 CONVENIENCE items; `CREDIT_PACK`/`GUILD_PERK` unused; prod ~1 tradable inventory row | Verified via VPS DB |
| Branches | All 72 remote heads checked; only `fix/transfers-purchases-atomicity` (`372e2a8`) touches this area — **merged** (it added the purchase lock) | Clean |

**Foundation vs feature:** the store engine is a complete foundation, but
`useItem`, `equipCosmetic`, and `grantStoreItem` are **non-transactional
read-modify-write sequences**. Any marketplace reservation scheme must
coordinated-lock **all** inventory writers, not just listing/purchase.

## The concurrency problem (rev-1 correction)

Rev 1 claimed "escrow by decrement" makes use/equip races impossible. That
was wrong. `useItem` reads the inventory row, applies the effect with its
own writes, then writes `quantity - 1` or deletes the row — all outside a
transaction and without a lock. Concrete interleaving:

1. Inventory `qty=2`. `useItem` reads `qty=2`.
2. `createListing(qty=1)` decrements inventory to `qty=1` (escrow).
3. `useItem` finishes `applyEffect`, then writes `quantity = 2-1 = 1`
   (stale) or deletes the row.
4. Result: **phantom unit** — listing holds 1, effect applied once, yet
   inventory still shows 1 usable unit that no longer exists (or a
   delete-vs-update conflict error mid-flow).

Worse, `applyEffect` commits `user_active_effects`/streak credits **before**
the inventory decrement — a failure between them leaves the effect granted
with the item retained (free effect) or vice versa.

### Required coordinated design

Every writer of a given `user_inventory` row must serialize on the same
row lock inside one transaction:

- **`createListing` / `cancelListing` / expiry sweep**: tx → `SELECT ... FOR
  UPDATE` on inventory row → move qty inventory→listing (or back) → commit.
- **`useItem` (refactor)**: wrap in `$transaction`; lock the inventory row
  `FOR UPDATE`; re-validate `quantity`, `consumedAt`, consumable; perform
  the **consumption decrement inside the same tx**; apply the
  `UserActiveEffect`/streak/loot-box DB writes **inside the same tx** so
  effect+consume commit or roll back together. Redis cache writes stay
  best-effort **post-commit** (they already tolerate failure). Loot-box RNG
  reward grants must join the tx.
- **`equipCosmetic` (refactor)**: same — lock row, re-validate, flag writes
  in tx; listing creation must reject `equipped=true` rows (or auto-unequip
  inside its tx).
- **`grantStoreItem` / purchase fulfillment / marketplace receipt**: all
  inventory upserts take the same row lock (or insert path is naturally
  race-free via unique `(userId,itemId)`).
- **Conditional decrement**: consumption uses
  `UPDATE ... SET quantity = quantity - 1 WHERE id = ? AND quantity >= 1`
  (or row-lock + recheck) so a stale read can never resurrect units.

With all writers locking the same row, listing-vs-use and
cancel-vs-purchase serialize deterministically: whichever tx commits first
wins; the loser re-reads post-lock state and gets a clean
`ITEM_BUSY`/`LISTING_UNAVAILABLE`/`INSUFFICIENT_STOCK` error — never a
phantom unit or double settlement.

## History preservation (rev-1 correction)

Rev 1 said "delete row at 0" — wrong: orders reference listings, so
listings are **never deleted**. Terminal states:

```
ACTIVE → SOLD_OUT (remainingQuantity = 0, keeps listing for history)
       → CANCELLED (seller; qty returned to inventory)
       → EXPIRED (auto-cancel after listing TTL)
       → REMOVED (admin takedown; qty returned, reason logged)
```

`marketplace_listings` retains `originalQuantity`, `remainingQuantity`,
`unitPrice`, `sellerId`, `itemId`, `itemSnapshot`, `status`, timestamps.
`marketplace_orders` links listing + buyer + seller + qty + price +
transaction ids — the permanent audit record for both sides' history views.

## Purchase idempotency & wallet locking (rev-1 correction)

- **Buyer-scoped idempotency:** `purchaseKey` is unique per
  `(buyerId, purchaseKey)` — enforced by a unique constraint checked and
  inserted **inside the settlement transaction**, not as a pre-check.
  Retried/double-clicked buys return the existing order.
- **Key reuse with different params:** same `purchaseKey` + different
  `listingId`/`quantity`/`unitPrice` → `409 IDEMPOTENCY_KEY_REUSED` (the
  stored order's params are compared inside the tx; mismatch rejects, no
  second debit).
- **Reciprocal purchases / deadlocks:** two buyers purchasing each other's
  listings (or any cycle) must not deadlock. Wallet rows are locked in
  **deterministic order** — sort participant `userId`s and acquire wallet
  locks in that order inside the tx (or lock the listing row first, then
  wallets sorted by id). Whole-transaction retry (bounded, e.g. 3×) on
  Postgres serialization/deadlock errors (`P2034`/40P01) as a backstop —
  same pattern class as the referral-balance fix (PR #52).

## Item restrictions on resale and receipt (rev-1 correction)

Referencing mutable `StoreItem` alone does **not** preserve advertised
attributes — admin edits to `metadata`, price, or `isActive` would silently
change what a listing delivers. Required rules:

- **Binding snapshot:** at listing creation, copy the advertised attributes
  into `marketplace_listings.itemSnapshot` — `itemId`, `name`, `category`,
  `isConsumable`, full `metadata` (effectType, multiplier, durationHours,
  bonusSlots, protectedDays, possibleRewards), and a `catalogVersion`/
  `storeItem.updatedAt` marker. The listing advertises the snapshot, not
  the live row.
- **Fulfillment rule:** purchase delivers the **snapshot** attributes.
  Implementation choice at build time: (a) listings only allowed for items
  whose snapshot still matches catalog at purchase time (strict — listing
  auto-pauses `CATALOG_CHANGED` if admin edits the item), or (b) snapshot
  is authoritative and fulfillment materializes attributes independent of
  later catalog edits. Recommend (a) for launch — simpler, prevents
  advertising-then-nerfing.
- **Deactivated items (`isActive=false`):** existing listings auto-pause;
  new listings rejected. Already-listed units remain fulfillable only if
  snapshot matches at sale time under rule (a); otherwise listing pauses
  until seller cancels.
- **Buyer-side restrictions at receipt:** re-check `maxOwnedPerUser`,
  `requiredVipTierLevel`, and item eligibility **inside the purchase tx**
  against the *buyer* — if the buyer can't validly own the item (VIP gate,
  ownership cap already reached via other inventory), purchase rejects
  `BUYER_INELIGIBLE` and nothing moves. Note `maxOwnedPerUser` semantics
  must be defined for stacked quantities.
- **Seller-side at listing:** item must be unused (`consumedAt IS NULL`),
  unequipped (cosmetics), and seller must pass account-status checks.
- **Cancellation returns:** qty returns to the seller's `user_inventory`
  under the same row lock; if the row was deleted meanwhile (fully
  consumed), it's re-created. Returned units remain usable even if the
  catalog item is later deactivated — inventory ownership is independent
  of storefront availability (same as today).
- **Equipped cosmetics:** `equipped=true` rows are not listable; the Sell
  action prompts "Unequip to sell" (or unequips inside the listing tx —
  decide; recommend requiring manual unequip for clarity).

## Product shape

New top-level section **`/marketplace`** — distinct from the platform Store
(the Store sells platform items; the marketplace trades player-owned
inventory). Credit resale is out of scope; credits remain the settlement
currency only.

### Browse / detail / history

- Grid of ACTIVE listings: item art/name, quantity, price/unit (credits),
  seller username (+ reputation badge), listed time, time remaining.
- Filters: category (Boost / Convenience / Cosmetic), price sort, seller.
- Detail: snapshot attributes (e.g. "+5 slots / 48h"), seller card,
  quantity selector, total, Buy.
- **My listings**: active/pending/sold/cancelled/expired history.
- **Purchase/sale history**: both sides, linked transaction ids.

```
Desktop                                        Mobile (390px)
┌──────────────────────────────────────┐       ┌─────────────────────┐
│ Marketplace   [All][Boost][Cons..]   │       │ Marketplace         │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐          │       │ [All][Boost][Cons]  │
│ │item│ │item│ │item│ │item│          │       │ ┌───┐ ┌───┐ ┌───┐   │
│ └────┘ └────┘ └────┘ └────┘          │       │ │item│ │item│ │item│  │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐          │       │ └───┘ └───┘ └───┘   │
│ │item│ │item│ │item│ │item│          │       │  ‹ 1 2 3 ›         │
│ └────┘ └────┘ └────┘ └────┘          │       └─────────────────────┘
│ My listings | Purchase history       │
└──────────────────────────────────────┘
```

## Tradability matrix (launch proposal)

| Item class | Examples | Listable? | Rule |
|---|---|---|---|
| Unused consumable boost | XP Boost, Task Limit Boost, Streak Freeze | ✅ Yes (launch) | `consumedAt IS NULL`, sitting in `user_inventory` |
| Unopened loot box | Mystery Gift Box | ✅ Yes (launch) | Tradable only unopened; contents resolve at open time to the opener |
| Non-consumable cosmetic | Neon, Gold Frame | ⚠️ Owner decision | Proposed: yes, unequipped only; buyer receives unequipped |
| Activated effect | Active boost in `user_active_effects` | ❌ No | Not inventory; cannot be listed or transferred |
| Expired/bound items | n/a today | ❌ No | Gate added if per-unit expiry ever introduced |
| Credits / points | wallet balance, P2P points | ❌ No | Credit resale out of scope; points are reputation |

## Lifecycle

```
SELLER                          PLATFORM                        BUYER
  │ create listing (qty, price)   │                                │
  ├──────────────────────────────►│ tx: lock inventory row,        │
  │                               │  move qty inventory→listing    │
  │ cancel ──────────────────────►│ tx: lock listing, return qty   │
  │                               │                                │
  │                    buy ──────►│ ONE tx: lock listing (sorted   │
  │                               │  wallet locks), idempotency    │
  │                               │  check, debit buyer, credit    │
  │                               │  seller (−fee→platform), move  │
  │                               │  qty listing→buyer inventory,  │
  │                               │  write order + ledger rows     │
  │◄──────────────────────────────┤                                │
  │ EARN_MARKETPLACE_SALE (+fee)  │ SPEND_MARKETPLACE_PURCHASE      │
```

## Edge cases

| Case | Proposed behavior |
|---|---|
| Insufficient funds | Debit fails inside tx → full rollback; `INSUFFICIENT_FUNDS`; listing untouched |
| Self-purchase | Reject `sellerId === buyerId` pre-tx (also blocks fee-evasion wash trades) |
| Duplicate listings | Decision: one ACTIVE listing per (seller,item) recommended |
| Listing vs use/equip race | Serialized by shared row lock (see coordinated design); loser gets clean error |
| Cancel vs purchase race | Both lock listing row; first commits, second gets `LISTING_UNAVAILABLE` |
| Forged attributes | Client sends only `itemId`+qty+price; attributes come from server-side snapshot |
| Suspended accounts | `user.status` checked inside tx both sides; suspended seller's listings auto-unpublish + qty returns |
| Admin takedown | `status=REMOVED`, qty returns, order history preserved, reason logged |
| Buyer ineligible | `BUYER_INELIGIBLE` if VIP/cap checks fail at receipt; nothing moves |
| Catalog changed mid-listing | Listing pauses `CATALOG_CHANGED` under fulfillment rule (a) |
| Idempotent retry | Same key+params → existing order; same key+diff params → 409 |
| Reciprocal purchase deadlock | Sorted wallet locking + bounded whole-tx retry |

## Owner decision table — proposed defaults

| Decision | Proposed default | Alternatives |
|---|---|---|
| Launch categories | Unused consumables only (BOOST + CONVENIENCE); cosmetics deferred | Include unequipped cosmetics v1 |
| Fee | 5% of sale price, rounded **down** to whole credits; `PLATFORM_FEE_MARKETPLACE` ledger row | 0% launch fee; or fee rounded to nearest |
| Price bounds | Min 10cr, max 100,000cr per unit | Different floor/ceiling |
| Listing expiry | 7 days → auto-CANCELLED, qty returns | 3d / 14d / never |
| Relisting | Seller may manually relist cancelled/expired items; no auto-relist | Auto-relist once; unlimited |
| Duplicate listings | One ACTIVE listing per (seller,item) | Multiple concurrent listings |
| Equipped cosmetics | Must unequip manually before listing | Auto-unequip inside listing tx |

## Scope estimate (planning only)

- API: `marketplace` module — listings CRUD + terminal-state sweep,
  purchase/cancel with idempotency, history; ~3 new tables
  (`marketplace_listings`, `marketplace_orders`, purchase idempotency);
  3 ledger types; admin takedown; **plus the useItem/equipCosmetic/grant
  transactional refactor** (required, not optional).
- Web: `/marketplace` pages, sell flow on `/store/inventory`, nav entry.
- Tests: real-PG specs — **listing-vs-use race, cancel-vs-purchase race,
  concurrent buyers, insufficient funds, self-purchase, idempotency-key
  reuse/mismatch, reciprocal-purchase deadlock retry, fee math,
  exactly-once settlement, snapshot-vs-catalog-change**; E2E browse→list→
  buy→use.

## Open questions for the owner

1. Approve consumables-only v1 (cosmetics deferred)?
2. Fee % and rounding rule?
3. Price floor/ceiling?
4. Listing TTL?
5. Manual relist only, or auto-relist?
6. Legal/tax review owner for credit-denominated item trading?
