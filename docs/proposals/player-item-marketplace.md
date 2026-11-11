# Proposal: player item marketplace (user-to-user item trading)

**Status: Ready for review — no implementation authorized.**

> **Interpretation correction (owner, 11 Nov 2026):** Jomar's request is a
> **player item marketplace**, not a credit-resale market. Users sell
> eligible inventory earned or obtained through Engganyo (e.g. boosts);
> buyers pay with **wallet credits** and sellers receive credits. The
> earlier "credit trading" draft (`credit-trading.md`, peer transfer of
> credits) is **superseded** — credits themselves remain non-transferable.
> This also removes the stored-value/e-money legal gate that applied to
> credit resale; item trading moves existing platform inventory, not money.

## Audit — what already exists (main `a1153e8`)

| Layer | Path | State |
|---|---|---|
| Items | `apps/api/prisma/schema.prisma` — `StoreItem` (category, `creditCost`, `isConsumable`, `metadata` JSON, limited qty, VIP gate, sale window) | Implemented |
| Inventory | `UserInventory` (`quantity`, `consumedAt`, `equipped`, `acquiredAt`) — **no per-unit attributes or expiry column** | Implemented |
| Purchases | `StorePurchase` → `Transaction` ledger (`SPEND_STORE_PURCHASE`) | Implemented |
| Store purchase | `apps/api/src/modules/store/store.service.ts` `purchaseItem` — single `$transaction`, `SELECT ... FOR UPDATE` on item row, all eligibility guards under the lock, `walletService.debit`, idempotent-ish via transaction link | Implemented, strong pattern to reuse |
| Item use | `useItem` — applies effect FIRST, consumes only on success; `xp_boost`, `task_limit_boost`, `streak_freeze`, `task_refresh`, `loot_box` (`EARN_LOOT_BOX`) | Implemented |
| Equip | `equipCosmetic` for non-consumables; `equipped` flag on inventory row | Implemented |
| Activated effects | `UserActiveEffect` (xp/task-limit boosts with `expiresAt`) — separate from inventory | Implemented |
| Admin | `admin.controller.ts` store item CRUD + `grantStoreItem` | Implemented |
| Wallet | `wallet.service.ts` `credit`/`debit(userId, amount, opts, tx?)` + `Transaction` ledger + `TransactionType` enum | Implemented |
| Live catalog | Prod `store_items`: 2 BOOST (XP 24h 150cr, Task Limit +5 200cr), 2 COSMETIC (Neon 350cr, Gold Frame 500cr), 2 CONVENIENCE (Streak Freeze 100cr, Mystery Box 120cr). `CREDIT_PACK`/`GUILD_PERK` enums unused. Prod `user_inventory`: **1 row total** | Verified via VPS DB |
| Open branches/PRs | No store/marketplace/trading branches or PRs. Checked all 72 remote heads: only store-adjacent branch `fix/transfers-purchases-atomicity` (`372e2a8`) is **merged** (A07 atomic store/tips/rain purchases — the locked pattern this proposal reuses). `feat/web-discoverability` (`d858b68`) is the only unmerged feature branch and is unrelated (SEO). | Clean |

**Foundation vs feature:** the store engine (items, inventory, locked
purchase, use/equip, effects, ledger) is a complete foundation. A
user-to-user marketplace is a **new feature** — nothing today lets a user
resell inventory; `UserInventory` has no reservation/transfer concept.

## Product shape

New top-level section **`/marketplace`** (distinct from the platform Store —
the Store sells platform items for credits; the marketplace trades
player-owned inventory between users).

### Browse / detail

- Grid of active listings: item art/name, quantity, price per unit (credits),
  seller username (+ optional reputation/XP badge), listed time, time left.
- Filters: category (Boost / Convenience / Cosmetic), price sort, seller.
- Item detail: full description, item metadata (e.g. "+5 slots / 48h"),
  seller card, quantity selector, total price, Buy button.
- **My listings** tab: active/pending/sold history, cancel, relist.
- **Purchase/sale history**: per-user ledger view (linked transaction ids).

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

