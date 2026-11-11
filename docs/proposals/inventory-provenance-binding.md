# Mixed-Provenance Inventory — Bound vs Tradable Design (proposal, pre-marketplace gate)

Status: **design proposal — not approved, no schema changes made.**
Gate: must be resolved before any marketplace listing code ships.

## Problem

`user_inventory` rows merge all grants for a `(userId, itemId)` pair into one
stack (`@@unique(userId,itemId)`, upserted by purchase/admin/daily/wheel/loot-box
paths). Welcome gifts and repeatable login rewards are intended to be
**account-bound**; marketplace-tradable units must be distinguishable or a
single merged stack makes bound rewards sellable.

## Options considered

### A. Per-stack bound/tradable quantities (recommended for launch)

Add to `user_inventory`:

- `boundQty Int @default(0)` — units that can never be listed/transferred
- `tradableQty Int @default(0)` — units eligible for listing
- `qty` remains the total (`boundQty + tradableQty`), kept for backward
  compatibility during migration.

Consumption order (fixed, disclosed): **tradable first, then bound** — players
spend sellable stock before bound stock, which also minimizes surprise "my
item disappeared" support cases. Alternatively bound-first; pick one and
document it. Recommendation: **tradable-first** so bound welcome/daily units
linger as the safety net.

Grant rules:

- Welcome gift, daily login rewards, streak/milestone loot boxes → `boundQty`
- Store purchases, challenge/task rewards explicitly marked tradable,
  marketplace purchase receipts, admin grants flagged tradable → `tradableQty`
- Existing rows at migration: audit first (see below), default all existing
  qty to `boundQty` unless provenance is provably purchasable — conservative
  default, never retroactively tradable.

Listing reservation: listing N units decrements `tradableQty` inside the same
tx that creates the listing row (escrow). Cancel/expiry returns to
`tradableQty`. Sale transfers `tradableQty` to buyer. `useItem`/`equipCosmetic`
decrement `qty` preferring `tradableQty` (per chosen order) and never touch
`boundQty` until tradable is exhausted.

### B. Inventory lots (full provenance)

Separate `inventory_lots` table: one row per grant event
(`(userId, itemId, source, sourceRef, qty, bound, createdAt)`). Consumption and
listing draw down lots in FIFO or chosen order. Maximum auditability — every
unit traceable to its grant — but every inventory read becomes a lot
aggregation, and all existing writers need rewriting. **Deferred**: heavier
than launch needs; revisit if audit requirements demand per-unit provenance.

## Audit history requirement

Both options need an `inventory_events` ledger (append-only):
`(id, userId, itemId, delta, boundDelta, source, sourceRef, createdAt)` written
inside the same tx as every grant/consume/list/cancel/sell. This gives the
"audit history" requirement without a full lot model, and powers the economy
observability dashboard (credit/inventory sources & sinks).

## Pre-implementation audit (required before migration)

Run against production (read-only) before assigning binding:

```sql
-- inventory rows whose item was granted by non-purchase paths
SELECT ui.*, si.category, si.name
FROM user_inventory ui JOIN store_items si ON si.id = ui.item_id
WHERE si.category IN ('BOOST','CONVENIENCE');
-- cross-reference xp_events/voucher sources is not possible per-unit today —
-- conservative rule stands: all pre-existing qty → boundQty.
```

## Open owner decisions

| # | Decision | Proposed default |
|---|----------|------------------|
| P1 | Consumption order | Tradable-first |
| P2 | Which grant sources are tradable at launch | Store purchases + marketplace receipts + admin-flagged grants only |
| P3 | Pre-existing inventory | All bound (conservative) |
| P4 | Ledger table now or with marketplace PR | With marketplace PR (same migration) |

## Interaction with marketplace proposal

`player-item-marketplace.md` rev 2 assumed a single stack. Once this design is
approved, the listing flow reserves `tradableQty` (not `qty`), the purchase
receipt credits buyer `tradableQty`, and the checkout display shows
bound/tradable split per item.