### Listing creation (from `/store/inventory`)

"Sell" action on eligible inventory rows → quantity + price per unit →
confirm reservation → listing live.

## Tradability matrix (proposed launch rules)

| Item class | Examples (live catalog) | Listable? | Rule |
|---|---|---|---|
| Unused consumable boost | XP Boost, Task Limit Boost, Streak Freeze | ✅ Yes | Only while sitting in `user_inventory` (`consumedAt IS NULL`). Once `useItem` runs, the effect moves to `UserActiveEffect` and is **not tradable** — the buyer would get nothing. |
| Unopened loot box | Mystery Gift Box | ✅ Yes | Tradable only while unopened (`consumedAt IS NULL`). Opening resolves contents to the opener — contents are RNG at open time, so the box itself is the asset. |
| Non-consumable cosmetic | Neon theme, Gold Frame | ⚠️ Proposed: yes, unequipped only | Must be `equipped=false` to list (equipped items show "Unequip to sell"). On transfer buyer receives it unequipped. Owner decision below. |
| Activated effect | Active XP/task-limit boost | ❌ No | Lives in `user_active_effects`, not inventory — cannot be listed, gifted, or transferred. |
| Expired/bound items | n/a today | ❌ No | No per-unit expiry exists on inventory rows; if expiry is added later it must gate listing. |
| Credits / points | wallet balance, P2P points | ❌ No | Explicitly out of scope — credits are not items; points are reputation. |

**Attribute preservation:** item attributes live on `StoreItem.metadata`
(effect type, multiplier, duration) and are referenced by `itemId` — a
transfer moves the inventory row reference, so attributes travel intact.
No per-unit attribute snapshot is needed for launch categories; if
per-unit variance is ever introduced (e.g. different durations), listings
must snapshot attributes into the listing row — flagged as a schema
dependency, not needed now.

## Lifecycle & atomicity

```
SELLER                          PLATFORM                        BUYER
  │ create listing (qty, price)   │                                │
  ├──────────────────────────────►│ reserve qty OUT of usable      │
  │                               │ inventory (escrow)             │
  │ cancel ──────────────────────►│ release qty back to inventory  │
  │                               │                                │
  │                    buy ──────►│ ONE tx: lock listing,          │
  │                               │  debit buyer, credit seller    │
  │                               │  (−fee→platform), move qty     │
  │                               │  listing→buyer inventory,      │
  │                               │  write both ledger rows        │
  │◄──────────────────────────────┤                                │
  │ EARN_MARKETPLACE_SALE (+fee)  │ SPEND_MARKETPLACE_PURCHASE      │
```

**Reservation model (recommended):** listing creation moves quantity out of
`user_inventory` into the listing (`marketplace_listings.quantity`) inside
the same transaction — "escrow by decrement". Usable inventory can never
include listed units, so `useItem`/`equipCosmetic`/re-listing need **zero
changes** and can never race a listing. Cancel/sale-expiry credits the
quantity back. Alternative (`reservedQuantity` column on inventory) was
rejected: it requires auditing every consume/equip path for the reserved
remainder — more surface, same guarantee.

**Purchase transaction** (mirrors `purchaseItem`'s proven pattern):

1. `SELECT ... FOR UPDATE` on the listing row → re-validate `ACTIVE`, qty, price.
2. Lock buyer wallet via `walletService.debit` (`SPEND_MARKETPLACE_PURCHASE`).
3. `walletService.credit` seller (`EARN_MARKETPLACE_SALE`, net of fee) +
   `PLATFORM_FEE_MARKETPLACE` revenue row if fee approved.
4. Decrement listing qty (delete row at 0); upsert buyer `user_inventory`.
5. Write `marketplace_orders` history row (listing, buyer, seller, qty,
   unit price, fee, transaction ids) — the audit record for both sides.
6. Idempotency: client-generated `requestKey` unique per purchase attempt —
   a retried/double-clicked buy returns the existing order, never a second
   debit. Concurrent buyers serialize on the listing row lock; second buyer
   sees reduced qty or `LISTING_SOLD_OUT`.

**New ledger types needed:** `SPEND_MARKETPLACE_PURCHASE`,
`EARN_MARKETPLACE_SALE`, `PLATFORM_FEE_MARKETPLACE` (naming TBD at review).

**Accounting example (5% fee, illustrative):** buyer purchases 2 × XP Boost
@ 60cr each = 120cr. One tx writes:

| Entry | Amount | Balance effect |
|---|---|---|
| `SPEND_MARKETPLACE_PURCHASE` (buyer) | −120 | buyer wallet −120 |
| `EARN_MARKETPLACE_SALE` (seller) | +114 | seller wallet +114 |
| `PLATFORM_FEE_MARKETPLACE` (platform) | +6 | platform revenue +6 |

Sum of credit legs = 0 within the tx (120 = 114 + 6); the `marketplace_orders`
row links all three transaction ids plus listing/buyer/seller/qty/price for
audit. If fee is 0% at launch, only the two user legs are written.

## Edge cases (all must be specified before build)

| Case | Proposed behavior |
|---|---|
| Insufficient funds | Debit fails inside tx → whole purchase rolls back; listing untouched; clear "not enough credits" error. |
| Self-purchase | Reject `sellerId === buyerId` before tx (also blocks wash-trading for fee evasion / points farming). |
| Duplicate listings | Allow multiple listings per item **or** one active listing per (seller,item) — decision; recommend one active per item+price-tier for simplicity. |
| Purchase vs cancel/use race | Impossible by construction: listed qty is out of inventory; cancel and purchase both lock the listing row — first wins, second gets `LISTING_UNAVAILABLE`. |
| Forged attributes | Attributes come from `StoreItem` server-side; listing stores only `itemId`+qty+price — client cannot inject metadata. Price is the only user input → bound it (below). |
| Suspended/banned accounts | Check `user.status`/suspension inside the tx for both parties; suspended seller's listings auto-unpublish + qty returns; suspended buyer cannot purchase. |
| Admin takedown | `listing.status = REMOVED` → qty returns to seller inventory, order history preserved, reason logged. Reuses admin tooling patterns. |
| Listing expiry | Auto-cancel after N days (proposed 7) → qty returns; sweep job like the room-expiry pattern. |
| Partial purchase | Buyer may buy 1..listed qty; listing stays ACTIVE with remainder. |

## Economics decisions for approval

1. **Launch categories:** unused consumables only (BOOST + CONVENIENCE),
   cosmetics deferred? — recommend consumables-only v1 (simplest matrix,
   no equip edge cases).
2. **Fee:** proposed 5% platform fee on sale proceeds — or 0% for launch?
3. **Price bounds:** proposed min 10cr, max 100,000cr per unit.
4. **Listing expiry:** proposed 7 days.
5. **Purchase currency:** wallet credits only (no points, no money).
6. **Cold start:** prod has ~1 tradable inventory row today — supply comes
   from store purchases/loot boxes over time; consider seeding a few
   labeled listings for launch testing only.

## Scope estimate (for planning, not commitment)

- API: `marketplace` module — listings CRUD, buy/cancel, history; ~4 new
  tables (`marketplace_listings`, `marketplace_orders`, idempotency keys);
  3 ledger types; admin takedown endpoint; expiry sweep.
- Web: `/marketplace` browse+detail+my-listings+history, sell flow on
  `/store/inventory`, nav entry, mobile/desktop per wireframes above.
- Tests: real-PG specs for reservation decrement, concurrent buy/cancel,
  insufficient funds, self-purchase, fee math, exactly-once settlement;
  E2E browse→list→buy→use-bought-item.

## Open questions for the owner

1. Consumables-only v1, or include unequipped cosmetics?
2. Fee % and who absorbs it (buyer price vs seller net)?
3. Price floor/ceiling?
4. Listing duration before auto-expiry?
5. May sellers relist unsold items automatically?
